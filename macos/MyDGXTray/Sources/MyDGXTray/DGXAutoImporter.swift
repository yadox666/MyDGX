import Darwin
import Foundation

struct DGXImportResult {
    let configuration: MyDGXConfiguration
    let added: [String]
    let existing: [String]
    let unverified: [String]
}

struct DGXImportProgress {
    let deviceID: String
    let stage: String
    let detail: String
    let completed: Int
    let total: Int
}

@MainActor
enum DGXAutoImporter {
    static func importDevices(
        _ devices: [DiscoveredDGX],
        into original: MyDGXConfiguration,
        progress: ((DGXImportProgress) -> Void)? = nil
    ) async -> DGXImportResult {
        var configuration = original
        var added: [String] = []
        var existing: [String] = []
        var unverified: [String] = []
        let identities = candidateIdentities(configuration)

        for (index, device) in devices.enumerated() {
            progress?(
                DGXImportProgress(
                    deviceID: device.id,
                    stage: "verifying",
                    detail: String(localized: "Comprobando identidad y claves SSH…"),
                    completed: index,
                    total: devices.count
                )
            )
            if let existingIndex = existingConnectionIndex(
                device,
                connections: configuration.connections
            ) {
                let oldPort = configuration.connections[existingIndex].ssh.port
                if device.portVerified {
                    configuration.connections[existingIndex].ssh.port = device.port
                }
                existing.append(device.name)
                progress?(
                    DGXImportProgress(
                        deviceID: device.id,
                        stage: "existing",
                        detail: !device.portVerified
                            ? String(localized: "Ya está configurado · puerto anunciado sin verificar")
                            : (
                                oldPort == device.port
                                    ? String(localized: "Ya está configurado · SSH \(String(device.port))")
                                    : String(localized: "Ya configurado · SSH actualizado \(String(oldPort)) → \(String(device.port))")
                            ),
                        completed: index + 1,
                        total: devices.count
                    )
                )
                continue
            }

            var profile = makeProfile(
                device,
                configuration: configuration
            )
            var verifiedIdentity: String?
            for identity in identities {
                profile.ssh.identityFile = identity
                if (try? await SSHBootstrap.verify(profile: profile)) != nil {
                    verifiedIdentity = identity
                    break
                }
            }
            guard let verifiedIdentity else {
                unverified.append(device.name)
                progress?(
                    DGXImportProgress(
                        deviceID: device.id,
                        stage: "unverified",
                        detail: String(localized: "No acepta ninguna clave SSH local"),
                        completed: index + 1,
                        total: devices.count
                    )
                )
                continue
            }

            profile.ssh.identityFile = verifiedIdentity
            progress?(
                DGXImportProgress(
                    deviceID: device.id,
                    stage: "identifying",
                    detail: String(localized: "Clave verificada; identificando hardware…"),
                    completed: index,
                    total: devices.count
                )
            )
            if let deviceIdentity = try? await SSHBootstrap.detectDevice(profile: profile) {
                profile.detectedDeviceModel = deviceIdentity.model
                profile.detectedDeviceVariant = deviceIdentity.variant
            }
            configuration.connections.append(profile)
            added.append(profile.alias)
            progress?(
                DGXImportProgress(
                    deviceID: device.id,
                    stage: "added",
                    detail: profile.detectedDeviceModel.map { String(localized: "Añadido · \($0)") }
                        ?? String(localized: "Añadido"),
                    completed: index + 1,
                    total: devices.count
                )
            )
        }

        return DGXImportResult(
            configuration: configuration,
            added: added,
            existing: existing,
            unverified: unverified
        )
    }

    private static func makeProfile(
        _ device: DiscoveredDGX,
        configuration: MyDGXConfiguration
    ) -> ConnectionProfile {
        var profile = ConnectionProfile()
        profile.alias = uniqueAlias(
            device: device,
            existing: configuration.connections.map(\.alias)
        )
        profile.kind = .lan
        profile.scheme = "http"
        profile.apiHost = device.connectionHost
        profile.apiPort = 8088
        profile.dashboardPath = "/"
        profile.ssh.host = device.connectionHost
        profile.ssh.user = "nvidia"
        profile.ssh.port = device.port
        profile.tunnel.enabled = true
        let ports = allocatePorts(configuration.connections)
        profile.tunnel.localAPIPort = ports.api
        profile.tunnel.localOpenWebUIPort = ports.openWebUI
        profile.tunnel.localComfyUIPort = ports.comfyUI
        profile.tunnel.localGatewayPort = ports.gateway
        profile.tunnel.localDGXDashboardPort = ports.dashboard
        profile.deployment.sourcePath = configuration.activeConnection.deployment.sourcePath
        profile.deployment.remoteDirectory = "MyDGX-Dashboard"
        return profile
    }

    private static func existingConnectionIndex(
        _ device: DiscoveredDGX,
        connections: [ConnectionProfile]
    ) -> Int? {
        let discovered = resolvedAddresses(device.connectionHost)
            .union(resolvedAddresses(device.host))
        return connections.firstIndex { profile in
            [profile.ssh.host, profile.apiHost]
                .filter { !$0.isEmpty }
                .contains { !discovered.isDisjoint(with: resolvedAddresses($0)) }
        }
    }

    private static func uniqueAlias(
        device: DiscoveredDGX,
        existing: [String]
    ) -> String {
        let allowed = CharacterSet.alphanumerics
            .union(CharacterSet(charactersIn: " ._-"))
        let cleaned = String(
            device.name.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : " " }
        )
        let normalized = cleaned
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
        let shortHost = device.connectionHost.split(separator: ".").first.map(String.init)
            ?? device.connectionHost
        let base = String(
            (normalized.isEmpty ? "DGX \(shortHost)" : normalized).prefix(52)
        )
        let aliases = Set(existing.map { $0.folding(options: .caseInsensitive, locale: nil) })
        var candidate = base
        var suffix = 2
        while aliases.contains(candidate.folding(options: .caseInsensitive, locale: nil)) {
            candidate = "\(base) \(suffix)"
            suffix += 1
        }
        return candidate
    }

    private static func allocatePorts(
        _ connections: [ConnectionProfile]
    ) -> (api: Int, openWebUI: Int, comfyUI: Int, gateway: Int, dashboard: Int) {
        let used = Set(connections.flatMap {
            [
                $0.tunnel.localAPIPort,
                $0.tunnel.localOpenWebUIPort,
                $0.tunnel.localComfyUIPort,
                $0.tunnel.localGatewayPort,
                $0.tunnel.localDGXDashboardPort,
            ]
        })
        for offset in stride(from: 0, through: 40_000, by: 10_000) {
            let candidate = (
                api: 18_088 + offset,
                openWebUI: 13_000 + offset,
                comfyUI: 18_188 + offset,
                gateway: 14_000 + offset,
                dashboard: 11_000 + offset
            )
            let ports = [
                candidate.api, candidate.openWebUI, candidate.comfyUI,
                candidate.gateway, candidate.dashboard,
            ]
            if ports.allSatisfy({ $0 <= 65_535 && !used.contains($0) }) {
                return candidate
            }
        }
        return (65_087, 65_088, 65_089, 65_090, 65_091)
    }

    private static func candidateIdentities(
        _ configuration: MyDGXConfiguration
    ) -> [String] {
        var paths: [String] = configuration.connections
            .map(\.ssh.identityFile)
            .filter { !$0.isEmpty }
        for directory in [
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".ssh"),
            SupportLayout.keys,
        ] {
            guard let files = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]
            ) else {
                continue
            }
            for publicKey in files where publicKey.pathExtension == "pub" {
                paths.append(publicKey.deletingPathExtension().path)
            }
        }

        var seen = Set<String>()
        return paths.compactMap { value in
            let expanded = NSString(string: value).expandingTildeInPath
            guard seen.insert(expanded).inserted,
                  securePrivateKey(at: expanded) else {
                return nil
            }
            let home = FileManager.default.homeDirectoryForCurrentUser.path + "/"
            return expanded.hasPrefix(home)
                ? "~/" + String(expanded.dropFirst(home.count))
                : expanded
        }
    }

    private static func securePrivateKey(at path: String) -> Bool {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
              attributes[.type] as? FileAttributeType == .typeRegular,
              let permissions = attributes[.posixPermissions] as? NSNumber else {
            return false
        }
        return permissions.intValue & 0o077 == 0
    }

    private static func resolvedAddresses(_ host: String) -> Set<String> {
        let normalized = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        var values: Set<String> = [normalized]
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        hints.ai_flags = AI_ADDRCONFIG
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &result) == 0, let first = result else {
            return values
        }
        defer { freeaddrinfo(first) }
        var current: UnsafeMutablePointer<addrinfo>? = first
        while let item = current {
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(
                item.pointee.ai_addr,
                item.pointee.ai_addrlen,
                &buffer,
                socklen_t(buffer.count),
                nil,
                0,
                NI_NUMERICHOST
            ) == 0 {
                values.insert(String(cString: buffer).lowercased())
            }
            current = item.pointee.ai_next
        }
        return values
    }
}

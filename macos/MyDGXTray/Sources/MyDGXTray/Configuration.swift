import Foundation

struct MyDGXConfiguration: Codable, Equatable {
    var version = 2
    var activeConnectionID: String
    var connections: [ConnectionProfile]

    init() {
        let profile = ConnectionProfile()
        activeConnectionID = profile.id
        connections = [profile]
    }

    var activeConnection: ConnectionProfile {
        connections.first(where: { $0.id == activeConnectionID }) ?? connections[0]
    }

    var scheme: String { activeConnection.scheme }
    var host: String { activeConnection.effectiveAPIHost }
    var port: Int { activeConnection.effectiveAPIPort }
    var apiKeyAccount: String { activeConnection.apiKeyAccount }
    var caCertificatePath: String { activeConnection.caCertificatePath }
    var refreshIntervalSeconds: Int { activeConnection.refreshIntervalSeconds }
    var ssh: SSHConfiguration { activeConnection.ssh }
    var baseURL: URL? { activeConnection.baseURL }
    var dashboardURL: URL? { activeConnection.dashboardURL }
    var resolvedOpenWebUIURL: URL? { activeConnection.resolvedOpenWebUIURL }

    mutating func setActiveConnection(id: String) throws {
        guard connections.contains(where: { $0.id == id }) else {
            throw ConfigurationError.profileNotFound
        }
        activeConnectionID = id
    }

    func validated() throws -> MyDGXConfiguration {
        guard !connections.isEmpty else { throw ConfigurationError.noProfiles }
        guard connections.contains(where: { $0.id == activeConnectionID }) else {
            throw ConfigurationError.profileNotFound
        }
        var aliases = Set<String>()
        var identifiers = Set<String>()
        for profile in connections {
            try profile.validate()
            guard aliases.insert(profile.alias.lowercased()).inserted,
                  identifiers.insert(profile.id).inserted else {
                throw ConfigurationError.duplicateProfile
            }
        }
        return self
    }

    private enum CodingKeys: String, CodingKey {
        case version, activeConnectionID, connections
        case scheme, host, port, dashboardPath, openWebUIURL, apiKeyAccount
        case caCertificatePath, refreshIntervalSeconds, ssh
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(activeConnectionID, forKey: .activeConnectionID)
        try container.encode(connections, forKey: .connections)
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let decoded = try container.decodeIfPresent([ConnectionProfile].self, forKey: .connections),
           !decoded.isEmpty {
            version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 2
            connections = decoded
            activeConnectionID = try container.decodeIfPresent(String.self, forKey: .activeConnectionID)
                ?? decoded[0].id
            return
        }

        var migrated = ConnectionProfile()
        migrated.alias = String(localized: "Equipo actual")
        migrated.kind = .remote
        migrated.scheme = try container.decodeIfPresent(String.self, forKey: .scheme) ?? "http"
        migrated.apiHost = try container.decodeIfPresent(String.self, forKey: .host) ?? "127.0.0.1"
        migrated.apiPort = try container.decodeIfPresent(Int.self, forKey: .port) ?? 8088
        migrated.dashboardPath = try container.decodeIfPresent(String.self, forKey: .dashboardPath) ?? "/"
        migrated.openWebUIURL = try container.decodeIfPresent(String.self, forKey: .openWebUIURL)
        migrated.apiKeyAccount = try container.decodeIfPresent(String.self, forKey: .apiKeyAccount) ?? migrated.id
        migrated.caCertificatePath = try container.decodeIfPresent(String.self, forKey: .caCertificatePath) ?? ""
        migrated.refreshIntervalSeconds = try container.decodeIfPresent(Int.self, forKey: .refreshIntervalSeconds) ?? 5
        migrated.ssh = try container.decodeIfPresent(SSHConfiguration.self, forKey: .ssh) ?? SSHConfiguration()
        version = 2
        activeConnectionID = migrated.id
        connections = [migrated]
    }
}

enum ConnectionKind: String, Codable, CaseIterable, Identifiable {
    case local
    case lan
    case axforge
    case remote

    var id: String { rawValue }

    var label: String {
        switch self {
        case .local: return String(localized: "Local")
        case .lan: return String(localized: "Red local")
        case .axforge: return "AxForge"
        case .remote: return String(localized: "Remoto")
        }
    }
}

struct ConnectionProfile: Codable, Equatable, Identifiable {
    var id = UUID().uuidString
    var alias = String(localized: "Mi DGX")
    var kind = ConnectionKind.local
    var scheme = "http"
    var apiHost = "127.0.0.1"
    var apiPort = 8088
    var dashboardPath = "/"
    var openWebUIURL: String?
    var apiKeyAccount = UUID().uuidString
    var caCertificatePath = ""
    var refreshIntervalSeconds = 5
    var detectedDeviceModel: String?
    var detectedDeviceVariant: String?
    var ssh = SSHConfiguration()
    var tunnel = TunnelConfiguration()
    var deployment = DeploymentConfiguration()

    var effectiveAPIHost: String {
        tunnel.enabled ? "127.0.0.1" : apiHost
    }

    var effectiveAPIPort: Int {
        tunnel.enabled ? tunnel.localAPIPort : apiPort
    }

    var baseURL: URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = effectiveAPIHost
        components.port = effectiveAPIPort
        return components.url
    }

    var dashboardURL: URL? {
        guard let baseURL else { return nil }
        return URL(string: dashboardPath, relativeTo: baseURL)?.absoluteURL
    }

    var resolvedOpenWebUIURL: URL? {
        if let value = openWebUIURL?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty {
            return URL(string: value)
        }
        var components = URLComponents()
        components.scheme = "http"
        components.host = tunnel.enabled ? "127.0.0.1" : apiHost
        components.port = tunnel.enabled ? tunnel.localOpenWebUIPort : 3000
        return components.url
    }

    var resolvedComfyUIURL: URL? {
        var components = URLComponents()
        components.scheme = "http"
        components.host = tunnel.enabled ? "127.0.0.1" : apiHost
        components.port = tunnel.enabled ? tunnel.localComfyUIPort : 8188
        return components.url
    }

    func validate() throws {
        guard alias.range(of: #"^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ._-]{2,60}$"#, options: .regularExpression) != nil else {
            throw ConfigurationError.invalidAlias
        }
        guard ["http", "https"].contains(scheme),
              Self.isSafeHost(apiHost),
              apiKeyAccount.range(
                  of: #"^[A-Za-z0-9._-]{1,128}$"#,
                  options: .regularExpression
              ) != nil,
              (1...65535).contains(apiPort),
              (1...3600).contains(refreshIntervalSeconds),
              baseURL != nil else {
            throw ConfigurationError.invalidServer
        }
        if let value = openWebUIURL?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty {
            guard let components = URLComponents(string: value),
                  ["http", "https"].contains(components.scheme),
                  components.host != nil else {
                throw ConfigurationError.invalidOpenWebUI
            }
        }
        guard ssh.host.isEmpty || Self.isSafeHost(ssh.host),
              ssh.publicHost.isEmpty || Self.isSafeHost(ssh.publicHost),
              ssh.user.isEmpty || Self.isSafeSSHUser(ssh.user),
              (1...65535).contains(ssh.port),
              (1...65535).contains(ssh.publicPort) else {
            throw ConfigurationError.invalidSSH
        }
        try tunnel.validate()
        try deployment.validate()
    }

    private static func isSafeHost(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9._:-]+$"#, options: .regularExpression) != nil
    }

    private static func isSafeSSHUser(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil
    }
}

struct TunnelConfiguration: Codable, Equatable {
    var enabled = false
    var localAPIPort = 18088
    var remoteAPIHost = "127.0.0.1"
    var remoteAPIPort = 8088
    var localOpenWebUIPort = 13000
    var remoteOpenWebUIHost = "127.0.0.1"
    var remoteOpenWebUIPort = 3000
    var localComfyUIPort = 18188
    var remoteComfyUIHost = "127.0.0.1"
    var remoteComfyUIPort = 8188
    var localGatewayPort = 14000
    var remoteGatewayHost = "127.0.0.1"
    var remoteGatewayPort = 4000
    var localDGXDashboardPort = 11000
    var remoteDGXDashboardHost = "127.0.0.1"
    var remoteDGXDashboardPort = 11000

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        localAPIPort = try container.decodeIfPresent(Int.self, forKey: .localAPIPort) ?? 18088
        remoteAPIHost = try container.decodeIfPresent(String.self, forKey: .remoteAPIHost) ?? "127.0.0.1"
        remoteAPIPort = try container.decodeIfPresent(Int.self, forKey: .remoteAPIPort) ?? 8088
        localOpenWebUIPort = try container.decodeIfPresent(Int.self, forKey: .localOpenWebUIPort) ?? 13000
        remoteOpenWebUIHost = try container.decodeIfPresent(String.self, forKey: .remoteOpenWebUIHost) ?? "127.0.0.1"
        remoteOpenWebUIPort = try container.decodeIfPresent(Int.self, forKey: .remoteOpenWebUIPort) ?? 3000
        localComfyUIPort = try container.decodeIfPresent(Int.self, forKey: .localComfyUIPort) ?? 18188
        remoteComfyUIHost = try container.decodeIfPresent(String.self, forKey: .remoteComfyUIHost) ?? "127.0.0.1"
        remoteComfyUIPort = try container.decodeIfPresent(Int.self, forKey: .remoteComfyUIPort) ?? 8188
        localGatewayPort = try container.decodeIfPresent(Int.self, forKey: .localGatewayPort) ?? 14000
        remoteGatewayHost = try container.decodeIfPresent(String.self, forKey: .remoteGatewayHost) ?? "127.0.0.1"
        remoteGatewayPort = try container.decodeIfPresent(Int.self, forKey: .remoteGatewayPort) ?? 4000
        localDGXDashboardPort = try container.decodeIfPresent(Int.self, forKey: .localDGXDashboardPort) ?? 11000
        remoteDGXDashboardHost = try container.decodeIfPresent(String.self, forKey: .remoteDGXDashboardHost) ?? "127.0.0.1"
        remoteDGXDashboardPort = try container.decodeIfPresent(Int.self, forKey: .remoteDGXDashboardPort) ?? 11000
    }

    func validate() throws {
        let ports = [
            localAPIPort, remoteAPIPort, localOpenWebUIPort, remoteOpenWebUIPort,
            localComfyUIPort, remoteComfyUIPort,
            localGatewayPort, remoteGatewayPort,
            localDGXDashboardPort, remoteDGXDashboardPort,
        ]
        let localPorts = Set([
            localAPIPort, localOpenWebUIPort, localComfyUIPort,
            localGatewayPort, localDGXDashboardPort,
        ])
        let safeHost = #"^[A-Za-z0-9._:-]+$"#
        guard ports.allSatisfy({ (1...65535).contains($0) }),
              localPorts.count == 5,
              remoteAPIHost.range(of: safeHost, options: .regularExpression) != nil,
              remoteOpenWebUIHost.range(of: safeHost, options: .regularExpression) != nil,
              remoteComfyUIHost.range(of: safeHost, options: .regularExpression) != nil,
              remoteGatewayHost.range(of: safeHost, options: .regularExpression) != nil,
              remoteDGXDashboardHost.range(of: safeHost, options: .regularExpression) != nil else {
            throw ConfigurationError.invalidTunnel
        }
    }
}

struct DeploymentConfiguration: Codable, Equatable {
    var sourcePath = ""
    var remoteDirectory = "MyDGX-Dashboard"

    func validate() throws {
        guard remoteDirectory.range(
            of: #"^(?!/)(?!.*\.\.)[A-Za-z0-9._/-]+$"#,
            options: .regularExpression
        ) != nil else {
            throw ConfigurationError.invalidDeployment
        }
    }
}

struct SSHConfiguration: Codable, Equatable {
    var host = ""
    var user = ""
    var port = 22
    var publicHost = ""
    var publicPort = 65022
    var identityFile = ""

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        host = try container.decodeIfPresent(String.self, forKey: .host) ?? ""
        user = try container.decodeIfPresent(String.self, forKey: .user) ?? ""
        port = try container.decodeIfPresent(Int.self, forKey: .port) ?? 22
        publicHost = try container.decodeIfPresent(String.self, forKey: .publicHost) ?? ""
        publicPort = try container.decodeIfPresent(Int.self, forKey: .publicPort) ?? 65022
        identityFile = try container.decodeIfPresent(String.self, forKey: .identityFile) ?? ""
    }
}

enum ConfigurationError: LocalizedError {
    case noProfiles
    case profileNotFound
    case duplicateProfile
    case invalidAlias
    case invalidServer
    case invalidPortOrInterval
    case invalidOpenWebUI
    case invalidSSH
    case invalidTunnel
    case invalidDeployment

    var errorDescription: String? {
        switch self {
        case .noProfiles:
            return String(localized: "Debe existir al menos un perfil de conexión.")
        case .profileNotFound:
            return String(localized: "El perfil activo no existe.")
        case .duplicateProfile:
            return String(localized: "Los alias e identificadores de los perfiles deben ser únicos.")
        case .invalidAlias:
            return String(localized: "El alias del equipo no es válido.")
        case .invalidServer:
            return String(localized: "El servidor debe usar http o https y tener una dirección válida.")
        case .invalidPortOrInterval:
            return String(localized: "El puerto o intervalo de actualización no es válido.")
        case .invalidOpenWebUI:
            return String(localized: "La URL de Open WebUI debe ser una dirección http o https válida.")
        case .invalidSSH:
            return String(localized: "La configuración SSH contiene valores no válidos.")
        case .invalidTunnel:
            return String(localized: "La configuración del túnel contiene puertos no válidos.")
        case .invalidDeployment:
            return String(localized: "El directorio remoto de despliegue no es válido.")
        }
    }
}

enum ConfigurationStore {
    static let directoryURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".MyDGX", isDirectory: true)
    static let fileURL = directoryURL.appendingPathComponent("config")

    static func load() throws -> MyDGXConfiguration {
        try SupportLayout.install()
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            let configuration = MyDGXConfiguration()
            try save(configuration)
            return configuration
        }
        let data = try Data(contentsOf: fileURL)
        let configuration = try JSONDecoder().decode(MyDGXConfiguration.self, from: data).validated()
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           object["connections"] == nil || object["wakeOnLAN"] != nil {
            try save(configuration)
        }
        return configuration
    }

    static func save(_ configuration: MyDGXConfiguration) throws {
        let validated = try configuration.validated()
        try FileManager.default.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(validated)
        try data.write(to: fileURL, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: fileURL.path
        )
    }
}

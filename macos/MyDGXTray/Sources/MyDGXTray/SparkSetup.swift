import Foundation
import Network

/// Non-UI steps of the Spark setup assistant: finding the device, SSH access and installation.
enum SparkSetup {
    static let defaultSSHPorts = [22, 65_022, 2222]

    struct SSHProbe: Equatable {
        let host: String
        let port: Int
        let banner: String?

        /// Operating system advertised by the SSH banner, before logging in.
        var systemHint: String? {
            guard let banner else { return nil }
            let lowered = banner.lowercased()
            guard lowered.contains("ubuntu") else {
                return lowered.contains("debian") ? "Debian" : nil
            }
            if lowered.contains("openssh_9.6") { return "Ubuntu 24.04 · DGX OS 7" }
            if lowered.contains("openssh_8.9") { return "Ubuntu 22.04 · DGX OS 6" }
            return "Ubuntu"
        }
    }

    struct DeviceGuess: Equatable {
        let brand: String
        let model: String
        let variant: String
    }

    struct SparkFacts: Equatable {
        var vendor = ""
        var product = ""
        var operatingSystem = ""
        var dgxRelease = ""
        var hostname = ""
        var architecture = ""
        var gpu = ""
        var sudoWithoutPassword = false
        var mydgxInstalled = false
        var mydgxRunning = false

        var isDGXOS: Bool { !dgxRelease.isEmpty }

        var systemDescription: String {
            if isDGXOS {
                return operatingSystem.isEmpty ? dgxRelease : "\(dgxRelease) · \(operatingSystem)"
            }
            return operatingSystem.isEmpty ? "Linux" : operatingSystem
        }

        var device: DeviceGuess {
            let guess = SparkSetup.guessDevice(from: "\(vendor) \(product) \(hostname)")
            let brand = vendor.isEmpty ? guess.brand : SparkSetup.prettyVendor(vendor)
            let model = SparkSetup.prettyProduct(product, brand: brand)
                ?? (guess.brand == brand ? guess.model : "DGX Spark")
            return DeviceGuess(brand: brand, model: model, variant: guess.variant)
        }
    }

    /// Turns DMI names like "NVIDIA_DGX_Spark" into "DGX Spark"; nil for OEM placeholders.
    static func prettyProduct(_ product: String, brand: String) -> String? {
        var words = product
            .replacingOccurrences(of: "_", with: " ")
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)
        while let first = words.first,
              first.caseInsensitiveCompare(brand) == .orderedSame || first.lowercased() == "nvidia" {
            words.removeFirst()
        }
        let name = words.joined(separator: " ")
        let placeholders = ["", "default string", "system product name", "to be filled by o.e.m.", "not specified"]
        return placeholders.contains(name.lowercased()) ? nil : name
    }

    // MARK: Step 1 · find the Spark

    /// Tries the given ports (or the usual Spark SSH ports) and returns the first that answers as SSH.
    static func probe(host: String, ports: [Int]? = nil) async -> SSHProbe? {
        let candidates = ports ?? defaultSSHPorts
        return await withTaskGroup(of: (Int, SSHProbe?).self) { group in
            for (order, port) in candidates.enumerated() {
                group.addTask {
                    guard let banner = await SSHBannerReader.read(host: host, port: port) else {
                        return (order, nil)
                    }
                    return (order, SSHProbe(host: host, port: port, banner: banner))
                }
            }
            var found: [(Int, SSHProbe)] = []
            for await (order, probe) in group {
                if let probe { found.append((order, probe)) }
            }
            return found.min(by: { $0.0 < $1.0 })?.1
        }
    }

    static func guessDevice(from evidence: String) -> DeviceGuess {
        let value = evidence.lowercased()
        if value.contains("asus") || value.contains("gx10") || value.contains("ascent") {
            return DeviceGuess(brand: "ASUS", model: "Ascent GX10", variant: "asus")
        }
        if value.contains("lenovo") || value.contains("pgx") {
            return DeviceGuess(brand: "Lenovo", model: "ThinkStation PGX", variant: "lenovo")
        }
        if value.contains("zgx") || value.range(of: #"\bhp\b"#, options: .regularExpression) != nil {
            return DeviceGuess(brand: "HP", model: "ZGX Nano", variant: "hp")
        }
        if value.contains("dell") || value.contains("pro max") || value.contains("promax") || value.contains("fcm1253") {
            return DeviceGuess(brand: "Dell", model: "Pro Max GB10", variant: "dell")
        }
        if value.contains("msi") || value.contains("edgexpert") {
            return DeviceGuess(brand: "MSI", model: "EdgeXpert", variant: "other")
        }
        if value.contains("gigabyte") || value.contains("atom") {
            return DeviceGuess(brand: "Gigabyte", model: "AI TOP ATOM", variant: "other")
        }
        return DeviceGuess(brand: "NVIDIA", model: "DGX Spark", variant: "nvidia")
    }

    static func prettyVendor(_ vendor: String) -> String {
        let value = vendor.lowercased()
        if value.contains("asus") { return "ASUS" }
        if value.contains("lenovo") { return "Lenovo" }
        if value.contains("hp") || value.contains("hewlett") { return "HP" }
        if value.contains("nvidia") { return "NVIDIA" }
        if value.contains("dell") { return "Dell" }
        if value.contains("micro-star") || value.contains("msi") { return "MSI" }
        if value.contains("gigabyte") { return "Gigabyte" }
        return vendor
    }

    // MARK: Step 2 · SSH access

    /// Fetches the Spark's host keys so the user can trust them before sending any password.
    static func scanHostKeys(
        host: String,
        port: Int
    ) async throws -> (keys: String, fingerprint: String, allFingerprints: Set<String>) {
        let scan = try await run(
            "/usr/bin/ssh-keyscan",
            ["-T", "5", "-t", "ed25519,ecdsa,rsa", "-p", String(port), host],
            timeout: 15
        )
        let keys = scan.output
            .split(whereSeparator: \.isNewline)
            .filter { !$0.hasPrefix("#") && !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .joined(separator: "\n")
        guard !keys.isEmpty else { throw SetupError.hostUnreachable }
        let lines = try await fingerprintLines(keys)
        let preferred = lines.first(where: { $0.contains("ED25519") }) ?? lines.first ?? ""
        let fingerprint = preferred.split(separator: " ").dropFirst().first.map(String.init) ?? ""
        guard fingerprint.hasPrefix("SHA256:") else { throw SetupError.hostUnreachable }
        return (keys + "\n", fingerprint, fingerprintSet(lines))
    }

    /// Fingerprints that ~/.MyDGX/known_hosts already trusts for host:port.
    static func knownFingerprints(host: String, port: Int) async -> Set<String> {
        let name = port == 22 ? host : "[\(host)]:\(port)"
        guard FileManager.default.fileExists(atPath: SupportLayout.knownHosts.path),
              let found = try? await run(
                  "/usr/bin/ssh-keygen",
                  ["-F", name, "-f", SupportLayout.knownHosts.path],
                  timeout: 10
              ),
              found.status == 0 else { return [] }
        let keys = found.output
            .split(whereSeparator: \.isNewline)
            .filter { !$0.hasPrefix("#") }
            .joined(separator: "\n")
        guard let lines = try? await fingerprintLines(keys) else { return [] }
        return fingerprintSet(lines)
    }

    private static func fingerprintLines(_ keys: String) async throws -> [String] {
        let result = try await run(
            "/usr/bin/ssh-keygen",
            ["-lf", "-"],
            input: Data((keys + "\n").utf8),
            timeout: 10
        )
        return result.output.split(whereSeparator: \.isNewline).map(String.init)
    }

    private static func fingerprintSet(_ lines: [String]) -> Set<String> {
        Set(lines.compactMap { line in
            line.split(separator: " ").dropFirst().first.map(String.init)
        }.filter { $0.hasPrefix("SHA256:") })
    }

    /// Stores the scanned host keys in ~/.MyDGX/known_hosts unless the host is already known.
    static func trustHostKeys(_ keys: String, host: String, port: Int) async throws {
        try SupportLayout.install()
        let store = SupportLayout.knownHosts
        if !FileManager.default.fileExists(atPath: store.path) {
            FileManager.default.createFile(
                atPath: store.path,
                contents: nil,
                attributes: [.posixPermissions: 0o600]
            )
        }
        let name = port == 22 ? host : "[\(host)]:\(port)"
        let existing = try await run("/usr/bin/ssh-keygen", ["-F", name, "-f", store.path], timeout: 10)
        guard existing.status != 0 else { return }
        let handle = try FileHandle(forWritingTo: store)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: Data(keys.utf8))
    }

    /// Replaces the stored keys for host:port after the user confirmed a changed fingerprint.
    static func replaceHostKeys(_ keys: String, host: String, port: Int) async throws {
        let store = SupportLayout.knownHosts
        let name = port == 22 ? host : "[\(host)]:\(port)"
        if FileManager.default.fileExists(atPath: store.path) {
            _ = try await run("/usr/bin/ssh-keygen", ["-R", name, "-f", store.path], timeout: 10)
            try? FileManager.default.removeItem(atPath: store.path + ".old")
        }
        try await trustHostKeys(keys, host: host, port: port)
    }

    struct PrivateKeyInfo: Equatable {
        let fingerprint: String
        let encrypted: Bool
    }

    /// Rejects public keys and non-key files before any connection is attempted.
    static func inspectPrivateKey(at path: String) async throws -> PrivateKeyInfo {
        let url = URL(fileURLWithPath: NSString(string: path).expandingTildeInPath)
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size < 64 * 1024,
              let head = try? String(contentsOf: url, encoding: .utf8) else {
            throw SetupError.notPrivateKey
        }
        let text = head.trimmingCharacters(in: .whitespacesAndNewlines)
        if url.pathExtension == "pub" || text.hasPrefix("ssh-") || text.hasPrefix("ecdsa-") || text.hasPrefix("sk-") {
            throw SetupError.publicKeyChosen
        }
        guard text.hasPrefix("-----BEGIN"), text.contains("PRIVATE KEY-----") else {
            throw SetupError.notPrivateKey
        }
        let listed = try await run("/usr/bin/ssh-keygen", ["-l", "-f", url.path], timeout: 10)
        guard listed.status == 0,
              let fingerprint = fingerprintSet([listed.output]).first else {
            throw SetupError.notPrivateKey
        }
        let unlocked = try await run("/usr/bin/ssh-keygen", ["-y", "-P", "", "-f", url.path], timeout: 10)
        return PrivateKeyInfo(fingerprint: fingerprint, encrypted: unlocked.status != 0)
    }

    static func agentHasKey(_ fingerprint: String) async -> Bool {
        guard let listed = try? await run("/usr/bin/ssh-add", ["-l"], timeout: 10) else { return false }
        return listed.output.contains(fingerprint)
    }

    /// Unlocks a passphrase-protected key into ssh-agent and stores the passphrase in the macOS Keychain.
    static func addKeyToAgent(path: String, passphrase: String) async throws {
        let askpass = try AskpassSecret(passphrase)
        defer { askpass.remove() }
        let result = try await run(
            "/usr/bin/ssh-add",
            ["--apple-use-keychain", NSString(string: path).expandingTildeInPath],
            environment: askpass.environment,
            timeout: 20
        )
        guard result.status == 0 else { throw SetupError.wrongPassphrase }
    }

    /// Keys whose passphrase lives in the Keychain are not in ssh-agent after a restart.
    static func loadKeychainKeys(for profiles: [ConnectionProfile]) async {
        for profile in profiles where !profile.ssh.identityFile.isEmpty {
            guard let info = try? await inspectPrivateKey(at: profile.ssh.identityFile), info.encrypted else {
                continue
            }
            if await agentHasKey(info.fingerprint) { continue }
            _ = try? await run("/usr/bin/ssh-add", ["--apple-load-keychain", "-q"], timeout: 15)
            return
        }
    }

    /// Public half of a private key: its .pub, the key itself if unencrypted, or ssh-agent.
    static func publicKey(forPrivateKey path: String, info: PrivateKeyInfo) async throws -> String {
        let expanded = NSString(string: path).expandingTildeInPath
        if let pub = try? String(contentsOfFile: expanded + ".pub", encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines),
           pub.hasPrefix("ssh-") || pub.hasPrefix("ecdsa-") || pub.hasPrefix("sk-") {
            return pub
        }
        if !info.encrypted {
            let derived = try await run("/usr/bin/ssh-keygen", ["-y", "-P", "", "-f", expanded], timeout: 10)
            if derived.status == 0 { return derived.output.trimmingCharacters(in: .whitespacesAndNewlines) }
        }
        let listed = try await run("/usr/bin/ssh-add", ["-L"], timeout: 10)
        for line in listed.output.split(whereSeparator: \.isNewline).map(String.init)
        where (try? await fingerprintLines(line))?.first?.contains(info.fingerprint) == true {
            return line
        }
        throw BootstrapError.missingKeyPair
    }

    /// Installs the profile's public key using the account password, without opening Terminal.
    static func installPublicKey(profile: ConnectionProfile, password: String, publicKey: String? = nil) async throws {
        let key: String
        if let publicKey {
            key = publicKey
        } else {
            key = try String(contentsOf: URL(fileURLWithPath: expandedIdentity(profile) + ".pub"), encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard key.hasPrefix("ssh-") || key.hasPrefix("ecdsa-") || key.hasPrefix("sk-"),
              !key.contains("\n") else { throw BootstrapError.missingKeyPair }
        let askpass = try AskpassSecret(password)
        defer { askpass.remove() }
        let result = try await run(
            "/usr/bin/ssh",
            sshOptions(profile) + [
                "-o", "PubkeyAuthentication=no",
                "-o", "PreferredAuthentications=keyboard-interactive,password",
                "-o", "NumberOfPasswordPrompts=1",
                "\(profile.ssh.user)@\(profile.ssh.host)",
                "umask 077; mkdir -p \"$HOME/.ssh\"; touch \"$HOME/.ssh/authorized_keys\"; "
                    + "key=\"$(cat)\"; grep -qxF \"$key\" \"$HOME/.ssh/authorized_keys\" "
                    + "|| printf '%s\\n' \"$key\" >> \"$HOME/.ssh/authorized_keys\"; "
                    + "chmod 700 \"$HOME/.ssh\"; chmod 600 \"$HOME/.ssh/authorized_keys\"",
            ],
            input: Data((key + "\n").utf8),
            environment: askpass.environment,
            timeout: 40
        )
        guard result.status == 0 else { throw classify(result.errorOutput, passwordLogin: true) }
    }

    static func verifyKeyAccess(profile: ConnectionProfile) async throws {
        let result = try await runRemote(profile, "true", timeout: 20)
        guard result.status == 0 else { throw classify(result.errorOutput, passwordLogin: false) }
    }

    /// Reads brand, model and operating system once logged in.
    static func inspect(profile: ConnectionProfile) async throws -> SparkFacts {
        let directory = shellQuote(profile.deployment.remoteDirectory)
        let script = """
        field() { sed -n "s/^$1=//p" "$2" 2>/dev/null | head -n1 | tr -d '"'; }
        printf 'vendor=%s\\n' "$(cat /sys/devices/virtual/dmi/id/sys_vendor 2>/dev/null)"
        printf 'product=%s\\n' "$(cat /sys/devices/virtual/dmi/id/product_name 2>/dev/null)"
        printf 'os=%s\\n' "$(field PRETTY_NAME /etc/os-release)"
        dgx="$(field DGX_PRETTY_NAME /etc/dgx-release)"
        [ -n "$dgx" ] || { [ -r /etc/dgx-release ] && dgx="DGX OS"; }
        version="$(field DGX_OTA_VERSION /etc/dgx-release)"
        [ -n "$version" ] || version="$(field DGX_SWBUILD_VERSION /etc/dgx-release)"
        printf 'dgx=%s\\n' "${dgx}${version:+ $version}"
        printf 'hostname=%s\\n' "$(hostname 2>/dev/null)"
        printf 'arch=%s\\n' "$(uname -m)"
        printf 'gpu=%s\\n' "$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n1)"
        if sudo -n true 2>/dev/null; then echo sudo=1; else echo sudo=0; fi
        [ -x "$HOME"/\(directory)/start.sh ] && echo mydgx=1 || echo mydgx=0
        systemctl is-active --quiet mydgx 2>/dev/null && echo service=1 || echo service=0
        """
        let result = try await runRemote(profile, script, timeout: 25)
        guard result.status == 0 else { throw classify(result.errorOutput, passwordLogin: false) }
        var facts = SparkFacts()
        for line in result.output.split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { continue }
            let value = String(parts[1].trimmingCharacters(in: .whitespaces).prefix(160))
            switch parts[0] {
            case "vendor": facts.vendor = value
            case "product": facts.product = value
            case "os": facts.operatingSystem = value
            case "dgx": facts.dgxRelease = value
            case "hostname": facts.hostname = value
            case "arch": facts.architecture = value
            case "gpu": facts.gpu = value
            case "sudo": facts.sudoWithoutPassword = value == "1"
            case "mydgx": facts.mydgxInstalled = value == "1"
            case "service": facts.mydgxRunning = value == "1"
            default: break
            }
        }
        return facts
    }

    /// Checks the administrator password before a long installation starts.
    static func checkSudo(profile: ConnectionProfile, password: String) async throws -> Bool {
        let result = try await runRemote(
            profile,
            "sudo -k; sudo -S -p '' -v 2>/dev/null && echo ok",
            input: Data((password + "\n").utf8),
            timeout: 25
        )
        return result.output.contains("ok")
    }

    // MARK: Helpers

    static func expandedIdentity(_ profile: ConnectionProfile) -> String {
        NSString(string: profile.ssh.identityFile).expandingTildeInPath
    }

    static func sshOptions(_ profile: ConnectionProfile) -> [String] {
        [
            "-o", "ConnectTimeout=10",
            "-o", "UserKnownHostsFile=\(SupportLayout.knownHosts.path)",
            "-o", "StrictHostKeyChecking=yes",
            "-p", String(profile.ssh.port),
        ]
    }

    private static func runRemote(
        _ profile: ConnectionProfile,
        _ command: String,
        input: Data? = nil,
        timeout: TimeInterval
    ) async throws -> CommandResult {
        let identity = expandedIdentity(profile)
        guard FileManager.default.fileExists(atPath: identity) else {
            throw BootstrapError.missingKeyPair
        }
        return try await run(
            "/usr/bin/ssh",
            sshOptions(profile) + [
                "-o", "BatchMode=yes",
                "-o", "IdentitiesOnly=yes",
                "-i", identity,
                "\(profile.ssh.user)@\(profile.ssh.host)",
                command,
            ],
            input: input,
            timeout: timeout
        )
    }

    private static func classify(_ stderr: String, passwordLogin: Bool) -> SetupError {
        let value = stderr.lowercased()
        if value.contains("identification has changed") || value.contains("host key verification failed") {
            return .hostKeyChanged
        }
        if value.contains("permission denied") {
            if passwordLogin && !value.contains("password") && !value.contains("keyboard-interactive") {
                return .passwordLoginDisabled
            }
            return passwordLogin ? .wrongPassword : .keyRejected
        }
        if value.contains("timed out") || value.contains("refused")
            || value.contains("no route") || value.contains("could not resolve") {
            return .hostUnreachable
        }
        return .sshFailed
    }

    static func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    struct CommandResult {
        let status: Int32
        let output: String
        let errorOutput: String
    }

    static func run(
        _ executable: String,
        _ arguments: [String],
        input: Data? = nil,
        environment: [String: String]? = nil,
        timeout: TimeInterval
    ) async throws -> CommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let environment {
            process.environment = ProcessInfo.processInfo.environment.merging(environment) { $1 }
        }
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        let stdin = Pipe()
        process.standardInput = input == nil ? FileHandle.nullDevice : stdin

        return try await withCheckedThrowingContinuation { continuation in
            let group = DispatchGroup()
            var outputData = Data()
            var errorData = Data()
            group.enter()
            DispatchQueue.global().async {
                outputData = stdout.fileHandleForReading.readDataToEndOfFile()
                group.leave()
            }
            group.enter()
            DispatchQueue.global().async {
                errorData = stderr.fileHandleForReading.readDataToEndOfFile()
                group.leave()
            }
            group.enter()
            process.terminationHandler = { _ in group.leave() }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
                return
            }
            if let input {
                DispatchQueue.global().async {
                    try? stdin.fileHandleForWriting.write(contentsOf: input)
                    try? stdin.fileHandleForWriting.close()
                }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                if process.isRunning { process.terminate() }
            }
            group.notify(queue: .global()) {
                continuation.resume(
                    returning: CommandResult(
                        status: process.terminationStatus,
                        output: String(decoding: outputData, as: UTF8.self),
                        errorOutput: String(decoding: errorData, as: UTF8.self)
                    )
                )
            }
        }
    }
}

/// SSH_ASKPASS helper that hands the password to ssh through a 0600 FIFO inside a
/// 0700 directory under ~/.MyDGX/run, so the password is never written to disk.
private final class AskpassSecret: @unchecked Sendable {
    private static let maximumPrompts = 2

    let environment: [String: String]
    private let directory: URL
    private let fifo: URL
    private let lock = NSLock()
    private var cancelled = false

    init(_ password: String) throws {
        try SupportLayout.install()
        directory = SupportLayout.run.appendingPathComponent("askpass-\(UUID().uuidString)")
        fifo = directory.appendingPathComponent("secret")
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        let script = directory.appendingPathComponent("askpass")
        guard mkfifo(fifo.path, 0o600) == 0,
              FileManager.default.createFile(
                  atPath: script.path,
                  contents: Data("#!/bin/sh\nexec /bin/cat \(SparkSetup.shellQuote(fifo.path))\n".utf8),
                  attributes: [.posixPermissions: 0o700]
              ) else {
            try? FileManager.default.removeItem(at: directory)
            throw SetupError.sshFailed
        }
        environment = [
            "SSH_ASKPASS": script.path,
            "SSH_ASKPASS_REQUIRE": "force",
            "DISPLAY": ":0",
        ]
        let secret = Array((password + "\n").utf8)
        let path = fifo.path
        DispatchQueue.global().async { [self] in
            for _ in 0..<Self.maximumPrompts {
                guard !isCancelled else { return }
                let descriptor = open(path, O_WRONLY)
                guard descriptor >= 0 else { return }
                if isCancelled {
                    close(descriptor)
                    return
                }
                _ = secret.withUnsafeBytes { write(descriptor, $0.baseAddress, $0.count) }
                close(descriptor)
            }
        }
    }

    private var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func remove() {
        lock.lock()
        cancelled = true
        lock.unlock()
        // Unblocks a writer still waiting for a reader that will never come.
        let reader = open(fifo.path, O_RDONLY | O_NONBLOCK)
        if reader >= 0 { close(reader) }
        try? FileManager.default.removeItem(at: directory)
    }
}

private enum SSHBannerReader {
    static func read(host: String, port: Int) async -> String? {
        guard !host.isEmpty, let endpointPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
            return nil
        }
        return await withCheckedContinuation { continuation in
            let connection = NWConnection(host: NWEndpoint.Host(host), port: endpointPort, using: .tcp)
            let queue = DispatchQueue(label: "com.mydgx.tray.banner")
            let lock = NSLock()
            var finished = false
            func finish(_ value: String?) {
                lock.lock()
                defer { lock.unlock() }
                guard !finished else { return }
                finished = true
                connection.cancel()
                continuation.resume(returning: value)
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    connection.receive(minimumIncompleteLength: 4, maximumLength: 256) { data, _, _, _ in
                        let text = data.map { String(decoding: $0, as: UTF8.self) } ?? ""
                        let line = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
                        finish(line.hasPrefix("SSH-") ? line : nil)
                    }
                case .failed, .cancelled:
                    finish(nil)
                default:
                    break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 3) { finish(nil) }
        }
    }
}

enum SetupError: LocalizedError {
    case hostUnreachable
    case hostKeyChanged
    case wrongPassword
    case passwordRequired
    case passwordLoginDisabled
    case keyRejected
    case wrongSudoPassword
    case sshFailed
    case deployFailed(String)
    case notPrivateKey
    case publicKeyChosen
    case passphraseRequired
    case wrongPassphrase
    case ownKeyNotAuthorized

    var errorDescription: String? {
        switch self {
        case .hostUnreachable:
            return String(localized: "No se pudo contactar con el Spark. Comprueba que está encendido y en la misma red.")
        case .hostKeyChanged:
            return String(localized: "La identidad del equipo no coincide con la guardada y no se ha sustituido. Si es un alquiler nuevo o lo has reinstalado, vuelve a conectar y confirma la huella nueva.")
        case .wrongPassword:
            return String(localized: "Usuario o contraseña incorrectos.")
        case .passwordRequired:
            return String(localized: "Escribe la contraseña del Spark para autorizar este Mac la primera vez.")
        case .passwordLoginDisabled:
            return String(localized: "El Spark no acepta contraseña por SSH. Elige tu clave SSH en «Ya tengo una clave».")
        case .keyRejected:
            return String(localized: "El Spark no aceptó la clave SSH. Escribe la contraseña para instalar una nueva.")
        case .wrongSudoPassword:
            return String(localized: "La contraseña no permite administrar el Spark (sudo). Revisa la contraseña.")
        case .sshFailed:
            return String(localized: "No se pudo completar la conexión SSH.")
        case .deployFailed(let detail):
            return detail
        case .notPrivateKey:
            return String(localized: "Ese archivo no es una clave SSH privada. Elige, por ejemplo, ~/.ssh/id_ed25519.")
        case .publicKeyChosen:
            return String(localized: "Has elegido la clave pública (.pub). Elige el archivo sin extensión, que es la clave privada.")
        case .passphraseRequired:
            return String(localized: "Tu clave está protegida con una frase de paso. Escríbela para desbloquearla; se guardará en el Llavero de macOS.")
        case .wrongPassphrase:
            return String(localized: "La frase de paso de la clave no es correcta.")
        case .ownKeyNotAuthorized:
            return String(localized: "El Spark aún no acepta tu clave. Escribe la contraseña del Spark para autorizarla.")
        }
    }
}

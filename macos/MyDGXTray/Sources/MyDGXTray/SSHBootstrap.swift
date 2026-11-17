import AppKit
import Foundation

enum SSHBootstrap {
    struct DetectedDevice {
        let model: String
        let variant: String
    }

    static let officialSetupURL = URL(
        string: "https://docs.nvidia.com/dgx/dgx-spark/first-boot.html"
    )!

    static func generateKeyPair(profileID: String, alias: String) throws -> String {
        try SupportLayout.install()
        let privateKey = SupportLayout.keys.appendingPathComponent(profileID)
        let publicKey = URL(fileURLWithPath: "\(privateKey.path).pub")
        if FileManager.default.fileExists(atPath: privateKey.path),
           FileManager.default.fileExists(atPath: publicKey.path) {
            try secureKeyPermissions(privateKey: privateKey, publicKey: publicKey)
            return privateKey.path
        }
        guard !FileManager.default.fileExists(atPath: privateKey.path),
              !FileManager.default.fileExists(atPath: publicKey.path) else {
            throw BootstrapError.incompleteKeyPair
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh-keygen")
        process.arguments = [
            "-q",
            "-t", "ed25519",
            "-a", "64",
            "-N", "",
            "-C", "MyDGX \(alias)",
            "-f", privateKey.path,
        ]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw BootstrapError.keyGenerationFailed
        }
        try secureKeyPermissions(privateKey: privateKey, publicKey: publicKey)
        return privateKey.path
    }

    static func openPublicKeyInstaller(profile: ConnectionProfile) throws {
        try profile.validate()
        let privateKey = URL(
            fileURLWithPath: NSString(string: profile.ssh.identityFile).expandingTildeInPath
        )
        let publicKey = URL(fileURLWithPath: "\(privateKey.path).pub")
        guard FileManager.default.fileExists(atPath: privateKey.path),
              FileManager.default.fileExists(atPath: publicKey.path) else {
            throw BootstrapError.missingKeyPair
        }
        try SupportLayout.install()

        let scriptURL = SupportLayout.bin
            .appendingPathComponent("bootstrap-\(profile.id).command")
        let script = """
        #!/bin/zsh
        set -euo pipefail
        print "Instalando la clave pública de MyDGX en \(shellQuote(profile.alias))."
        print "SSH solicitará una sola vez la contraseña creada durante el primer arranque."
        /usr/bin/cat \(shellQuote(publicKey.path)) | /usr/bin/ssh \
          -o \(shellQuote("UserKnownHostsFile=\(SupportLayout.knownHosts.path)")) \
          -o StrictHostKeyChecking=accept-new \
          -o PubkeyAuthentication=no \
          -o PreferredAuthentications=keyboard-interactive,password \
          -p \(profile.ssh.port) \
          \(shellQuote("\(profile.ssh.user)@\(profile.ssh.host)")) \
          'umask 077; mkdir -p "$HOME/.ssh"; touch "$HOME/.ssh/authorized_keys"; key="$(cat)"; grep -qxF "$key" "$HOME/.ssh/authorized_keys" || printf "%s\\n" "$key" >> "$HOME/.ssh/authorized_keys"; chmod 700 "$HOME/.ssh"; chmod 600 "$HOME/.ssh/authorized_keys"'
        print
        print "Clave pública instalada. Ya puedes volver a MyDGX y pulsar Verificar."
        print -n "Pulsa una tecla para cerrar…"
        read -k 1
        print
        """
        try Data(script.utf8).write(to: scriptURL, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: scriptURL.path
        )
        NSWorkspace.shared.open(scriptURL)
    }

    static func verify(profile: ConnectionProfile) async throws {
        try profile.validate()
        let privateKey = NSString(string: profile.ssh.identityFile).expandingTildeInPath
        guard FileManager.default.fileExists(atPath: privateKey) else {
            throw BootstrapError.missingKeyPair
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        process.arguments = [
            "-o", "BatchMode=yes",
            "-o", "IdentitiesOnly=yes",
            "-o", "ConnectTimeout=10",
            "-o", "UserKnownHostsFile=\(SupportLayout.knownHosts.path)",
            "-o", "StrictHostKeyChecking=accept-new",
            "-i", privateKey,
            "-p", String(profile.ssh.port),
            "\(profile.ssh.user)@\(profile.ssh.host)",
            "true",
        ]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        let status: Int32 = try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = {
                continuation.resume(returning: $0.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
        guard status == 0 else {
            throw BootstrapError.verificationFailed
        }
    }

    static func detectDevice(profile: ConnectionProfile) async throws -> DetectedDevice? {
        try profile.validate()
        let privateKey = NSString(string: profile.ssh.identityFile).expandingTildeInPath
        guard FileManager.default.fileExists(atPath: privateKey) else {
            throw BootstrapError.missingKeyPair
        }
        let output = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        process.arguments = [
            "-o", "BatchMode=yes",
            "-o", "IdentitiesOnly=yes",
            "-o", "ConnectTimeout=10",
            "-o", "UserKnownHostsFile=\(SupportLayout.knownHosts.path)",
            "-o", "StrictHostKeyChecking=accept-new",
            "-i", privateKey,
            "-p", String(profile.ssh.port),
            "\(profile.ssh.user)@\(profile.ssh.host)",
            "cat /sys/devices/virtual/dmi/id/sys_vendor 2>/dev/null || true; "
                + "printf '\\n'; "
                + "cat /sys/devices/virtual/dmi/id/product_name 2>/dev/null || true",
        ]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        let status: Int32 = try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = {
                continuation.resume(returning: $0.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
        guard status == 0 else { return nil }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let lines = String(decoding: data, as: UTF8.self)
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard let model = lines.last, !model.isEmpty else { return nil }
        let evidence = lines.joined(separator: " ").lowercased()
        let variant: String
        if evidence.contains("asus") || evidence.contains("gx10") {
            variant = "asus"
        } else if evidence.contains("lenovo") || evidence.contains("pgx") {
            variant = "lenovo"
        } else if evidence.contains("hp") || evidence.contains("zgx") {
            variant = "hp"
        } else if evidence.contains("nvidia") || evidence.contains("dgx spark") {
            variant = "nvidia"
        } else {
            variant = "other"
        }
        return DetectedDevice(model: String(model.prefix(160)), variant: variant)
    }

    static func fetchDashboardAPIKey(
        profile: ConnectionProfile,
        remoteDirectory: String
    ) async throws -> String? {
        try profile.validate()
        let privateKey = NSString(string: profile.ssh.identityFile).expandingTildeInPath
        guard FileManager.default.fileExists(atPath: privateKey) else {
            throw BootstrapError.missingKeyPair
        }
        let output = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        let envPath = "\(remoteDirectory)/.env"
        let remoteCommand = """
        python3 - \(shellQuote(envPath)) <<'PY'
        import pathlib
        import sys
        path = pathlib.Path(sys.argv[1]).expanduser()
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("MYDGX_API_KEY="):
                print(line.split("=", 1)[1].strip().strip("'\\\""), end="")
                break
        PY
        """
        process.arguments = [
            "-o", "BatchMode=yes",
            "-o", "IdentitiesOnly=yes",
            "-o", "ConnectTimeout=10",
            "-o", "UserKnownHostsFile=\(SupportLayout.knownHosts.path)",
            "-o", "StrictHostKeyChecking=yes",
            "-i", privateKey,
            "-p", String(profile.ssh.port),
            "\(profile.ssh.user)@\(profile.ssh.host)",
            remoteCommand,
        ]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        let status: Int32 = try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = {
                continuation.resume(returning: $0.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
        guard status == 0 else { return nil }
        let value = String(
            decoding: output.fileHandleForReading.readDataToEndOfFile(),
            as: UTF8.self
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: #"^[A-Za-z0-9_-]{32,256}$"#, options: .regularExpression) != nil else {
            return nil
        }
        return value
    }

    private static func secureKeyPermissions(privateKey: URL, publicKey: URL) throws {
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: privateKey.path
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o644],
            ofItemAtPath: publicKey.path
        )
    }

    private static func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }
}

enum BootstrapError: LocalizedError {
    case incompleteKeyPair
    case keyGenerationFailed
    case missingKeyPair
    case verificationFailed

    var errorDescription: String? {
        switch self {
        case .incompleteKeyPair:
            return "Existe solo una parte del par de claves. Retírala o completa el par antes de continuar."
        case .keyGenerationFailed:
            return "No se pudo generar el par de claves Ed25519."
        case .missingKeyPair:
            return "Genera primero el par de claves SSH."
        case .verificationFailed:
            return "No se pudo entrar mediante clave pública. Revisa host, usuario, red e instalación de la clave."
        }
    }
}

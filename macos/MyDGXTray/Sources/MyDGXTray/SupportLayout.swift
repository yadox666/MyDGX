import Foundation

enum SupportLayout {
    static let root = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".MyDGX", isDirectory: true)
    static let keys = root.appendingPathComponent("keys", isDirectory: true)
    static let credentials = root.appendingPathComponent("credentials", isDirectory: true)
    static let certificates = root.appendingPathComponent("certificates", isDirectory: true)
    static let bin = root.appendingPathComponent("bin", isDirectory: true)
    static let logs = root.appendingPathComponent("logs", isDirectory: true)
    static let backups = root.appendingPathComponent("backups", isDirectory: true)
    static let run = root.appendingPathComponent("run", isDirectory: true)
    static let source = root.appendingPathComponent("source", isDirectory: true)
    static let knownHosts = root.appendingPathComponent("known_hosts")

    /// The MyDGX project shipped inside the app by package-release.sh, if any.
    static var bundledSource: URL? {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("MyDGX-Dashboard", isDirectory: true),
              isDeploySource(url.path) else {
            return nil
        }
        return url
    }

    static var bundledSourceVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    static func isDeploySource(_ path: String) -> Bool {
        var isDirectory: ObjCBool = false
        return !path.isEmpty
            && FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory)
            && isDirectory.boolValue
            && FileManager.default.isExecutableFile(atPath: "\(path)/start.sh")
    }

    /// Copies the bundled project to ~/.MyDGX/source so deployments never run
    /// from the signed (and possibly translocated, read-only) app bundle.
    static func stageBundledSource() throws -> URL {
        guard let bundled = bundledSource else {
            throw CocoaError(.fileNoSuchFile)
        }
        try install()
        let staging = root.appendingPathComponent(".source-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: staging) }
        try FileManager.default.copyItem(at: bundled, to: staging)
        if FileManager.default.fileExists(atPath: source.path) {
            try FileManager.default.removeItem(at: source)
        }
        try FileManager.default.moveItem(at: staging, to: source)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: source.path)
        return source
    }

    static func sessionKnownHosts(profileID: String) -> URL {
        let safeID = profileID.replacingOccurrences(
            of: #"[^A-Za-z0-9_-]"#,
            with: "_",
            options: .regularExpression
        )
        return run.appendingPathComponent("known-hosts-\(safeID.prefix(48))")
    }

    static func install() throws {
        for directory in [root, keys, credentials, certificates, bin, logs, backups, run] {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: directory.path
            )
        }
        if !FileManager.default.fileExists(atPath: knownHosts.path) {
            try Data().write(to: knownHosts, options: .atomic)
        }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: knownHosts.path
        )
        try installScript(name: "mydgx-ssh", contents: sshScript)
        try installScript(name: "mydgx-tunnel", contents: tunnelScript)
        try installScript(name: "mydgx-deploy", contents: deployScript)
    }

    private static func installScript(name: String, contents: String) throws {
        let url = bin.appendingPathComponent(name)
        let data = Data(contents.utf8)
        if (try? Data(contentsOf: url)) != data {
            try data.write(to: url, options: .atomic)
        }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: url.path
        )
    }

    private static let sshScript = """
    #!/bin/zsh
    set -euo pipefail
    exec /usr/bin/ssh \
      -o "UserKnownHostsFile=$HOME/.MyDGX/known_hosts" \
      -o StrictHostKeyChecking=accept-new \
      "$@"
    """

    private static let tunnelScript = """
    #!/bin/zsh
    set -euo pipefail
    if (( $# < 8 )); then
      print -u2 "Uso: mydgx-tunnel host ssh_port user identity local_api remote_api local_web remote_web"
      exit 2
    fi
    host="$1"; ssh_port="$2"; user="$3"; identity="$4"
    local_api="$5"; remote_api="$6"; local_web="$7"; remote_web="$8"
    exec "$HOME/.MyDGX/bin/mydgx-ssh" \
      -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -i "$identity" -p "$ssh_port" \
      -L "${local_api}:127.0.0.1:${remote_api}" \
      -L "${local_web}:127.0.0.1:${remote_web}" \
      "${user}@${host}"
    """

    private static let deployScript = """
    #!/bin/zsh
    set -euo pipefail
    if (( $# < 6 )); then
      print -u2 "Uso: mydgx-deploy source host ssh_port user identity remote_dir"
      exit 2
    fi
    source_dir="$1"; host="$2"; ssh_port="$3"; user="$4"; identity="$5"; remote_dir="$6"
    [[ -d "$source_dir" && "$ssh_port" == <-> && "$remote_dir" != /* && "$remote_dir" != *..* ]] || exit 2
    ssh_command="/usr/bin/ssh -o UserKnownHostsFile=$HOME/.MyDGX/known_hosts -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -i ${(q)identity} -p ${(q)ssh_port}"
    /usr/bin/rsync -az --delete \
      --exclude=.env --exclude=.venv/ --exclude=frontend/node_modules/ \
      --exclude=frontend/dist/ --exclude=data/ --exclude=logs/ \
      --exclude=macos/MyDGXTray/.build/ --exclude=macos/MyDGXTray/dist/ \
      -e "$ssh_command" "$source_dir/" "$user@$host:$remote_dir/"
    exec "$HOME/.MyDGX/bin/mydgx-ssh" -i "$identity" -p "$ssh_port" "$user@$host" \
      "cd ${(q)remote_dir} && chmod +x start.sh && ./start.sh setup && ./start.sh restart"
    """
}

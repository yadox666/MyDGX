import AppKit
import CryptoKit
import Foundation

/// Finds MyDGXTray releases (tags `tray-v*`) on GitHub and replaces the running app.
@MainActor
final class AppUpdater: ObservableObject {
    static let shared = AppUpdater()
    static let repository = "yadox666/MyDGX"

    struct Release: Equatable {
        let version: String
        let tag: String
        let pageURL: URL
        let archiveURL: URL
        let archiveName: String
        let checksumURL: URL
    }

    enum State: Equatable {
        case idle
        case checking
        case upToDate
        case available(Release)
        case downloading(Double)
        case installing
        case failed(String)
    }

    @Published private(set) var state = State.idle
    @Published private(set) var lastChecked: Date?
    private var periodicTask: Task<Void, Never>?

    var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    var availableRelease: Release? {
        if case .available(let release) = state { return release }
        return nil
    }

    var isBusy: Bool {
        switch state {
        case .checking, .downloading, .installing: return true
        default: return false
        }
    }

    func startPeriodicChecks() {
        guard periodicTask == nil else { return }
        periodicTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            while !Task.isCancelled {
                await self?.check()
                try? await Task.sleep(nanoseconds: 24 * 3_600_000_000_000)
            }
        }
    }

    func loadDemoUpdate() {
        let base = "https://github.com/\(Self.repository)/releases"
        guard let page = URL(string: "\(base)/tag/tray-v0.4.0"),
              let archive = URL(string: "\(base)/download/tray-v0.4.0/MyDGXTray-0.4.0-macos-universal.zip"),
              let checksum = URL(string: "\(archive.absoluteString).sha256") else { return }
        lastChecked = Date()
        state = .available(Release(
            version: "0.4.0", tag: "tray-v0.4.0", pageURL: page, archiveURL: archive,
            archiveName: archive.lastPathComponent, checksumURL: checksum
        ))
    }

    func checkIfStale() {
        guard !isBusy else { return }
        if let lastChecked, Date().timeIntervalSince(lastChecked) < 3600 { return }
        Task { await check() }
    }

    func check() async {
        guard !isBusy else { return }
        state = .checking
        do {
            let release = try await Self.newestRelease()
            lastChecked = Date()
            if let release, Self.compare(release.version, currentVersion) == .orderedDescending {
                state = .available(release)
            } else {
                state = .upToDate
            }
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    /// Downloads, verifies and swaps the app bundle, then relaunches it.
    func install(_ release: Release) async {
        guard !isBusy else { return }
        do {
            let target = Bundle.main.bundleURL
            guard target.pathExtension == "app",
                  FileManager.default.isWritableFile(atPath: target.deletingLastPathComponent().path) else {
                throw UpdateError.notWritable(target.deletingLastPathComponent().path)
            }
            try SupportLayout.install()
            let work = SupportLayout.run.appendingPathComponent("update-\(UUID().uuidString)")
            try FileManager.default.createDirectory(
                at: work,
                withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700]
            )
            state = .downloading(0)
            let checksumText = try await Self.fetchText(release.checksumURL)
            guard let expected = checksumText.split(whereSeparator: \.isWhitespace).first.map(String.init),
                  expected.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil else {
                throw UpdateError.badChecksumFile
            }
            let archive = work.appendingPathComponent(release.archiveName)
            let digest = try await download(release.archiveURL, to: archive)
            guard digest == expected else {
                try? FileManager.default.removeItem(at: work)
                throw UpdateError.checksumMismatch
            }

            state = .installing
            let unpacked = work.appendingPathComponent("unpacked", isDirectory: true)
            try await Self.run("/usr/bin/ditto", ["-x", "-k", archive.path, unpacked.path])
            let newApp = unpacked.appendingPathComponent("MyDGXTray.app", isDirectory: true)
            try Self.validate(newApp, expectedVersion: release.version)
            try await Self.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", newApp.path])

            try relaunch(replacing: target, with: newApp, work: work)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func download(_ url: URL, to destination: URL) async throws -> String {
        var request = URLRequest(url: url)
        request.setValue("MyDGXTray/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw UpdateError.downloadFailed }
        let expectedLength = max(response.expectedContentLength, 1)
        FileManager.default.createFile(atPath: destination.path, contents: nil, attributes: [.posixPermissions: 0o600])
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }
        var hasher = SHA256()
        var buffer = Data()
        buffer.reserveCapacity(1 << 16)
        var received: Int64 = 0
        for try await byte in bytes {
            buffer.append(byte)
            if buffer.count >= 1 << 16 {
                hasher.update(data: buffer)
                try handle.write(contentsOf: buffer)
                received += Int64(buffer.count)
                buffer.removeAll(keepingCapacity: true)
                state = .downloading(min(1, Double(received) / Double(expectedLength)))
            }
        }
        hasher.update(data: buffer)
        try handle.write(contentsOf: buffer)
        state = .downloading(1)
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func relaunch(replacing target: URL, with newApp: URL, work: URL) throws {
        let fileManager = FileManager.default
        var trashed: NSURL?
        try fileManager.trashItem(at: target, resultingItemURL: &trashed)
        do {
            try fileManager.moveItem(at: newApp, to: target)
        } catch {
            if let trashed = trashed as URL? {
                try? fileManager.removeItem(at: target)
                try? fileManager.moveItem(at: trashed, to: target)
            }
            throw error
        }
        try? fileManager.removeItem(at: work)

        var openArguments = ["-n"]
        if let fixedHome = ProcessInfo.processInfo.environment["CFFIXED_USER_HOME"] {
            openArguments += ["--env", "HOME=\(fixedHome)", "--env", "CFFIXED_USER_HOME=\(fixedHome)"]
        }
        let script = """
        pid="$1"; shift
        while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
        exec /usr/bin/open "$@"
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script, "mydgx-update", String(ProcessInfo.processInfo.processIdentifier)]
            + openArguments + [target.path]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        NSApp.terminate(nil)
    }

    // MARK: GitHub

    private static func newestRelease() async throws -> Release? {
        guard let url = URL(string: "https://api.github.com/repos/\(repository)/releases?per_page=30") else {
            return nil
        }
        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("MyDGXTray", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw UpdateError.githubUnavailable }
        let releases = try JSONDecoder().decode([GitHubRelease].self, from: data)
        return releases
            .filter { !$0.draft && !$0.prerelease && $0.tagName.hasPrefix("tray-v") }
            .compactMap { release -> Release? in
                let version = String(release.tagName.dropFirst("tray-v".count))
                let name = "MyDGXTray-\(version)-macos-universal.zip"
                guard version.range(of: #"^\d+(\.\d+){1,3}$"#, options: .regularExpression) != nil,
                      let archive = release.assets.first(where: { $0.name == name }),
                      let checksum = release.assets.first(where: { $0.name == "\(name).sha256" }),
                      let page = URL(string: release.htmlURL),
                      let archiveURL = URL(string: archive.browserDownloadURL),
                      let checksumURL = URL(string: checksum.browserDownloadURL),
                      [archiveURL, checksumURL, page].allSatisfy({ $0.scheme == "https" }) else {
                    return nil
                }
                return Release(
                    version: version, tag: release.tagName, pageURL: page,
                    archiveURL: archiveURL, archiveName: name, checksumURL: checksumURL
                )
            }
            .max { compare($0.version, $1.version) == .orderedAscending }
    }

    private static func fetchText(_ url: URL) async throws -> String {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count < 4096 else {
            throw UpdateError.badChecksumFile
        }
        return String(decoding: data, as: UTF8.self)
    }

    static func compare(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let left = lhs.split(separator: ".").map { Int($0) ?? 0 }
        let right = rhs.split(separator: ".").map { Int($0) ?? 0 }
        for index in 0..<max(left.count, right.count) {
            let a = index < left.count ? left[index] : 0
            let b = index < right.count ? right[index] : 0
            if a != b { return a < b ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }

    private static func validate(_ app: URL, expectedVersion: String) throws {
        guard let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist")),
              info["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
              info["CFBundleShortVersionString"] as? String == expectedVersion,
              FileManager.default.isExecutableFile(
                  atPath: app.appendingPathComponent("Contents/MacOS/MyDGXTray").path
              ) else {
            throw UpdateError.invalidBundle
        }
    }

    private static func run(_ executable: String, _ arguments: [String]) async throws {
        let result = try await SparkSetup.run(executable, arguments, timeout: 120)
        guard result.status == 0 else { throw UpdateError.invalidBundle }
    }

    private struct GitHubRelease: Decodable {
        let tagName: String
        let htmlURL: String
        let draft: Bool
        let prerelease: Bool
        let assets: [Asset]

        struct Asset: Decodable {
            let name: String
            let browserDownloadURL: String

            enum CodingKeys: String, CodingKey {
                case name
                case browserDownloadURL = "browser_download_url"
            }
        }

        enum CodingKeys: String, CodingKey {
            case tagName = "tag_name"
            case htmlURL = "html_url"
            case draft, prerelease, assets
        }
    }
}

enum UpdateError: LocalizedError {
    case githubUnavailable
    case downloadFailed
    case badChecksumFile
    case checksumMismatch
    case invalidBundle
    case notWritable(String)

    var errorDescription: String? {
        switch self {
        case .githubUnavailable:
            return "No se pudo consultar GitHub. Comprueba la conexión a Internet."
        case .downloadFailed:
            return "No se pudo descargar la actualización."
        case .badChecksumFile:
            return "La release no tiene un checksum SHA-256 válido."
        case .checksumMismatch:
            return "La descarga no coincide con su checksum SHA-256; se ha descartado."
        case .invalidBundle:
            return "El paquete descargado no es una MyDGXTray válida y firmada."
        case .notWritable(let path):
            return "No se puede escribir en \(path). Mueve MyDGXTray a Aplicaciones y vuelve a intentarlo."
        }
    }
}

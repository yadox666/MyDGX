import AppKit
import Foundation

/// The app's language override, stored as this app's `AppleLanguages` default —
/// the same per-app setting macOS writes from System Settings → Language & Region → Applications.
/// Spanish is the source language; any system language other than Spanish falls back to English.
enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case spanish = "es"
    case english = "en"

    private static let defaultsKey = "AppleLanguages"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system:
            return String(localized: "Idioma del sistema (\(AppLanguage.systemLanguageName))")
        case .spanish:
            return "Español"
        case .english:
            return "English"
        }
    }

    /// Override saved for this app only, ignoring the global language list.
    static var selected: AppLanguage {
        guard let identifier = Bundle.main.bundleIdentifier,
              let languages = UserDefaults.standard.persistentDomain(forName: identifier)?[defaultsKey] as? [String],
              let first = languages.first else {
            return .system
        }
        if first.hasPrefix("es") { return .spanish }
        if first.hasPrefix("en") { return .english }
        return .system
    }

    /// Language the running process is actually showing.
    static var active: AppLanguage {
        Bundle.main.preferredLocalizations.first?.hasPrefix("en") == true ? .english : .spanish
    }

    /// Language this choice shows: for `.system`, the first Spanish or English entry
    /// in the user's macOS language list, as Bundle resolves it; English otherwise.
    var effective: AppLanguage {
        guard self == .system else { return self }
        let global = UserDefaults.standard.persistentDomain(forName: UserDefaults.globalDomain)?[Self.defaultsKey] as? [String]
            ?? Locale.preferredLanguages
        let match = global.first { $0.hasPrefix("es") || $0.hasPrefix("en") }
        return match?.hasPrefix("es") == true ? .spanish : .english
    }

    private static var systemLanguageName: String {
        let code = AppLanguage.system.effective.rawValue
        return Locale.current.localizedString(forLanguageCode: code)?.capitalized ?? code
    }

    /// Saves the override; it takes effect the next time the app starts.
    func save() {
        if self == .system {
            UserDefaults.standard.removeObject(forKey: Self.defaultsKey)
        } else {
            UserDefaults.standard.set([rawValue], forKey: Self.defaultsKey)
        }
        UserDefaults.standard.synchronize()
    }

    /// Reopens the app once this process has exited; the SSH tunnel and configuration survive.
    static func relaunch() {
        let script = """
        pid="$1"; shift
        while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
        exec /usr/bin/open "$@"
        """
        var openArguments = ["-n"]
        if let fixedHome = ProcessInfo.processInfo.environment["CFFIXED_USER_HOME"] {
            openArguments += ["--env", "HOME=\(fixedHome)", "--env", "CFFIXED_USER_HOME=\(fixedHome)"]
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script, "mydgx-language", String(ProcessInfo.processInfo.processIdentifier)]
            + openArguments + [Bundle.main.bundlePath]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            NSApp.terminate(nil)
        } catch {
            NSSound.beep()
        }
    }
}

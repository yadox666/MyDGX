import Foundation

enum CredentialStore {
    private static let lock = NSLock()
    private static var cachedValues: [String: String] = [:]
    private static var loadedAccounts = Set<String>()

    static func read(account: String) throws -> String? {
        lock.lock()
        if loadedAccounts.contains(account) {
            let value = cachedValues[account]
            lock.unlock()
            return value
        }
        lock.unlock()
        let url = try credentialURL(account: account)
        guard FileManager.default.fileExists(atPath: url.path) else {
            cache(nil, account: account)
            return nil
        }
        guard (try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)) == nil else {
            throw CredentialStoreError.symbolicLink
        }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        let value = try String(contentsOf: url, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        cache(value, account: account)
        return value
    }

    static func write(_ value: String, account: String) throws {
        lock.lock()
        let unchanged = loadedAccounts.contains(account) && cachedValues[account] == value
        lock.unlock()
        if unchanged { return }
        guard !value.isEmpty else {
            try delete(account: account)
            return
        }
        let url = try credentialURL(account: account)
        if FileManager.default.fileExists(atPath: url.path),
           (try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)) != nil {
            throw CredentialStoreError.symbolicLink
        }
        try Data((value + "\n").utf8).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        cache(value, account: account)
    }

    static func delete(account: String) throws {
        let url = try credentialURL(account: account)
        if FileManager.default.fileExists(atPath: url.path) {
            guard (try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)) == nil else {
                throw CredentialStoreError.symbolicLink
            }
            try FileManager.default.removeItem(at: url)
        }
        cache(nil, account: account)
    }

    private static func credentialURL(account: String) throws -> URL {
        guard account.range(
            of: #"^[A-Za-z0-9._-]{1,128}$"#,
            options: .regularExpression
        ) != nil else {
            throw CredentialStoreError.invalidAccount
        }
        try SupportLayout.install()
        return SupportLayout.credentials.appendingPathComponent("\(account).api-key")
    }

    private static func cache(_ value: String?, account: String) {
        lock.lock()
        defer { lock.unlock() }
        loadedAccounts.insert(account)
        cachedValues[account] = value
    }
}

enum CredentialStoreError: LocalizedError {
    case invalidAccount
    case symbolicLink

    var errorDescription: String? {
        switch self {
        case .invalidAccount:
            return String(localized: "El identificador de la credencial no es válido.")
        case .symbolicLink:
            return String(localized: "La credencial no puede ser un enlace simbólico.")
        }
    }
}

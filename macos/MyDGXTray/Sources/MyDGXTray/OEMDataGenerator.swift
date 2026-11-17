import Foundation

enum OEMDataGenerator {
    static let officialGuide = URL(
        string: "https://docs.nvidia.com/dgx/dgx-spark/enterprise-custom-install.html"
    )!

    static func writeSeed(to volume: URL) throws {
        let values = try volume.resourceValues(forKeys: [
            .isDirectoryKey,
            .isSymbolicLinkKey,
            .volumeIsReadOnlyKey,
            .volumeNameKey,
        ])
        guard values.isDirectory == true,
              values.isSymbolicLink != true,
              values.volumeIsReadOnly != true,
              (values.volumeName ?? volume.lastPathComponent).uppercased() == "OEMDATA" else {
            throw OEMDataError.invalidVolume
        }

        let metadata = """
        instance-id: mydgx-\(UUID().uuidString.lowercased())
        """
        let userData = """
        #cloud-config
        # MyDGX conserva el OOBE oficial y no crea usuarios ni credenciales.
        growpart:
          mode: 'off'
        no_ssh_fingerprints: true
        resize_rootfs: false
        preserve_hostname: true
        users: []
        """

        try write(metadata + "\n", named: "meta-data", to: volume)
        try write(userData + "\n", named: "user-data", to: volume)
    }

    private static func write(_ contents: String, named name: String, to volume: URL) throws {
        let destination = volume.appendingPathComponent(name, isDirectory: false)
        if FileManager.default.fileExists(atPath: destination.path) {
            let values = try destination.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else {
                throw OEMDataError.unsafeExistingFile(name)
            }
        }
        try Data(contents.utf8).write(to: destination, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o644],
            ofItemAtPath: destination.path
        )
    }
}

enum OEMDataError: LocalizedError {
    case invalidVolume
    case unsafeExistingFile(String)

    var errorDescription: String? {
        switch self {
        case .invalidVolume:
            return "Selecciona un volumen montado, escribible y etiquetado exactamente OEMDATA."
        case let .unsafeExistingFile(name):
            return "No se sobrescribirá \(name) porque no es un archivo regular seguro."
        }
    }
}

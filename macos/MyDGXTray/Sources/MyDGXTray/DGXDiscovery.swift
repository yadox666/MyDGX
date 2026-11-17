import Darwin
import Foundation

struct DiscoveredDGX: Identifiable, Equatable {
    let id: String
    let name: String
    let host: String
    let ipAddress: String?
    let port: Int
    let portVerified: Bool

    var connectionHost: String {
        ipAddress ?? host
    }
}

@MainActor
final class DGXDiscovery: NSObject, ObservableObject {
    @Published private(set) var devices: [DiscoveredDGX] = []
    @Published private(set) var searching = false

    private static let serviceTypes = ["_ssh._tcp.", "_sftp-ssh._tcp.", "_workstation._tcp."]
    private let browsers = serviceTypes.map { _ in NetServiceBrowser() }
    private var services: [String: NetService] = [:]

    override init() {
        super.init()
        browsers.forEach { $0.delegate = self }
    }

    func start() {
        guard !searching else { return }
        devices = []
        services = [:]
        searching = true
        for (browser, type) in zip(browsers, Self.serviceTypes) {
            browser.searchForServices(ofType: type, inDomain: "local.")
        }
    }

    func stop() {
        browsers.forEach { $0.stop() }
        searching = false
    }
}

extension DGXDiscovery: NetServiceBrowserDelegate, NetServiceDelegate {
    nonisolated func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didFind service: NetService,
        moreComing: Bool
    ) {
        Task { @MainActor in
            let key = "\(service.name).\(service.type)\(service.domain)"
            services[key] = service
            service.delegate = self
            service.resolve(withTimeout: 5)
        }
    }

    nonisolated func netServiceBrowserDidStopSearch(_ browser: NetServiceBrowser) {
        Task { @MainActor in searching = false }
    }

    nonisolated func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didNotSearch errorDict: [String: NSNumber]
    ) {
        Task { @MainActor in searching = false }
    }

    nonisolated func netServiceDidResolveAddress(_ sender: NetService) {
        Task { @MainActor in
            guard let hostname = sender.hostName?.trimmingCharacters(in: CharacterSet(charactersIn: ".")),
                  !hostname.isEmpty,
                  Self.looksLikeDGX(serviceName: sender.name, hostname: hostname) else {
                return
            }
            let addresses = Self.numericAddresses(sender.addresses)
            let ipAddress = addresses.first(where: { !$0.contains(":") }) ?? addresses.first
            let target = ipAddress ?? hostname
            let advertisesSSH = sender.type.contains("ssh")
            let advertisedPort = advertisesSSH && sender.port > 0 ? sender.port : 22
            async let advertisedAvailable = ProfileReachability.sshAvailable(
                host: target,
                port: advertisedPort
            )
            async let alternateAvailable = advertisedPort == 65_022
                ? false
                : ProfileReachability.sshAvailable(host: target, port: 65_022)
            let (advertisedWorks, alternateWorks) = await (
                advertisedAvailable,
                alternateAvailable
            )
            let reachablePort = advertisedWorks
                ? advertisedPort
                : (alternateWorks ? 65_022 : advertisedPort)
            let device = DiscoveredDGX(
                id: "\(hostname):\(reachablePort)",
                name: sender.name,
                host: hostname,
                ipAddress: ipAddress,
                port: reachablePort,
                portVerified: advertisedWorks || alternateWorks
            )
            if let index = devices.firstIndex(where: { $0.id == device.id }) {
                devices[index] = device
            } else {
                devices.append(device)
                devices.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            }
        }
    }

    private static func looksLikeDGX(serviceName: String, hostname: String) -> Bool {
        let value = "\(serviceName) \(hostname)".lowercased()
        return ["dgx", "spark", "nvidia", "gb10", "gx10", "ascent", "pgx", "zgx"]
            .contains { value.contains($0) }
    }

    private static func numericAddresses(_ addresses: [Data]?) -> [String] {
        (addresses ?? []).compactMap { data in
            data.withUnsafeBytes { bytes -> String? in
                guard let base = bytes.baseAddress?
                    .assumingMemoryBound(to: sockaddr.self) else {
                    return nil
                }
                var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                guard getnameinfo(
                    base,
                    socklen_t(data.count),
                    &buffer,
                    socklen_t(buffer.count),
                    nil,
                    0,
                    NI_NUMERICHOST
                ) == 0 else {
                    return nil
                }
                return String(cString: buffer)
            }
        }
    }
}

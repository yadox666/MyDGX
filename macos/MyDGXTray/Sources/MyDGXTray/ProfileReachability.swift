import Foundation
import Network

enum ProfileReachability {
    static func sshAvailable(host: String, port: Int) async -> Bool {
        guard !host.isEmpty,
              let networkPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
            return false
        }
        return await withCheckedContinuation { continuation in
            TCPProbe(
                host: NWEndpoint.Host(host),
                port: networkPort,
                continuation: continuation
            ).start()
        }
    }
}

private final class TCPProbe: @unchecked Sendable {
    private let connection: NWConnection
    private let queue = DispatchQueue(label: "com.mydgx.tray.reachability")
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Bool, Never>?
    private var completed = false

    init(
        host: NWEndpoint.Host,
        port: NWEndpoint.Port,
        continuation: CheckedContinuation<Bool, Never>
    ) {
        connection = NWConnection(host: host, port: port, using: .tcp)
        self.continuation = continuation
    }

    func start() {
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                self.finish(true)
            case .failed, .cancelled:
                self.finish(false)
            default:
                break
            }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 2) {
            self.finish(false)
        }
    }

    private func finish(_ reachable: Bool) {
        lock.lock()
        guard !completed else {
            lock.unlock()
            return
        }
        completed = true
        let pending = continuation
        continuation = nil
        lock.unlock()

        connection.stateUpdateHandler = nil
        connection.cancel()
        pending?.resume(returning: reachable)
    }
}

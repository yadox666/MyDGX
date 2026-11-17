import Foundation
import Security

final class MyDGXClient {
    private let configuration: MyDGXConfiguration
    private let session: URLSession
    private let apiKey: String?

    init(configuration: MyDGXConfiguration) throws {
        self.configuration = configuration
        apiKey = try CredentialStore.read(account: configuration.apiKeyAccount)
        let delegate = try CertificateDelegate(certificatePath: configuration.caCertificatePath)
        session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
    }

    func overview() async throws -> OverviewResponse {
        try await request(path: "/api/overview")
    }

    func profiles() async throws -> ProfilesResponse {
        try await request(path: "/api/profiles")
    }

    func health() async throws {
        let _: HealthResponse = try await request(path: "/api/health")
    }

    func activate(profileID: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/profiles/\(try safePathComponent(profileID))/activate",
            method: "POST"
        )
    }

    func start(profileID: String) async throws -> String {
        let response: JobStartResponse = try await request(
            path: "/api/profiles/\(try safePathComponent(profileID))/start",
            method: "POST"
        )
        return response.jobID
    }

    func runtimePlan(profileID: String) async throws -> ProfileRuntimePlan {
        try await request(
            path: "/api/profiles/\(try safePathComponent(profileID))/runtime-plan"
        )
    }

    func job(jobID: String) async throws -> JobStatus {
        try await request(path: "/api/jobs/\(try safePathComponent(jobID))")
    }

    func jobs() async throws -> [JobStatus] {
        try await request(path: "/api/jobs")
    }

    func stopProfile() async throws {
        let _: EmptyResponse = try await request(path: "/api/profiles/stop", method: "POST")
    }

    func stopProfile(profileID: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/profiles/\(try safePathComponent(profileID))/stop",
            method: "POST"
        )
    }

    func stopQuickModel(_ model: ProfileModelSummary) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "source": model.quickSource,
            "model_id": model.modelRef,
        ])
        let _: EmptyResponse = try await request(path: "/api/models/quick/stop", method: "POST", body: body)
    }

    private func request<T: Decodable>(
        path: String,
        method: String = "GET",
        body: Data? = nil
    ) async throws -> T {
        guard let baseURL = configuration.baseURL,
              let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw ClientError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("MyDGXTray", forHTTPHeaderField: "User-Agent")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let apiKey, !apiKey.isEmpty {
            request.setValue(apiKey, forHTTPHeaderField: "X-MyDGX-Key")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            let detail = (try? JSONDecoder().decode(APIError.self, from: data).detail)
            throw ClientError.http(httpResponse.statusCode, detail)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func safePathComponent(_ value: String) throws -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        guard !value.isEmpty, value.unicodeScalars.allSatisfy(allowed.contains) else {
            throw ClientError.invalidIdentifier
        }
        return value
    }
}

private final class CertificateDelegate: NSObject, URLSessionDelegate {
    private let certificate: SecCertificate?

    init(certificatePath: String) throws {
        if certificatePath.isEmpty {
            certificate = nil
        } else {
            let expandedPath = NSString(string: certificatePath).expandingTildeInPath
            let fileData = try Data(contentsOf: URL(fileURLWithPath: expandedPath))
            let derData: Data
            if let text = String(data: fileData, encoding: .utf8),
               text.contains("BEGIN CERTIFICATE") {
                let base64 = text
                    .replacingOccurrences(of: "-----BEGIN CERTIFICATE-----", with: "")
                    .replacingOccurrences(of: "-----END CERTIFICATE-----", with: "")
                    .components(separatedBy: .whitespacesAndNewlines)
                    .joined()
                guard let decoded = Data(base64Encoded: base64) else {
                    throw ClientError.invalidCertificate
                }
                derData = decoded
            } else {
                derData = fileData
            }
            guard let parsed = SecCertificateCreateWithData(nil, derData as CFData) else {
                throw ClientError.invalidCertificate
            }
            certificate = parsed
        }
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let certificate,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        SecTrustSetAnchorCertificates(trust, [certificate] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        var error: CFError?
        if SecTrustEvaluateWithError(trust, &error) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

private struct EmptyResponse: Decodable {}
private struct HealthResponse: Decodable {
    let status: String
}
private struct APIError: Decodable {
    let detail: String?
}

enum ClientError: LocalizedError {
    case invalidURL
    case invalidResponse
    case invalidIdentifier
    case invalidCertificate
    case http(Int, String?)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "La URL de MyDGX no es válida."
        case .invalidResponse:
            return "MyDGX devolvió una respuesta no válida."
        case .invalidIdentifier:
            return "El identificador del perfil no es válido."
        case .invalidCertificate:
            return "El certificado CA configurado no es válido."
        case let .http(code, detail):
            return detail ?? "MyDGX devolvió HTTP \(code)."
        }
    }
}

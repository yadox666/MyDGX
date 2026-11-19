import AppKit
import Combine
import Foundation
import Network

@MainActor
final class SparkSetupWizard: ObservableObject {
    enum Step: Int, CaseIterable {
        case find, connect, install, done

        var title: String {
            switch self {
            case .find: return String(localized: "Buscar")
            case .connect: return String(localized: "Conectar")
            case .install: return String(localized: "Instalar")
            case .done: return String(localized: "Listo")
            }
        }

        var symbol: String {
            switch self {
            case .find: return "dot.radiowaves.left.and.right"
            case .connect: return "key.fill"
            case .install: return "shippingbox.fill"
            case .done: return "checkmark.seal.fill"
            }
        }
    }

    struct Candidate: Identifiable, Equatable {
        var id: String { "\(host):\(port)" }
        let name: String
        let host: String
        let port: Int
        let systemHint: String?
        let guess: SparkSetup.DeviceGuess
    }

    enum TaskState: Equatable {
        case pending, running, done, skipped, failed
    }

    struct ChecklistItem: Identifiable, Equatable {
        let id: String
        let title: String
        var state: TaskState = .pending
    }

    struct InstallPhase: Identifiable, Equatable {
        let id: String
        let title: String
        let weight: Double
        let expectedSeconds: Double
        let markers: [String]
    }

    static let installPhases: [InstallPhase] = [
        InstallPhase(id: "connect", title: String(localized: "Conectar con el Spark"), weight: 2, expectedSeconds: 15,
                     markers: ["SSH disponible"]),
        InstallPhase(id: "copy", title: String(localized: "Copiar MyDGX"), weight: 4, expectedSeconds: 40,
                     markers: ["Sincronizando MyDGX"]),
        InstallPhase(id: "system", title: String(localized: "Preparar el sistema"), weight: 14, expectedSeconds: 240,
                     markers: ["Modo completo", "dependencias base", "Node.js", "CUDA Toolkit",
                               "Comprobando integridad", "módulos DKMS", "Reparando configuración"]),
        InstallPhase(id: "llama", title: String(localized: "Compilar el motor de IA"), weight: 34, expectedSeconds: 900,
                     markers: ["Recompilando llama.cpp"]),
        InstallPhase(id: "services", title: String(localized: "Instalar apps y servicios"), weight: 36, expectedSeconds: 900,
                     markers: ["Instalando Hashcat", "Instalando Ollama", "Docker y NVIDIA",
                               "Instalando MyDGX", "Whisper", "runtime TTS", "ComfyUI",
                               "Open WebUI", "SearXNG", "servicios systemd"]),
        InstallPhase(id: "start", title: String(localized: "Arrancar MyDGX"), weight: 5, expectedSeconds: 90,
                     markers: ["Comprobando preparación", "Descargando modelo local"]),
        InstallPhase(id: "verify", title: String(localized: "Comprobar la instalación"), weight: 2, expectedSeconds: 20,
                     markers: ["Versiones desplegadas", "Resumen final"]),
        InstallPhase(id: "link", title: String(localized: "Conectar este Mac"), weight: 3, expectedSeconds: 30,
                     markers: []),
    ]

    @Published var step: Step = .find
    @Published var errorMessage: String?

    // Step 1
    @Published private(set) var candidates: [Candidate] = []
    @Published var selectedID: String?
    @Published private(set) var searching = false
    @Published private(set) var searchProgress = 0.0
    @Published var manualAddress = ""
    @Published var manualPort = ""
    @Published private(set) var checkingAddress = false
    @Published private(set) var localNetworkDenied = false
    @Published private(set) var localNetworkPrimed = UserDefaults.standard.bool(forKey: SparkSetupWizard.primedKey)

    // Step 2
    @Published var user = ""
    @Published var password = ""
    @Published var useExistingKey = false
    @Published var existingKeyPath = ""
    @Published var keyPassphrase = ""
    @Published private(set) var existingKeyInfo: SparkSetup.PrivateKeyInfo?
    @Published private(set) var existingKeyUnlocked = false
    @Published private(set) var existingKeyError: String?
    @Published var alias = ""
    @Published private(set) var connectChecklist: [ChecklistItem] = []
    @Published private(set) var connecting = false
    @Published private(set) var hostFingerprint = ""
    @Published private(set) var facts: SparkSetup.SparkFacts?
    /// Profile that already points at this Spark; the assistant updates it instead of adding another.
    @Published private(set) var existingProfile: ConnectionProfile?

    // Step 3
    @Published private(set) var installing = false
    @Published private(set) var installFinished = false
    @Published private(set) var phaseIndex = 0
    @Published private(set) var phaseFraction = 0.0
    @Published private(set) var currentActivity = ""
    @Published private(set) var elapsedSeconds = 0
    @Published private(set) var logURL: URL?
    @Published var sudoPassword = ""

    let profileID = UUID().uuidString
    private static let primedKey = "SparkSetupLocalNetworkPrimed"
    private(set) var demoMode = false
    private var permissionBrowser: NWBrowser?
    private unowned let model: AppModel
    private let discovery = DGXDiscovery()
    private var cancellables = Set<AnyCancellable>()
    private var searchTask: Task<Void, Never>?
    private var installTask: Task<Void, Never>?
    private var deployProcess: Process?
    private var phaseStartedAt = Date()
    private var sleepActivity: NSObjectProtocol?
    private var lineBuffer = ""
    private var deploySucceeded = false

    init(model: AppModel) {
        self.model = model
        discovery.$devices
            .receive(on: RunLoop.main)
            .sink { [weak self] devices in self?.absorb(devices) }
            .store(in: &cancellables)
    }

    var isBusy: Bool { installing || connecting }

    var selected: Candidate? {
        candidates.first(where: { $0.id == selectedID })
    }

    var overallProgress: Double {
        let phases = Self.installPhases
        let total = phases.reduce(0) { $0 + $1.weight }
        if installFinished { return 1 }
        let completed = phases.prefix(phaseIndex).reduce(0) { $0 + $1.weight }
        return min(0.99, (completed + phases[phaseIndex].weight * phaseFraction) / total)
    }

    var detectedModel: String {
        if let facts { return "\(facts.device.brand) \(facts.device.model)" }
        if let selected { return "\(selected.guess.brand) \(selected.guess.model)" }
        return "DGX Spark"
    }

    var detectedVariant: String {
        facts?.device.variant ?? selected?.guess.variant ?? "nvidia"
    }

    var needsKeyPassphrase: Bool {
        useExistingKey && existingKeyInfo?.encrypted == true && !existingKeyUnlocked
    }

    var needsSudoPassword: Bool {
        guard let facts else { return false }
        return !facts.sudoWithoutPassword && password.isEmpty
    }

    // MARK: Step 1

    func startSearch() {
        guard !searching, !demoMode else { return }
        if !localNetworkPrimed {
            localNetworkPrimed = true
            UserDefaults.standard.set(true, forKey: Self.primedKey)
        }
        watchLocalNetworkPermission()
        errorMessage = nil
        searching = true
        searchProgress = 0
        discovery.start()
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            for tick in 1...40 {
                try? await Task.sleep(nanoseconds: 200_000_000)
                guard let self, !Task.isCancelled else { return }
                self.searchProgress = Double(tick) / 40
            }
            guard let self else { return }
            self.discovery.stop()
            self.searching = false
        }
    }

    /// NetServiceBrowser does not report a denied Local Network permission; NWBrowser does.
    private func watchLocalNetworkPermission() {
        permissionBrowser?.cancel()
        let browser = NWBrowser(for: .bonjour(type: "_ssh._tcp", domain: nil), using: .tcp)
        browser.stateUpdateHandler = { [weak self] state in
            var denied = false
            if case .waiting(let error) = state, case .dns(let code) = error,
               code == DNSServiceErrorType(kDNSServiceErr_PolicyDenied) {
                denied = true
            }
            Task { @MainActor in
                guard let self else { return }
                if denied {
                    self.localNetworkDenied = true
                } else if case .ready = state {
                    self.localNetworkDenied = false
                }
            }
        }
        browser.start(queue: .main)
        permissionBrowser = browser
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            self?.permissionBrowser?.cancel()
            self?.permissionBrowser = nil
        }
    }

    func openLocalNetworkSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork") {
            NSWorkspace.shared.open(url)
        }
    }

    func checkManualAddress() {
        let raw = manualAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        var host = raw
        var ports: [Int]?
        if let port = Int(manualPort.trimmingCharacters(in: .whitespaces)) {
            ports = [port]
        } else if raw.filter({ $0 == ":" }).count == 1,
                  let colon = raw.lastIndex(of: ":"),
                  let port = Int(raw[raw.index(after: colon)...]) {
            host = String(raw[..<colon])
            ports = [port]
        }
        guard host.range(of: #"^[A-Za-z0-9._:-]+$"#, options: .regularExpression) != nil else {
            errorMessage = String(localized: "Escribe una IP (192.168.1.50) o un nombre (spark-1a2b.local).")
            return
        }
        errorMessage = nil
        checkingAddress = true
        Task {
            defer { checkingAddress = false }
            guard let probe = await SparkSetup.probe(host: host, ports: ports) else {
                errorMessage = String(localized: "No hay respuesta SSH en \(host). Comprueba que el Spark está encendido y en tu red.")
                return
            }
            let candidate = Candidate(
                name: host,
                host: host,
                port: probe.port,
                systemHint: probe.systemHint,
                guess: SparkSetup.guessDevice(from: host)
            )
            upsert(candidate)
            selectedID = candidate.id
        }
    }

    private func absorb(_ devices: [DiscoveredDGX]) {
        for device in devices where !candidates.contains(where: { $0.host == device.connectionHost }) {
            Task {
                let probe = await SparkSetup.probe(host: device.connectionHost, ports: [device.port])
                guard probe != nil || device.portVerified else { return }
                let candidate = Candidate(
                    name: device.name,
                    host: device.connectionHost,
                    port: probe?.port ?? device.port,
                    systemHint: probe?.systemHint,
                    guess: SparkSetup.guessDevice(from: "\(device.name) \(device.host)")
                )
                upsert(candidate)
                if selectedID == nil { selectedID = candidate.id }
            }
        }
    }

    private func upsert(_ candidate: Candidate) {
        if let index = candidates.firstIndex(where: { $0.id == candidate.id }) {
            candidates[index] = candidate
        } else {
            candidates.append(candidate)
        }
    }

    func continueToConnect() {
        guard let selected else { return }
        if alias.isEmpty || candidates.contains(where: { suggestedAlias(for: $0) == alias }) {
            alias = suggestedAlias(for: selected)
        }
        searchTask?.cancel()
        discovery.stop()
        searching = false
        errorMessage = nil
        step = .connect
    }

    private func suggestedAlias(for candidate: Candidate) -> String {
        uniqueAlias("\(candidate.guess.brand) \(candidate.guess.model)")
    }

    // MARK: Step 2

    func connect() {
        guard let selected, !connecting else { return }
        let trimmedUser = user.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedUser.range(of: #"^[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil else {
            errorMessage = String(localized: "Escribe el usuario que creaste al encender el Spark por primera vez.")
            return
        }
        if useExistingKey && existingKeyPath.isEmpty {
            errorMessage = String(localized: "Elige el archivo de tu clave SSH privada.")
            return
        }
        if useExistingKey, let existingKeyError {
            errorMessage = existingKeyError
            return
        }
        user = trimmedUser
        errorMessage = nil
        connecting = true
        facts = nil
        connectChecklist = [
            ChecklistItem(id: "identity", title: String(localized: "Comprobar la identidad del Spark")),
            ChecklistItem(id: "key", title: useExistingKey ? String(localized: "Usar tu clave SSH") : String(localized: "Crear una clave segura para este Mac")),
            ChecklistItem(id: "authorize", title: String(localized: "Autorizar este Mac en el Spark")),
            ChecklistItem(id: "login", title: String(localized: "Entrar sin contraseña")),
            ChecklistItem(id: "inspect", title: String(localized: "Detectar equipo y sistema operativo")),
            ChecklistItem(id: "sudo", title: String(localized: "Comprobar permisos de administrador")),
        ]
        Task {
            defer { connecting = false }
            var current = "identity"
            do {
                var profile = buildProfile(for: selected)
                mark("identity", .running)
                let scan = try await SparkSetup.scanHostKeys(host: profile.ssh.host, port: profile.ssh.port)
                hostFingerprint = scan.fingerprint
                try await SparkSetup.trustHostKeys(scan.keys, host: profile.ssh.host, port: profile.ssh.port)
                mark("identity", .done)

                current = "key"
                mark("key", .running)
                var ownKey: SparkSetup.PrivateKeyInfo?
                if useExistingKey {
                    profile.ssh.identityFile = existingKeyPath
                    let info = try await SparkSetup.inspectPrivateKey(at: existingKeyPath)
                    existingKeyInfo = info
                    ownKey = info
                    if info.encrypted, !(await SparkSetup.agentHasKey(info.fingerprint)) {
                        guard !keyPassphrase.isEmpty else { throw SetupError.passphraseRequired }
                        try await SparkSetup.addKeyToAgent(path: existingKeyPath, passphrase: keyPassphrase)
                    }
                    existingKeyUnlocked = info.encrypted
                    keyPassphrase = ""
                } else {
                    profile.ssh.identityFile = try SSHBootstrap.generateKeyPair(
                        profileID: profileID,
                        alias: profile.alias
                    )
                }
                mark("key", .done)

                current = "authorize"
                mark("authorize", .running)
                if (try? await SparkSetup.verifyKeyAccess(profile: profile)) != nil {
                    mark("authorize", .skipped)
                } else if password.isEmpty {
                    throw useExistingKey ? SetupError.ownKeyNotAuthorized : SetupError.passwordRequired
                } else if let ownKey {
                    let publicKey = try await SparkSetup.publicKey(forPrivateKey: existingKeyPath, info: ownKey)
                    try await SparkSetup.installPublicKey(profile: profile, password: password, publicKey: publicKey)
                    mark("authorize", .done)
                } else {
                    try await SparkSetup.installPublicKey(profile: profile, password: password)
                    mark("authorize", .done)
                }

                current = "login"
                mark("login", .running)
                try await SparkSetup.verifyKeyAccess(profile: profile)
                mark("login", .done)

                current = "inspect"
                mark("inspect", .running)
                let inspected = try await SparkSetup.inspect(profile: profile)
                facts = inspected
                let guessedAlias = suggestedAlias(for: selected)
                let previousMatch = existingProfile
                existingProfile = await matchingProfile(
                    host: profile.ssh.host,
                    port: profile.ssh.port,
                    hostname: inspected.hostname,
                    fingerprints: scan.allFingerprints
                )
                if let existingProfile {
                    if alias == guessedAlias || alias.isEmpty || alias == previousMatch?.alias {
                        alias = existingProfile.alias
                    }
                } else if alias == guessedAlias || alias.isEmpty || alias == previousMatch?.alias {
                    alias = uniqueAlias("\(inspected.device.brand) \(inspected.device.model)")
                }
                mark("inspect", .done)

                current = "sudo"
                mark("sudo", .running)
                if inspected.sudoWithoutPassword {
                    mark("sudo", .done)
                } else if password.isEmpty {
                    mark("sudo", .skipped)
                } else if try await SparkSetup.checkSudo(profile: profile, password: password) {
                    mark("sudo", .done)
                } else {
                    throw SetupError.wrongSudoPassword
                }
                try? await Task.sleep(nanoseconds: 700_000_000)
                step = .install
            } catch {
                mark(current, .failed)
                errorMessage = error.localizedDescription
            }
        }
    }

    private func mark(_ id: String, _ state: TaskState) {
        guard let index = connectChecklist.firstIndex(where: { $0.id == id }) else { return }
        connectChecklist[index].state = state
    }

    // MARK: Step 3

    func install(reinstall: Bool) {
        guard let selected, !installing else { return }
        let profile = finalProfile(for: selected)
        let secret = password.isEmpty ? sudoPassword : password
        errorMessage = nil
        let deployNeeded = !deploySucceeded
            && (reinstall || facts?.mydgxInstalled != true || facts?.mydgxRunning != true)
        if deployNeeded {
            installTask = Task { await runInstall(profile: profile, sudoSecret: secret) }
        } else {
            installTask = Task {
                installing = true
                phaseIndex = Self.installPhases.count - 1
                beginPhase()
                await linkMac(profile)
                installing = false
            }
        }
    }

    func cancelInstall() {
        deployProcess?.terminate()
        installTask?.cancel()
    }

    private func runInstall(profile: ConnectionProfile, sudoSecret: String) async {
        installing = true
        installFinished = false
        phaseIndex = 0
        elapsedSeconds = 0
        currentActivity = String(localized: "Preparando la instalación…")
        beginPhase()
        sleepActivity = ProcessInfo.processInfo.beginActivity(
            options: [.idleSystemSleepDisabled, .userInitiated],
            reason: String(localized: "Instalando MyDGX en el Spark")
        )
        defer {
            if let sleepActivity { ProcessInfo.processInfo.endActivity(sleepActivity) }
            sleepActivity = nil
            installing = false
        }
        let ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                self?.tick()
            }
        }
        defer { ticker.cancel() }

        do {
            let source = try model.setupDeploymentSource(for: profile)
            let needsSecret = facts?.sudoWithoutPassword != true
            if needsSecret && sudoSecret.isEmpty {
                throw SetupError.wrongSudoPassword
            }
            let status = try await runDeploy(
                source: source,
                profile: profile,
                sudoSecret: needsSecret ? sudoSecret : nil
            )
            guard status == 0 else {
                throw SetupError.deployFailed(
                    String(localized: "La instalación se detuvo en «\(Self.installPhases[phaseIndex].title)». Pulsa Reintentar: lo ya instalado se conserva. El registro tiene los detalles.")
                )
            }
            deploySucceeded = true
            password = ""
            sudoPassword = ""
            phaseIndex = Self.installPhases.count - 1
            beginPhase()
            await linkMac(profile)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func runDeploy(source: String, profile: ConnectionProfile, sudoSecret: String?) async throws -> Int32 {
        try SupportLayout.install()
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let log = SupportLayout.logs.appendingPathComponent("setup-\(formatter.string(from: Date())).log")
        FileManager.default.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600])
        logURL = log
        let logHandle = try FileHandle(forWritingTo: log)

        var arguments = [
            "\(source)/start.sh", "deploy",
            "\(profile.ssh.user)@\(profile.ssh.host)",
            "-p", String(profile.ssh.port),
            "-i", SparkSetup.expandedIdentity(profile),
            "--repair",
        ]
        if sudoSecret != nil { arguments.append("--sudo-password-stdin") }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = arguments
        process.currentDirectoryURL = URL(fileURLWithPath: source)
        var environment = ProcessInfo.processInfo.environment
        environment["MYDGX_KNOWN_HOSTS"] = SupportLayout.knownHosts.path
        environment["MYDGX_LANGUAGE"] = AppLanguage.active.rawValue
        environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
        process.environment = environment
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        let input = Pipe()
        process.standardInput = sudoSecret == nil ? FileHandle.nullDevice : input

        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            try? logHandle.write(contentsOf: data)
            let text = String(decoding: data, as: UTF8.self)
            Task { @MainActor in self?.consume(text) }
        }
        deployProcess = process
        defer {
            output.fileHandleForReading.readabilityHandler = nil
            try? logHandle.close()
            deployProcess = nil
        }

        return try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { finished in
                continuation.resume(returning: finished.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
                return
            }
            if let sudoSecret {
                let writer = input.fileHandleForWriting
                try? writer.write(contentsOf: Data((sudoSecret + "\n").utf8))
                try? writer.close()
            }
        }
    }

    private func consume(_ text: String) {
        lineBuffer += text
        var lines = lineBuffer.components(separatedBy: .newlines)
        lineBuffer = lines.removeLast()
        for raw in lines {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { continue }
            if let match = line.range(of: #"^\[\s*(\d{1,3})%\]"#, options: .regularExpression),
               Self.installPhases[phaseIndex].id == "llama" {
                let digits = line[match].filter(\.isNumber)
                if let percent = Double(digits) {
                    phaseFraction = max(phaseFraction, min(0.98, percent / 100))
                    currentActivity = String(localized: "Compilando llama.cpp para la GPU GB10 · \(Int(percent))%")
                }
                continue
            }
            let message = line.hasPrefix("==> ") ? String(line.dropFirst(4)) : line
            if let index = Self.installPhases.lastIndex(where: { phase in
                phase.markers.contains(where: { message.contains($0) })
            }), index > phaseIndex, index < Self.installPhases.count - 1 {
                phaseIndex = index
                beginPhase()
            }
            if line.hasPrefix("==> ") || line.hasPrefix("ERROR") {
                currentActivity = String(message.prefix(140))
            }
        }
    }

    private func beginPhase() {
        phaseStartedAt = Date()
        phaseFraction = 0
    }

    private func tick() {
        elapsedSeconds += 1
        let phase = Self.installPhases[phaseIndex]
        guard phase.id != "llama" || phaseFraction == 0 else { return }
        let elapsed = Date().timeIntervalSince(phaseStartedAt)
        let estimate = 0.9 * (1 - exp(-elapsed / phase.expectedSeconds))
        phaseFraction = max(phaseFraction, estimate)
    }

    private func linkMac(_ profile: ConnectionProfile) async {
        currentActivity = String(localized: "Guardando el perfil y abriendo el túnel seguro…")
        do {
            try model.completeSetup(with: profile)
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        let deadline = Date().addingTimeInterval(120)
        while Date() < deadline && !Task.isCancelled {
            if model.canUseAPI { break }
            if !model.operationInProgress && !model.tunnelRunning {
                model.startConnection()
            }
            currentActivity = model.statusMessage
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
        guard model.canUseAPI else {
            errorMessage = String(localized: "MyDGX está instalado, pero este Mac aún no logra conectarse. Pulsa Reintentar en unos segundos.")
            return
        }
        installFinished = true
        phaseFraction = 1
        try? await Task.sleep(nanoseconds: 600_000_000)
        step = .done
    }

    // MARK: Profile

    private func buildProfile(for candidate: Candidate) -> ConnectionProfile {
        var profile = ConnectionProfile()
        profile.id = profileID
        profile.alias = sanitizedAlias(alias.isEmpty ? suggestedAlias(for: candidate) : alias)
        profile.kind = .lan
        profile.apiHost = candidate.host
        profile.apiPort = 8088
        profile.ssh.host = candidate.host
        profile.ssh.port = candidate.port
        profile.ssh.user = user
        profile.ssh.identityFile = useExistingKey
            ? existingKeyPath
            : SupportLayout.keys.appendingPathComponent(profileID).path
        profile.tunnel.enabled = true
        return profile
    }

    private func finalProfile(for candidate: Candidate) -> ConnectionProfile {
        var profile = buildProfile(for: candidate)
        if let existingProfile {
            profile = Self.merge(existing: existingProfile, verified: profile)
        }
        if let facts {
            profile.detectedDeviceModel = "\(facts.device.brand) \(facts.device.model)"
            profile.detectedDeviceVariant = facts.device.variant
        }
        return profile
    }

    /// Same SSH host key, same hostname or same host:port as a saved profile means the same Spark.
    private func matchingProfile(
        host: String,
        port: Int,
        hostname: String,
        fingerprints: Set<String>
    ) async -> ConnectionProfile? {
        let names = Set([host, hostname].map(Self.normalizedHost).filter { !$0.isEmpty })
        let profiles = model.configuration.connections.filter {
            $0.id != profileID && $0.kind != .axforge && !$0.ssh.host.isEmpty
        }
        for profile in profiles {
            let endpoints = [(profile.ssh.host, profile.ssh.port), (profile.ssh.publicHost, profile.ssh.publicPort)]
                .filter { !$0.0.isEmpty }
            for (knownHost, knownPort) in endpoints
            where !(await SparkSetup.knownFingerprints(host: knownHost, port: knownPort))
                .isDisjoint(with: fingerprints) {
                return profile
            }
        }
        return profiles.first { profile in
            if profile.ssh.host.caseInsensitiveCompare(host) == .orderedSame, profile.ssh.port == port {
                return true
            }
            let known = [profile.ssh.host, profile.apiHost].map(Self.normalizedHost)
            return known.contains { !$0.isEmpty && !Self.isIPAddress($0) && names.contains($0) }
        }
    }

    /// Keeps the saved profile's settings and takes the SSH access the assistant just verified.
    static func merge(existing: ConnectionProfile, verified: ConnectionProfile) -> ConnectionProfile {
        var merged = existing
        merged.alias = verified.alias
        merged.ssh.user = verified.ssh.user
        merged.ssh.identityFile = verified.ssh.identityFile
        if merged.ssh.host.isEmpty || (isIPAddress(merged.ssh.host) && merged.ssh.host != verified.ssh.host) {
            if merged.apiHost == merged.ssh.host || merged.apiHost.isEmpty {
                merged.apiHost = verified.apiHost
            }
            merged.ssh.host = verified.ssh.host
            merged.ssh.port = verified.ssh.port
        }
        return merged
    }

    private static func normalizedHost(_ value: String) -> String {
        var host = value.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ". "))
        if host.hasSuffix(".local") { host.removeLast(".local".count) }
        return ["localhost", "127.0.0.1", "::1"].contains(host) ? "" : host
    }

    private static func isIPAddress(_ value: String) -> Bool {
        var v4 = in_addr()
        var v6 = in6_addr()
        return inet_pton(AF_INET, value, &v4) == 1 || inet_pton(AF_INET6, value, &v6) == 1
    }

    private func sanitizedAlias(_ value: String) -> String {
        let allowed = value.filter { $0.isLetter || $0.isNumber || " ._-".contains($0) }
        let trimmed = String(allowed.trimmingCharacters(in: .whitespaces).prefix(60))
        return trimmed.count >= 2 ? trimmed : "DGX Spark"
    }

    private func uniqueAlias(_ base: String) -> String {
        let clean = sanitizedAlias(base)
        let taken = Set(
            model.configuration.connections
                .filter { $0.id != profileID }
                .map { $0.alias.lowercased() }
        )
        guard taken.contains(clean.lowercased()) else { return clean }
        for number in 2...99 where !taken.contains("\(clean) \(number)".lowercased()) {
            return "\(clean) \(number)"
        }
        return "\(clean) \(profileID.prefix(4))"
    }

    func chooseExistingKey() {
        let panel = NSOpenPanel()
        panel.title = String(localized: "Elige tu clave SSH privada")
        panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".ssh", isDirectory: true)
        panel.showsHiddenFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        existingKeyPath = url.path
        existingKeyInfo = nil
        existingKeyUnlocked = false
        existingKeyError = nil
        keyPassphrase = ""
        Task {
            do {
                let info = try await SparkSetup.inspectPrivateKey(at: url.path)
                guard existingKeyPath == url.path else { return }
                existingKeyInfo = info
                existingKeyUnlocked = info.encrypted ? await SparkSetup.agentHasKey(info.fingerprint) : false
            } catch {
                guard existingKeyPath == url.path else { return }
                existingKeyError = error.localizedDescription
            }
        }
    }

    func forgetSecrets() {
        password = ""
        sudoPassword = ""
        keyPassphrase = ""
    }

    func goBack() {
        guard !isBusy, let previous = Step(rawValue: step.rawValue - 1) else { return }
        errorMessage = nil
        step = previous
    }

    func openDashboard() {
        model.openDashboard()
    }

    func openLog() {
        if let logURL { NSWorkspace.shared.open(logURL) }
    }

    /// Fills the assistant with sample data (no network access) for documentation screenshots.
    func loadDemo(_ scene: String) {
        demoMode = true
        localNetworkPrimed = true
        let asus = Candidate(
            name: "gx10-1a2b", host: "192.168.1.50", port: 22,
            systemHint: "Ubuntu 24.04 · DGX OS 7",
            guess: SparkSetup.guessDevice(from: "gx10")
        )
        let nvidia = Candidate(
            name: "spark-3c4d", host: "192.168.1.51", port: 22,
            systemHint: "Ubuntu 24.04 · DGX OS 7",
            guess: SparkSetup.guessDevice(from: "spark")
        )
        var demoFacts = SparkSetup.SparkFacts()
        demoFacts.vendor = "ASUSTeK COMPUTER INC."
        demoFacts.product = "Ascent GX10"
        demoFacts.operatingSystem = "Ubuntu 24.04.3 LTS"
        demoFacts.dgxRelease = "DGX OS 7.2.3"
        demoFacts.gpu = "NVIDIA GB10"
        demoFacts.hostname = "gx10-1a2b"
        alias = "ASUS Ascent GX10"
        user = String(localized: "usuario")
        switch scene {
        case "permission":
            localNetworkPrimed = false
        case "find":
            candidates = [asus, nvidia]
            selectedID = asus.id
        case "connect":
            candidates = [asus]
            selectedID = asus.id
            password = "••••••••••"
            step = .connect
            connecting = true
            connectChecklist = [
                ChecklistItem(id: "identity", title: String(localized: "Comprobar la identidad del Spark"), state: .done),
                ChecklistItem(id: "key", title: String(localized: "Crear una clave segura para este Mac"), state: .done),
                ChecklistItem(id: "authorize", title: String(localized: "Autorizar este Mac en el Spark"), state: .done),
                ChecklistItem(id: "login", title: String(localized: "Entrar sin contraseña"), state: .done),
                ChecklistItem(id: "inspect", title: String(localized: "Detectar equipo y sistema operativo"), state: .running),
                ChecklistItem(id: "sudo", title: String(localized: "Comprobar permisos de administrador")),
            ]
        case "install":
            candidates = [asus]
            selectedID = asus.id
            facts = demoFacts
            step = .install
            installing = true
            phaseIndex = 3
            phaseFraction = 0.46
            elapsedSeconds = 11 * 60 + 42
            currentActivity = String(localized: "Compilando llama.cpp para la GPU GB10 · \(46)%")
            logURL = URL(fileURLWithPath: "/dev/null")
        default:
            candidates = [asus]
            selectedID = asus.id
            facts = demoFacts
            demoFacts.mydgxInstalled = true
            demoFacts.mydgxRunning = true
            facts = demoFacts
            step = .done
        }
    }

    func finish() {
        forgetSecrets()
        model.closeSetupWizard()
    }
}

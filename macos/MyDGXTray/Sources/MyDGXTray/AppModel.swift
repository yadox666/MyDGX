import AppKit
import Combine
import Foundation
import ServiceManagement
import SwiftUI

private final class SettingsWindow: NSWindow {
    override func cancelOperation(_ sender: Any?) {
        performClose(sender)
    }
}

/// Lets the settings window ask its SwiftUI form about unsaved edits.
struct SettingsEditor {
    let hasChanges: () -> Bool
    let save: () -> Bool
    let discard: () -> Void
}

@MainActor
private final class SettingsWindowDelegate: NSObject, NSWindowDelegate {
    private weak var model: AppModel?

    init(model: AppModel) {
        self.model = model
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        model?.settingsMayClose() ?? true
    }
}

@MainActor
private final class SetupWindowDelegate: NSObject, NSWindowDelegate {
    private let wizard: SparkSetupWizard
    private let onClose: () -> Void

    init(wizard: SparkSetupWizard, onClose: @escaping () -> Void) {
        self.wizard = wizard
        self.onClose = onClose
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard wizard.installing else { return true }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = String(localized: "¿Detener la instalación?")
        alert.informativeText = String(localized: "El Spark conservará lo que ya esté instalado y podrás continuar más tarde.")
        alert.addButton(withTitle: String(localized: "Seguir instalando"))
        alert.addButton(withTitle: String(localized: "Detener y cerrar"))
        guard alert.runModal() == .alertSecondButtonReturn else { return false }
        wizard.cancelInstall()
        return true
    }

    func windowWillClose(_ notification: Notification) {
        wizard.cancelInstall()
        wizard.forgetSecrets()
        onClose()
    }
}

@MainActor
final class AppModel: ObservableObject {
    private struct SSHEndpoint {
        let host: String
        let port: Int
        let isPublic: Bool

        /// The primary endpoint can itself be an internet address (a VPS, a NAT'd host),
        /// so "LAN" is decided by the address, not by which endpoint answered.
        var isLocalNetwork: Bool { !isPublic && Self.isLocalNetworkHost(host) }

        static func isLocalNetworkHost(_ value: String) -> Bool {
            let host = value.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            let octets = host.split(separator: ".", omittingEmptySubsequences: false).compactMap { UInt8($0) }
            if octets.count == 4, host.split(separator: ".").count == 4 {
                switch (octets[0], octets[1]) {
                case (10, _), (127, _), (192, 168), (169, 254): return true
                case (172, 16...31): return true
                default: return false
                }
            }
            if host.contains(":") {
                return host == "::1" || host.hasPrefix("fc") || host.hasPrefix("fd")
                    || ["fe8", "fe9", "fea", "feb"].contains { host.hasPrefix($0) }
            }
            if host == "localhost" || !host.contains(".") { return true }
            return [".local", ".lan", ".home", ".internal", ".home.arpa"].contains { host.hasSuffix($0) }
        }
    }

    private enum ConnectionState: Equatable {
        case connected
        case disconnected
        case undeployed
        case poweredOff
        /// The API times out while SSH answers and the Spark is stalled on memory.
        case saturated
        /// The API times out while SSH answers, without memory pressure.
        case unresponsive
    }

    private enum ProfileJobPhase: Equatable {
        case queued
        case checking
        case downloading
        case installing
        case loading
        case modelLoaded
        case profileLoaded
        case failed
    }

    @Published private(set) var configuration: MyDGXConfiguration
    @Published private(set) var overview: OverviewResponse?
    @Published private(set) var profiles: [InferenceProfile] = []
    @Published private(set) var runtime: ProfileRuntime?
    @Published private(set) var connectionAvailability: [String: Bool] = [:]
    @Published private(set) var isRefreshing = false
    @Published private(set) var tunnelRunning = false
    @Published private(set) var tunnelStateKnown = false
    @Published private(set) var apiReachable = false
    @Published private(set) var managedTunnelRunning = false
    @Published private(set) var launchAtLoginEnabled = false
    @Published private(set) var operationInProgress = false
    @Published private(set) var profileJobInProgress = false
    @Published private(set) var machineActivity: String? {
        didSet { machineActivityIsError = false }
    }
    private(set) var machineActivityIsError = false
    @Published private(set) var pendingProfileName: String?
    @Published private(set) var deploymentStatus: DeploymentStatus?
    /// Why Claude Code and OpenCode can't open now; nil when a suitable model is loaded.
    @Published private(set) var codingAgentBlockReason: String? = String(localized: "Comprobando modelos del gateway…")
    @Published var statusMessage = String(localized: "No conectado")
    @Published var lastError: String?

    private var pollingTask: Task<Void, Never>?
    private var manualRefreshTask: Task<Void, Never>?
    private var operationTask: Task<Void, Never>?
    private var wakeReconnectTask: Task<Void, Never>?
    private var workspaceCancellables = Set<AnyCancellable>()
    private var tunnelProcess: Process?
    private var tunnelLog: FileHandle?
    private var settingsWindowController: NSWindowController?
    private var settingsWindowDelegate: SettingsWindowDelegate?
    var settingsEditor: SettingsEditor?
    private var setupWindowController: NSWindowController?
    private var setupWindowDelegate: SetupWindowDelegate?
    let launchedWithoutConfiguration = !FileManager.default.fileExists(
        atPath: ConfigurationStore.fileURL.path
    )
    private var lastConnectionState: ConnectionState?
    private var lastProfileJobPhase: ProfileJobPhase?
    private var observedProfileJobID: String?
    private var selectedSSHEndpoints: [String: SSHEndpoint] = [:]
    private var activeTunnelEndpoints: [String: SSHEndpoint] = [:]
    private var nextAutomaticReconnectAt = Date.distantPast
    /// A profile the user just picked is not swapped out automatically before this date.
    private var manualSelectionUntil = Date.distantPast
    /// Open menus (the tray menu and its submenus). Any `@Published` write rebuilds the
    /// MenuBarExtra menu and closes an open submenu, so polling holds its writes meanwhile.
    private var openMenus = 0
    private var menuTrackingObservers: [NSObjectProtocol] = []

    init() {
        do {
            configuration = try ConfigurationStore.load()
        } catch {
            configuration = MyDGXConfiguration()
            lastError = error.localizedDescription
        }
        try? SupportLayout.install()
        refreshLaunchAtLoginStatus()
        observeWorkspacePowerEvents()
        observeMenuTracking()
        for profile in configuration.connections where profile.kind == .axforge {
            try? FileManager.default.removeItem(
                at: SupportLayout.sessionKnownHosts(profileID: profile.id)
            )
        }
    }

    private func observeWorkspacePowerEvents() {
        let center = NSWorkspace.shared.notificationCenter
        center.publisher(for: NSWorkspace.willSleepNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                Task { @MainActor in self?.prepareForSystemSleep() }
            }
            .store(in: &workspaceCancellables)
        center.publisher(for: NSWorkspace.didWakeNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                Task { @MainActor in self?.reconnectAfterSystemWake() }
            }
            .store(in: &workspaceCancellables)
    }

    /// Observed synchronously: Combine's `receive(on: RunLoop.main)` would not deliver while
    /// the menu keeps the run loop in event-tracking mode.
    private func observeMenuTracking() {
        let center = NotificationCenter.default
        menuTrackingObservers = [
            center.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: nil) { [weak self] _ in
                MainActor.assumeIsolated { self?.openMenus += 1 }
            },
            center.addObserver(forName: NSMenu.didEndTrackingNotification, object: nil, queue: nil) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.openMenus = max(0, self.openMenus - 1)
                }
            },
        ]
    }

    private func waitWhileMenuIsOpen() async {
        while openMenus > 0, !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
    }

    private func prepareForSystemSleep() {
        wakeReconnectTask?.cancel()
        tunnelStateKnown = false
        statusMessage = String(localized: "Mac en reposo")
    }

    private func reconnectAfterSystemWake() {
        wakeReconnectTask?.cancel()
        wakeReconnectTask = Task {
            let profile = configuration.activeConnection
            guard profile.tunnel.enabled,
                  !profile.ssh.host.isEmpty,
                  !profile.ssh.user.isEmpty else {
                await refresh()
                return
            }

            tunnelStateKnown = false
            tunnelRunning = false
            managedTunnelRunning = false
            statusMessage = String(localized: "Reconectando tras reactivar el Mac…")
            lastError = nil
            await discardStaleTunnel(profile)

            let delays: [UInt64] = [1, 2, 4, 8, 15]
            for (attempt, delay) in delays.enumerated() {
                guard !Task.isCancelled,
                      configuration.activeConnectionID == profile.id else {
                    return
                }
                try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
                guard !Task.isCancelled else { return }
                if operationInProgress {
                    statusMessage = String(localized: "Esperando para reconectar…")
                    continue
                }
                guard await selectSSHEndpoint(profile) else {
                    statusMessage = String(localized: "Esperando red · intento \(attempt + 1)/\(delays.count)")
                    continue
                }
                do {
                    try await startTunnel(profile)
                    tunnelStateKnown = true
                    await refresh()
                    AppNotifications.send(
                        title: String(localized: "Conexión restaurada"),
                        body: String(localized: "El túnel de \(profile.alias) se recuperó tras reactivar el Mac.")
                    )
                    return
                } catch {
                    lastError = error.localizedDescription
                    await discardStaleTunnel(profile)
                }
            }
            tunnelStateKnown = true
            statusMessage = String(localized: "No conectado")
            AppNotifications.send(
                title: String(localized: "No se pudo restaurar la conexión"),
                body: String(localized: "Abre MyDGX para volver a intentarlo.")
            )
        }
    }

    private func discardStaleTunnel(_ profile: ConnectionProfile) async {
        _ = await runSSHControl(profile, command: "exit")
        if tunnelProcess?.isRunning == true {
            tunnelProcess?.terminate()
        }
        tunnelProcess = nil
        tunnelLog?.closeFile()
        tunnelLog = nil
        try? FileManager.default.removeItem(at: tunnelControlSocket(profile))
        activeTunnelEndpoints.removeValue(forKey: profile.id)
        tunnelRunning = false
        managedTunnelRunning = false
    }

    var activeProfile: InferenceProfile? {
        profiles.first(where: { $0.active == 1 })
    }

    var runningProfiles: [InferenceProfile] {
        let runningIDs = Set(runtime?.profileIDs ?? [])
        return profiles.filter { runningIDs.contains($0.id) }
    }

    var runningUserProfileCount: Int {
        userProfileCount(runningProfiles.map(\.id))
    }

    var benchmarkSuite: BenchmarkSuiteStatus? {
        guard let suite = overview?.benchmarkSuite, suite.isActive else { return nil }
        return suite
    }

    func isProfileRunning(_ profile: InferenceProfile) -> Bool {
        runtime?.profileIDs.contains(profile.id) == true
    }

    var menuBarLabel: String {
        if let suite = benchmarkSuite {
            return String(localized: "Benchmarks \(Int(suite.progress.rounded()))%")
        }
        guard let metrics = overview?.metrics else { return "MyDGX" }
        let gpu = metrics.gpuUtilization.map { "\(Int($0.rounded()))%" } ?? "—"
        let memory = Int(metrics.memoryPercent.rounded())
        return "GPU \(gpu) · RAM \(memory)%"
    }

    var canStopManagedTunnel: Bool {
        managedTunnelRunning
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            refreshLaunchAtLoginStatus()
            statusMessage = enabled
                ? String(localized: "Inicio automático activado")
                : String(localized: "Inicio automático desactivado")
        } catch {
            refreshLaunchAtLoginStatus()
            lastError = String(localized: "No se pudo cambiar el inicio automático: \(error.localizedDescription)")
        }
    }

    private func refreshLaunchAtLoginStatus() {
        switch SMAppService.mainApp.status {
        case .enabled, .requiresApproval:
            launchAtLoginEnabled = true
        case .notRegistered, .notFound:
            launchAtLoginEnabled = false
        @unknown default:
            launchAtLoginEnabled = false
        }
    }

    var canToggleConnection: Bool {
        guard !operationInProgress, tunnelStateKnown else { return false }
        if tunnelRunning {
            return canStopManagedTunnel
        }
        return statusMessage != String(localized: "Apagado") && overview == nil
    }

    var canUseAPI: Bool {
        overview != nil
    }

    /// No Spark has been configured yet: the menu only offers the setup assistant.
    var needsSetup: Bool {
        !apiReachable && configuration.connections.allSatisfy(Self.isUnconfigured)
    }

    private static func isUnconfigured(_ profile: ConnectionProfile) -> Bool {
        profile.kind != .axforge && profile.ssh.host.isEmpty
    }

    var canOpenDashboard: Bool {
        apiReachable
    }

    var canManageProfiles: Bool {
        canUseAPI && !operationInProgress && !profileJobInProgress && benchmarkSuite == nil
    }

    var canUseSSH: Bool {
        let ssh = configuration.activeConnection.ssh
        return !ssh.host.isEmpty
            && !ssh.user.isEmpty
            && (canUseAPI || statusMessage == String(localized: "Undeployed"))
    }

    var canShutdown: Bool {
        canUseSSH && !operationInProgress
    }

    func startPolling(autoConnect: Bool = true) {
        guard pollingTask == nil else { return }
        pollingTask = Task {
            await SparkSetup.loadKeychainKeys(for: configuration.connections.filter { $0.kind != .axforge })
            if autoConnect {
                await connectOnLaunch()
            }
            while !Task.isCancelled {
                await waitWhileMenuIsOpen()
                await refresh()
                await refreshConnectionAvailability()
                await preferLANIfAvailable()
                await recoverConnectionIfNeeded()
                let seconds = UInt64(max(1, configuration.refreshIntervalSeconds))
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
            }
        }
    }

    private func recoverConnectionIfNeeded() async {
        var profile = configuration.activeConnection
        guard !apiReachable,
              overview == nil,
              !operationInProgress,
              Date() >= nextAutomaticReconnectAt else {
            return
        }
        let unusable = !profile.tunnel.enabled || profile.ssh.host.isEmpty || profile.ssh.user.isEmpty
        // An open SSH port is not a working connection (wrong key, other server), so while
        // disconnected a reachable LAN device also wins over a remote one that answers.
        let offLAN = selectedSSHEndpoints[profile.id]?.isLocalNetwork != true
        if (unusable || connectionAvailability[profile.id] != true || offLAN) && Date() >= manualSelectionUntil {
            let previous = profile
            if selectReachableProfile() {
                await discardStaleTunnel(previous)
                profile = configuration.activeConnection
            }
        }
        guard profile.tunnel.enabled,
              !profile.ssh.host.isEmpty,
              !profile.ssh.user.isEmpty else {
            return
        }
        nextAutomaticReconnectAt = Date().addingTimeInterval(15)
        guard selectedSSHEndpoints[profile.id] != nil || connectionAvailability[profile.id] == true else {
            statusMessage = String(localized: "Esperando red para reconectar…")
            return
        }
        operationInProgress = true
        statusMessage = String(localized: "Red disponible · reconectando…")
        defer { operationInProgress = false }
        do {
            await discardStaleTunnel(profile)
            try await startTunnel(profile)
            nextAutomaticReconnectAt = .distantPast
            await refresh()
            AppNotifications.send(
                title: String(localized: "Conexión restaurada"),
                body: String(localized: "MyDGXTray se reconectó automáticamente a \(profile.alias).")
            )
        } catch {
            lastError = error.localizedDescription
            statusMessage = String(localized: "Reintentando conexión…")
        }
    }

    private func preferLANIfAvailable() async {
        let profile = configuration.activeConnection
        guard profile.tunnel.enabled,
              !operationInProgress,
              managedTunnelRunning,
              activeTunnelEndpoints[profile.id]?.isPublic == true,
              selectedSSHEndpoints[profile.id]?.isPublic == false else {
            return
        }
        operationInProgress = true
        statusMessage = String(localized: "LAN disponible · cambiando ruta…")
        defer { operationInProgress = false }
        do {
            await discardStaleTunnel(profile)
            try await startTunnel(profile)
            await refresh()
        } catch {
            lastError = error.localizedDescription
            statusMessage = String(localized: "No se pudo cambiar a LAN")
        }
    }

    /// Picks the profile to use: LAN first (current one preferred), then whatever answers over the internet.
    /// Relies on `selectedSSHEndpoints` from the last `refreshConnectionAvailability()`.
    @discardableResult
    private func selectReachableProfile(preferCurrent: Bool = true) -> Bool {
        let current = configuration.activeConnection
        let usable = configuration.connections.filter {
            $0.tunnel.enabled && !$0.ssh.host.isEmpty && !$0.ssh.user.isEmpty
        }
        func onLAN(_ profile: ConnectionProfile) -> Bool {
            selectedSSHEndpoints[profile.id]?.isLocalNetwork == true
        }
        func online(_ profile: ConnectionProfile) -> Bool {
            selectedSSHEndpoints[profile.id] != nil
        }
        if preferCurrent, onLAN(current) { return false }
        let target = usable.first(where: onLAN)
            ?? (preferCurrent && online(current) ? current : nil)
            ?? usable.first(where: online)
        guard let target, target.id != current.id else { return false }
        var updated = configuration
        updated.activeConnectionID = target.id
        guard (try? ConfigurationStore.save(updated)) != nil else { return false }
        configuration = updated
        overview = nil
        profiles = []
        runtime = nil
        apiReachable = false
        lastConnectionState = nil
        let route = onLAN(target) ? String(localized: "en la red local") : String(localized: "por internet")
        statusMessage = String(localized: "\(target.alias) seleccionado (\(route))")
        AppNotifications.send(
            title: String(localized: "Equipo seleccionado automáticamente"),
            body: online(current)
                ? String(localized: "\(target.alias) está disponible \(route); MyDGXTray lo usa en lugar de \(current.alias).")
                : String(localized: "\(current.alias) no responde; MyDGXTray usa \(target.alias) \(route).")
        )
        return true
    }

    private func connectOnLaunch() async {
        statusMessage = String(localized: "Buscando equipos disponibles…")
        await refreshConnectionAvailability()
        selectReachableProfile()
        let profile = configuration.activeConnection
        guard profile.tunnel.enabled,
              !profile.ssh.host.isEmpty,
              !profile.ssh.user.isEmpty else {
            return
        }
        operationInProgress = true
        statusMessage = String(localized: "Conectando…")
        defer { operationInProgress = false }
        do {
            try await startTunnel(profile)
        } catch {
            lastError = error.localizedDescription
            statusMessage = String(localized: "No conectado")
        }
    }

    func requestRefresh() {
        guard !isRefreshing else { return }
        statusMessage = String(localized: "Actualizando…")
        manualRefreshTask?.cancel()
        manualRefreshTask = Task {
            await refresh()
            await refreshConnectionAvailability()
            nextAutomaticReconnectAt = .distantPast
            await preferLANIfAvailable()
            await recoverConnectionIfNeeded()
        }
    }

    func refresh() async {
        guard !isRefreshing else { return }
        await waitWhileMenuIsOpen()
        isRefreshing = true
        defer { isRefreshing = false }
        let tunnelState = await detectTunnel()
        await waitWhileMenuIsOpen()
        tunnelRunning = tunnelState.available || tunnelState.managed
        managedTunnelRunning = tunnelState.managed
        tunnelStateKnown = true
        do {
            let client = try MyDGXClient(configuration: configuration)
            async let overviewRequest = client.overview()
            async let profilesRequest = client.profiles()
            let (newOverview, profileResponse) = try await (overviewRequest, profilesRequest)
            await waitWhileMenuIsOpen()
            apiReachable = true
            overview = newOverview
            cacheDetectedDevice(newOverview.host)
            profiles = profileResponse.profiles
            runtime = profileResponse.runtime
            if !operationInProgress {
                let recentJobs = (try? await client.jobs()) ?? []
                updateObservedProfileJob(recentJobs, profiles: profileResponse.profiles)
            }
            if pendingProfileName == nil,
               profileResponse.runtime.running,
               machineActivityIsError,
               let loadedProfile = profileResponse.profiles.first(where: { $0.active == 1 }) {
                machineActivity = String(localized: "Perfil cargado: \(loadedProfile.name)")
                lastProfileJobPhase = nil
                notifyProfilePhase(.profileLoaded, profile: loadedProfile)
            }
            if let suite = newOverview.benchmarkSuite, suite.isActive {
                statusMessage = suite.status == "restoring"
                    ? String(localized: "Restaurando estado · Benchmarks")
                    : String(localized: "Ejecutando benchmarks · \(Int(suite.progress.rounded()))%")
                machineActivity = "\(String(localized: "Suite de benchmarks")) · \(suite.message)"
            } else {
                let route = activeTunnelEndpoints[configuration.activeConnectionID]?.isPublic == true
                    ? String(localized: "Internet")
                    : String(localized: "LAN")
                statusMessage = String(localized: "Conectado a \(newOverview.host.hostname) · \(route)")
                if machineActivity?.hasPrefix(String(localized: "Suite de benchmarks")) == true {
                    machineActivity = nil
                }
            }
            lastError = nil
            notifyConnectionState(.connected)
            await ensureWebAppForwards(newOverview.webApps ?? [])
            await updateCodingAgentReadiness()
        } catch {
            await waitWhileMenuIsOpen()
            overview = nil
            profiles = []
            runtime = nil
            setCodingAgentBlockReason(String(localized: "MyDGX no está conectado."))
            if (error as? URLError)?.code == .timedOut, !(await sshIsUnavailable()) {
                apiReachable = false
                if await remoteMemoryIsSaturated() {
                    statusMessage = String(localized: "Spark saturado (memoria)")
                    lastError = String(localized: "El Spark responde por SSH, pero se está quedando sin memoria y MyDGX tarda demasiado en contestar. Para un modelo o cancela el trabajo de ComfyUI.")
                    notifyConnectionState(.saturated)
                } else {
                    statusMessage = String(localized: "MyDGX tarda en responder")
                    lastError = String(localized: "El Spark responde por SSH, pero la API de MyDGX no contestó a tiempo.")
                    notifyConnectionState(.unresponsive)
                }
                return
            }
            let healthAvailable: Bool
            if let client = try? MyDGXClient(configuration: configuration),
               (try? await client.health()) != nil {
                healthAvailable = true
            } else {
                healthAvailable = false
            }
            apiReachable = healthAvailable
            if healthAvailable {
                let profile = configuration.activeConnection
                if let importedKey = try? await SSHBootstrap.fetchDashboardAPIKey(
                    profile: profileUsingSelectedSSH(profile),
                    remoteDirectory: profile.deployment.remoteDirectory
                ) {
                    try? CredentialStore.write(importedKey, account: profile.apiKeyAccount)
                    statusMessage = String(localized: "Clave API importada · conectando…")
                    lastError = nil
                    return
                }
                statusMessage = String(localized: "Autenticación requerida")
                lastError = String(localized: "MyDGX está disponible, pero MyDGXTray necesita una clave API en ~/.MyDGX/credentials.")
                notifyConnectionState(.connected)
                return
            }
            let hasSSHConfiguration = !configuration.activeConnection.ssh.host.isEmpty
                && !configuration.activeConnection.ssh.user.isEmpty
            let poweredOff: Bool
            if hasSSHConfiguration
                && (
                    lastConnectionState == .connected
                        || lastConnectionState == .poweredOff
                        || lastConnectionState == .saturated
                        || lastConnectionState == .unresponsive
                        || lastConnectionState == nil
                ) {
                poweredOff = await sshIsUnavailable()
            } else {
                poweredOff = false
            }
            let undeployed = !poweredOff
                && configuration.activeConnection.tunnel.enabled && tunnelState.managed
            statusMessage = poweredOff
                ? String(localized: "Apagado")
                : (undeployed ? String(localized: "Undeployed") : String(localized: "No conectado"))
            lastError = error.localizedDescription
            notifyConnectionState(
                poweredOff
                    ? .poweredOff
                    : (undeployed ? .undeployed : .disconnected)
            )
        }
    }

    private func refreshConnectionAvailability() async {
        let targets = configuration.connections.map {
            (
                id: $0.id,
                host: $0.ssh.host,
                port: $0.ssh.port,
                publicHost: $0.ssh.publicHost,
                publicPort: $0.ssh.publicPort
            )
        }
        var latest: [String: Bool] = [:]
        var endpoints: [String: SSHEndpoint] = [:]
        await withTaskGroup(of: (String, SSHEndpoint?).self) { group in
            for target in targets {
                group.addTask {
                    if await ProfileReachability.sshAvailable(
                        host: target.host,
                        port: target.port
                    ) {
                        return (
                            target.id,
                            SSHEndpoint(host: target.host, port: target.port, isPublic: false)
                        )
                    }
                    if !target.publicHost.isEmpty,
                       await ProfileReachability.sshAvailable(
                           host: target.publicHost,
                           port: target.publicPort
                       ) {
                        return (
                            target.id,
                            SSHEndpoint(
                                host: target.publicHost,
                                port: target.publicPort,
                                isPublic: true
                            )
                        )
                    }
                    return (target.id, nil)
                }
            }
            for await (id, endpoint) in group {
                latest[id] = endpoint != nil
                endpoints[id] = endpoint
            }
        }
        await waitWhileMenuIsOpen()
        selectedSSHEndpoints = endpoints
        if overview != nil {
            latest[configuration.activeConnectionID] = true
        } else if statusMessage == String(localized: "Apagado") {
            latest[configuration.activeConnectionID] = false
        }
        connectionAvailability = latest
    }

    private func cacheDetectedDevice(_ host: HostInformation) {
        guard let model = host.deviceModel?.trimmingCharacters(in: .whitespacesAndNewlines),
              !model.isEmpty,
              let index = configuration.connections.firstIndex(
                  where: { $0.id == configuration.activeConnectionID }
              ) else {
            return
        }
        let variant = host.deviceVariant?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard configuration.connections[index].detectedDeviceModel != model
                || configuration.connections[index].detectedDeviceVariant != variant else {
            return
        }
        var updated = configuration
        updated.connections[index].detectedDeviceModel = model
        updated.connections[index].detectedDeviceVariant = variant
        guard (try? ConfigurationStore.save(updated)) != nil else { return }
        configuration = updated
    }

    func save(
        configuration: MyDGXConfiguration,
        apiKey: String?,
        apiKeyAccount: String? = nil
    ) throws {
        try ConfigurationStore.save(configuration)
        if let apiKey {
            try CredentialStore.write(
                apiKey,
                account: apiKeyAccount ?? configuration.apiKeyAccount
            )
        }
        if configuration.activeConnectionID != self.configuration.activeConnectionID {
            manualSelectionUntil = Date().addingTimeInterval(120)
        }
        self.configuration = configuration
        tunnelStateKnown = false
        requestRefresh()
    }

    func activateConnection(id: String) {
        do {
            stopManagedTunnel()
            var updated = configuration
            try updated.setActiveConnection(id: id)
            try ConfigurationStore.save(updated)
            configuration = updated
            manualSelectionUntil = Date().addingTimeInterval(120)
            overview = nil
            profiles = []
            runtime = nil
            lastConnectionState = nil
            tunnelStateKnown = false
            requestRefresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Removes a profile and writes the config at once, so a restart or a later save cannot bring it back.
    func deleteConnection(id: String) throws {
        var updated = configuration
        guard updated.connections.count > 1,
              updated.connections.contains(where: { $0.id == id }) else {
            throw ConfigurationError.profileNotFound
        }
        let wasActive = updated.activeConnectionID == id
        updated.connections.removeAll { $0.id == id }
        if wasActive {
            stopManagedTunnel()
            updated.activeConnectionID = (
                updated.connections.first { selectedSSHEndpoints[$0.id]?.isLocalNetwork == true }
                    ?? updated.connections.first { selectedSSHEndpoints[$0.id] != nil }
                    ?? updated.connections[0]
            ).id
        }
        try ConfigurationStore.save(updated)
        configuration = updated
        if wasActive {
            overview = nil
            profiles = []
            runtime = nil
            apiReachable = false
            lastConnectionState = nil
            tunnelStateKnown = false
            nextAutomaticReconnectAt = .distantPast
            requestRefresh()
        }
    }

    func startConnection() {
        guard !operationInProgress else { return }
        operationInProgress = true
        operationTask = Task {
            defer { operationInProgress = false }
            do {
                let profile = configuration.activeConnection
                if profile.tunnel.enabled {
                    try await startTunnel(profile)
                }
                if let device = try? await SSHBootstrap.detectDevice(profile: profile) {
                    cacheDetectedDevice(
                        HostInformation(
                            hostname: profile.ssh.host,
                            deviceModel: device.model,
                            deviceVariant: device.variant
                        )
                    )
                }
                await refresh()
            } catch {
                lastError = error.localizedDescription
                statusMessage = String(localized: "Conexión fallida")
            }
        }
    }

    func stopManagedTunnel() {
        guard !operationInProgress, managedTunnelRunning else { return }
        let profile = configuration.activeConnection
        operationInProgress = true
        operationTask = Task {
            defer { operationInProgress = false }
            let status = await runSSHControl(profile, command: "exit")
            if status != 0, tunnelProcess?.isRunning == true {
                tunnelProcess?.terminate()
            }
            tunnelProcess = nil
            tunnelLog?.closeFile()
            tunnelLog = nil
            try? FileManager.default.removeItem(at: tunnelControlSocket(profile))
            managedTunnelRunning = false
            tunnelRunning = false
            tunnelStateKnown = true
            statusMessage = status == 0
                ? String(localized: "Túnel detenido · \(profile.alias)")
                : String(localized: "Túnel detenido")
            notifyConnectionState(.disconnected)
        }
    }

    func deployActiveConnection() {
        deployConnection(id: configuration.activeConnectionID)
    }

    func backupConnection(id: String) {
        guard !operationInProgress else { return }
        guard let profile = configuration.connections.first(where: { $0.id == id }) else {
            lastError = ConfigurationError.profileNotFound.localizedDescription
            return
        }
        operationInProgress = true
        operationTask = Task {
            defer { operationInProgress = false }
            do {
                let destination = try await backup(profile)
                statusMessage = String(localized: "Copia guardada · \(destination.lastPathComponent)")
                lastError = nil
            } catch {
                lastError = error.localizedDescription
                statusMessage = String(localized: "Falló la copia de seguridad")
            }
        }
    }

    func deployConnection(id: String) {
        guard !operationInProgress else { return }
        guard let profile = configuration.connections.first(where: { $0.id == id }) else {
            lastError = ConfigurationError.profileNotFound.localizedDescription
            return
        }
        operationInProgress = true
        deploymentStatus = DeploymentStatus(
            progress: 0.02,
            phase: String(localized: "Preparando despliegue"),
            detail: String(localized: "Validando el perfil y el proyecto local."),
            error: nil,
            completed: false
        )
        statusMessage = String(localized: "Desplegando MyDGX · \(profile.alias)")
        lastError = nil
        operationTask = Task {
            defer { operationInProgress = false }
            var deploymentCompleted = false
            do {
                try await deploy(profile)
                deploymentCompleted = true
                if profile.id == configuration.activeConnectionID, profile.tunnel.enabled {
                    updateDeployment(
                        progress: 0.99,
                        phase: String(localized: "Conectando"),
                        detail: String(localized: "Iniciando la conexión y los túneles seguros.")
                    )
                    try await startTunnel(profile)
                }
                statusMessage = String(localized: "Despliegue completado · \(profile.alias)")
                deploymentStatus = DeploymentStatus(
                    progress: 1,
                    phase: String(localized: "Despliegue completado"),
                    detail: profile.id == configuration.activeConnectionID && profile.tunnel.enabled
                        ? String(localized: "MyDGX se desplegó y la conexión quedó iniciada.")
                        : String(localized: "MyDGX se sincronizó, preparó y reinició correctamente."),
                    error: nil,
                    completed: true
                )
                lastError = nil
                AppNotifications.send(
                    title: String(localized: "Despliegue completado"),
                    body: String(localized: "MyDGX está preparado en \(profile.alias).")
                )
                if profile.id == configuration.activeConnectionID {
                    await refresh()
                }
            } catch {
                let diagnostic = deploymentDiagnostic(profile: profile)
                lastError = diagnostic ?? error.localizedDescription
                statusMessage = deploymentCompleted
                    ? String(localized: "Desplegado · Falló la conexión")
                    : String(localized: "Falló el despliegue")
                deploymentStatus = DeploymentStatus(
                    progress: deploymentStatus?.progress ?? 0,
                    phase: deploymentCompleted
                        ? String(localized: "Error de conexión")
                        : String(localized: "Error de despliegue"),
                    detail: deploymentStatus?.detail ?? String(localized: "La operación no se completó."),
                    error: lastError,
                    completed: false
                )
                AppNotifications.send(
                    title: deploymentCompleted
                        ? String(localized: "Error de conexión")
                        : String(localized: "Error de despliegue"),
                    body: String(localized: "Revisa Preferencias para ver el diagnóstico de \(profile.alias).")
                )
            }
        }
    }

    func openSettings() {
        if let window = settingsWindowController?.window {
            presentSettingsWindow(window)
            return
        }

        let controller = NSHostingController(rootView: SettingsView(model: self))
        let window = SettingsWindow(contentViewController: controller)
        window.title = String(localized: "Preferencias de MyDGX")
        window.styleMask = [.titled, .closable, .miniaturizable]
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        window.hidesOnDeactivate = false
        window.center()
        let delegate = SettingsWindowDelegate(model: self)
        window.delegate = delegate
        settingsWindowDelegate = delegate
        settingsWindowController = NSWindowController(window: window)
        presentSettingsWindow(window)
    }

    func settingsChanged(_ hasChanges: Bool) {
        settingsWindowController?.window?.isDocumentEdited = hasChanges
    }

    /// Asks before unsaved preferences are lost; false keeps the window (and the app) open.
    func settingsMayClose() -> Bool {
        guard let editor = settingsEditor, editor.hasChanges() else { return true }
        if let window = settingsWindowController?.window {
            presentSettingsWindow(window)
        }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = String(localized: "¿Guardar los cambios de Preferencias?")
        alert.informativeText = String(localized: "Si no los guardas, se perderán y MyDGX seguirá usando la configuración anterior.")
        alert.addButton(withTitle: String(localized: "Guardar"))
        let discardButton = alert.addButton(withTitle: String(localized: "Descartar cambios"))
        discardButton.hasDestructiveAction = true
        alert.addButton(withTitle: String(localized: "Cancelar"))
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            return editor.save()
        case .alertSecondButtonReturn:
            editor.discard()
            return true
        default:
            return false
        }
    }

    func openSetupWizard() {
        if let window = setupWindowController?.window {
            presentSettingsWindow(window)
            return
        }
        let wizard = SparkSetupWizard(model: self)
        let controller = NSHostingController(rootView: SparkSetupWizardView(wizard: wizard))
        let window = SettingsWindow(contentViewController: controller)
        window.title = String(localized: "Asistente de instalación Spark")
        window.styleMask = [.titled, .closable, .miniaturizable, .fullSizeContentView]
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        window.hidesOnDeactivate = false
        let delegate = SetupWindowDelegate(wizard: wizard) { [weak self] in
            self?.setupWindowController = nil
            self?.setupWindowDelegate = nil
        }
        window.delegate = delegate
        window.center()
        setupWindowDelegate = delegate
        setupWindowController = NSWindowController(window: window)
        presentSettingsWindow(window)
    }

    func closeSetupWizard() {
        setupWindowController?.window?.close()
    }

    /// Saves the profile created by the assistant, replacing the empty first-run placeholder.
    func completeSetup(with profile: ConnectionProfile) throws {
        var updated = configuration
        updated.connections.removeAll { Self.isUnconfigured($0) && $0.id != profile.id }
        if let index = updated.connections.firstIndex(where: { $0.id == profile.id }) {
            updated.connections[index] = profile
        } else {
            updated.connections.append(profile)
        }
        updated.activeConnectionID = profile.id
        if managedTunnelRunning {
            stopManagedTunnel()
        }
        try save(configuration: updated, apiKey: nil)
        overview = nil
        profiles = []
        runtime = nil
        apiReachable = false
        lastConnectionState = nil
    }

    func setupDeploymentSource(for profile: ConnectionProfile) throws -> String {
        if SupportLayout.bundledSource != nil {
            return try deploymentSource(profile)
        }
        return try deploymentSource(configuration.activeConnection)
    }

    private func presentSettingsWindow(_ window: NSWindow) {
        NSApp.activate(ignoringOtherApps: true)
        if window.isMiniaturized {
            window.deminiaturize(nil)
        }
        window.orderFrontRegardless()
        window.makeKey()
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
            window.orderFrontRegardless()
            window.makeKey()
        }
    }

    func openDashboard() {
        guard let url = configuration.dashboardURL else {
            lastError = String(localized: "La URL del dashboard no es válida.")
            return
        }
        NSWorkspace.shared.open(url)
    }

    func copyDashboardPassword() {
        let profile = configuration.activeConnection
        Task {
            let password = try? await SSHBootstrap.fetchDashboardPassword(
                profile: profileUsingSelectedSSH(profile),
                remoteDirectory: profile.deployment.remoteDirectory
            )
            guard let password else {
                lastError = String(localized: "El DGX no tiene contraseña del dashboard o no se pudo leer por SSH. Vuelve a desplegar para generarla.")
                return
            }
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(password, forType: .string)
            let copiedChange = pasteboard.changeCount
            lastError = nil
            statusMessage = String(localized: "Contraseña del dashboard copiada · se borra en 60 s")
            try? await Task.sleep(for: .seconds(60))
            if pasteboard.changeCount == copiedChange {
                pasteboard.clearContents()
            }
        }
    }

    func openOpenWebUI() {
        guard let url = configuration.resolvedOpenWebUIURL else {
            lastError = String(localized: "La URL de Open WebUI no es válida.")
            return
        }
        let profile = configuration.activeConnection
        guard profile.tunnel.enabled else {
            NSWorkspace.shared.open(url)
            return
        }
        guard !operationInProgress else { return }
        operationInProgress = true
        operationTask = Task {
            defer { operationInProgress = false }
            do {
                try await startTunnel(profile)
                for _ in 0..<20 {
                    if await endpointReachable(url) {
                        NSWorkspace.shared.open(url)
                        lastError = nil
                        return
                    }
                    try await Task.sleep(nanoseconds: 250_000_000)
                }
                throw RemoteActionError.tunnelFailed
            } catch {
                lastError = error.localizedDescription
                statusMessage = String(localized: "Open WebUI no disponible")
            }
        }
    }

    func openComfyUI() {
        let profile = configuration.activeConnection
        guard let url = profile.resolvedComfyUIURL else {
            lastError = String(localized: "La URL de ComfyUI no es válida.")
            return
        }
        guard profile.tunnel.enabled else {
            NSWorkspace.shared.open(url)
            return
        }
        guard !operationInProgress else { return }
        operationInProgress = true
        operationTask = Task {
            defer { operationInProgress = false }
            do {
                try await startTunnel(profile)
                let healthURL = url.appending(path: "system_stats")
                for _ in 0..<20 {
                    if await endpointReachable(healthURL) {
                        NSWorkspace.shared.open(url)
                        lastError = nil
                        return
                    }
                    try await Task.sleep(nanoseconds: 250_000_000)
                }
                throw RemoteActionError.tunnelFailed
            } catch {
                lastError = error.localizedDescription
                statusMessage = String(localized: "ComfyUI no disponible")
            }
        }
    }

    var webApps: [WebApp] {
        overview?.webApps ?? []
    }

    func openWebApp(_ app: WebApp) {
        if app.reachable == false {
            reportWebAppProblem(app, String(localized: "\(app.alias) no responde en el puerto \(String(app.port)) del DGX. Revisa en Perfiles que el puerto web coincida con el que usa la app."))
            return
        }
        let profile = configuration.activeConnection
        guard profile.tunnel.enabled else {
            var components = URLComponents()
            components.scheme = "http"
            components.host = profile.apiHost
            components.port = app.port
            components.path = "/"
            if let url = components.url {
                NSWorkspace.shared.open(url)
            }
            return
        }
        guard let url = app.localURL else {
            reportWebAppProblem(app, String(localized: "\(app.alias) no tiene un puerto web válido"))
            return
        }
        Task {
            if await endpointReachable(url) {
                NSWorkspace.shared.open(url)
                lastError = nil
                return
            }
            guard !operationInProgress else {
                reportWebAppProblem(app, String(localized: "Espera a que termine la operación en curso para abrir \(app.alias)"))
                return
            }
            startWebAppTunnel(app, url: url, profile: profile)
        }
    }

    private func startWebAppTunnel(_ app: WebApp, url: URL, profile: ConnectionProfile) {
        operationInProgress = true
        operationTask = Task {
            defer { operationInProgress = false }
            do {
                try await startTunnel(profile, extraForwards: [(url, app.forwardSpecification)])
                for _ in 0..<20 {
                    if await endpointReachable(url) {
                        NSWorkspace.shared.open(url)
                        lastError = nil
                        return
                    }
                    try await Task.sleep(nanoseconds: 250_000_000)
                }
                throw RemoteActionError.webAppUnavailable(app.alias, app.port)
            } catch {
                if let owner = await localPortListener(app.port), owner != "ssh" {
                    reportWebAppProblem(app, String(localized: "El puerto \(String(app.port)) de este Mac lo usa \(owner), así que el túnel no puede abrir \(app.alias). Cierra \(owner) o cambia el puerto web de la app en Perfiles."))
                } else {
                    reportWebAppProblem(app, error.localizedDescription)
                }
            }
        }
    }

    /// The menu has no room for error text, so a failed open is also reported as a notification.
    private func reportWebAppProblem(_ app: WebApp, _ message: String) {
        lastError = message
        statusMessage = String(localized: "\(app.alias) no disponible")
        AppNotifications.send(title: statusMessage, body: message)
    }

    /// Keeps a forward open for each running web app so the Summary links in the browser also work over the tunnel.
    private func ensureWebAppForwards(_ apps: [WebApp]) async {
        let profile = configuration.activeConnection
        guard profile.tunnel.enabled, managedTunnelRunning else { return }
        for app in apps where app.state == "running" {
            guard let url = app.localURL, !(await endpointReachable(url)) else { continue }
            let status = await addSSHForward(profile, specification: app.forwardSpecification)
            if status != 0 {
                appendTunnelLog(profile, "web app \(app.name): redirección del puerto \(app.port) falló (ssh \(status))")
            }
        }
    }

    private func appendTunnelLog(_ profile: ConnectionProfile, _ message: String) {
        let url = SupportLayout.logs.appendingPathComponent("tunnel-\(profile.id).log")
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data("\(Date()) \(message)\n".utf8))
    }

    enum CodingAgent: String, CaseIterable, Identifiable {
        case claude
        case opencode

        var id: String { rawValue }

        var title: String {
            switch self {
            case .claude: return "Claude Code"
            case .opencode: return "OpenCode"
            }
        }

        /// Workspace the agent's script switches to when launched from the MyDGX directory.
        var workspace: String {
            switch self {
            case .claude: return "~/claude-code"
            case .opencode: return "~/opencode"
            }
        }
    }

    /// Mirrors the launchers' minimum (MYDGX_AGENT_MIN_CONTEXT): system prompt plus tools take
    /// about 16k tokens before the first message.
    static let codingAgentMinContext = 32_768

    private struct GatewayModelList: Decodable {
        struct Item: Decodable {
            struct Capabilities: Decodable {
                let tools: Bool?
            }

            let id: String
            let task: String?
            let contextLength: Int?
            let capabilities: Capabilities?

            enum CodingKeys: String, CodingKey {
                case id, task, capabilities
                case contextLength = "context_length"
            }
        }

        let data: [Item]
    }

    private func setCodingAgentBlockReason(_ reason: String?) {
        if codingAgentBlockReason != reason {
            codingAgentBlockReason = reason
        }
    }

    /// Returns an empty string when the gateway publishes a chat or vision model with tool
    /// calling and enough context for the agents; otherwise an explanation for the user.
    private func codingAgentReadinessProblem() async -> String {
        let port = configuration.activeConnection.tunnel.localGatewayPort
        guard let url = URL(string: "http://127.0.0.1:\(port)/v1/models") else {
            return String(localized: "El puerto local del gateway no es válido.")
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.timeoutInterval = 4
        let list: GatewayModelList
        do {
            let (data, response) = try await Self.probeSession.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return String(localized: "El gateway no publica modelos: no hay ningún perfil cargado.")
            }
            list = try JSONDecoder().decode(GatewayModelList.self, from: data)
        } catch {
            return String(localized: "El gateway de MyDGX no responde por el túnel.")
        }
        let minimum = Self.codingAgentMinContext
        let text = list.data.filter { ["chat", "vision"].contains($0.task ?? "chat") }
        if text.isEmpty {
            return String(localized: "No hay ningún modelo de texto cargado. Carga un perfil con un modelo de chat.")
        }
        let roomy = text.filter { ($0.contextLength ?? 0) >= minimum }
        if roomy.isEmpty {
            let loaded = text
                .map { "\($0.id) (\(($0.contextLength ?? 0) / 1024)k)" }
                .joined(separator: ", ")
            return String(localized: "Ningún modelo de texto llega a \(minimum / 1024)k de contexto (cargados: \(loaded)). Sube el contexto del perfil o carga otro modelo.")
        }
        if !roomy.contains(where: { $0.capabilities?.tools ?? true }) {
            return String(localized: "Los modelos con contexto suficiente no admiten tool calling (llama.cpp sin --jinja).")
        }
        return ""
    }

    private func updateCodingAgentReadiness() async {
        let problem = await codingAgentReadinessProblem()
        await waitWhileMenuIsOpen()
        setCodingAgentBlockReason(problem.isEmpty ? nil : problem)
    }

    /// Opens Terminal on this Mac and runs `start.sh claude|opencode` from the local MyDGX project.
    /// The script switches to its workspace (~/claude-code, ~/opencode) and reaches the Spark's
    /// gateway through this tray's tunnel (`localGatewayPort` of the active profile).
    func openCodingAgent(_ agent: CodingAgent, active: Bool) {
        Task {
            let problem = await codingAgentReadinessProblem()
            setCodingAgentBlockReason(problem.isEmpty ? nil : problem)
            guard problem.isEmpty else {
                lastError = String(localized: "\(agent.title) no se puede abrir: \(problem)")
                return
            }
            launchCodingAgent(agent, active: active)
        }
    }

    private func launchCodingAgent(_ agent: CodingAgent, active: Bool) {
        do {
            let profile = configuration.activeConnection
            let source = try deploymentSource(profile)
            try SupportLayout.install()
            let mode = active ? " --active" : ""
            let scriptURL = SupportLayout.bin.appendingPathComponent("\(agent.rawValue).command")
            // Without COLORTERM the agents' TUIs fall back to a reduced palette.
            let script = """
            #!/bin/zsh
            export COLORTERM=truecolor
            cd \(shellQuote(source)) && exec ./start.sh \(agent.rawValue)\(mode)

            """
            try Data(script.utf8).write(to: scriptURL, options: .atomic)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: scriptURL.path
            )
            if let iTerm = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.googlecode.iterm2") {
                NSWorkspace.shared.open(
                    [scriptURL],
                    withApplicationAt: iTerm,
                    configuration: NSWorkspace.OpenConfiguration()
                )
            } else {
                NSWorkspace.shared.open(scriptURL)
            }
        } catch {
            lastError = error.localizedDescription
        }
    }

    func openSSH() {
        do {
            let profile = configuration.activeConnection
            guard !profile.ssh.host.isEmpty, !profile.ssh.user.isEmpty else {
                throw RemoteActionError.incompleteSSH
            }
            try validateSSHCredentials(profile)
            try SupportLayout.install()
            let command = (["/usr/bin/ssh"] + sshBaseArguments(profile) + [remoteTarget(profile)])
                .map(shellQuote)
                .joined(separator: " ")
            let scriptURL = SupportLayout.bin.appendingPathComponent("ssh-\(profile.id).command")
            let script = "#!/bin/zsh\nexec \(command)\n"
            try Data(script.utf8).write(to: scriptURL, options: .atomic)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: scriptURL.path
            )
            NSWorkspace.shared.open(scriptURL)
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// A configured "Proyecto local" wins; otherwise the project bundled with the app is used.
    func canDeploy(_ profile: ConnectionProfile) -> Bool {
        !Self.configuredSourcePath(profile).isEmpty || SupportLayout.bundledSource != nil
    }

    func deploymentSourceDescription(_ profile: ConnectionProfile) -> String {
        let configured = Self.configuredSourcePath(profile)
        if !configured.isEmpty { return configured }
        return String(localized: "la versión \(SupportLayout.bundledSourceVersion) incluida en MyDGXTray")
    }

    private static func configuredSourcePath(_ profile: ConnectionProfile) -> String {
        let path = NSString(string: profile.deployment.sourcePath).expandingTildeInPath
        // Older builds stored the launch directory, which is "/" when opened from Finder.
        return path == "/" ? "" : path
    }

    private func deploymentSource(_ profile: ConnectionProfile) throws -> String {
        let configured = Self.configuredSourcePath(profile)
        if !configured.isEmpty {
            guard SupportLayout.isDeploySource(configured) else {
                throw RemoteActionError.invalidDeploySource
            }
            return configured
        }
        guard SupportLayout.bundledSource != nil else {
            throw RemoteActionError.invalidDeploySource
        }
        return try SupportLayout.stageBundledSource().path
    }

    func openFirstDeployment(for profileID: String) {
        do {
            guard let profile = configuration.connections.first(where: { $0.id == profileID }) else {
                throw ConfigurationError.profileNotFound
            }
            try openTerminalDeployment(
                profile,
                source: try deploymentSource(profile),
                arguments: ["--repair", "--interactive"],
                launcherName: "mydgx-first-deploy-\(profile.id).command",
                completion: "Primer despliegue terminado. MyDGXTray importará la clave API y conectará automáticamente."
            )
            statusMessage = String(localized: "Primer despliegue abierto en Terminal")
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Git checkout used for "Actualizar desde GitHub"; nil for the bundled source.
    func gitHubUpdateSource(_ profile: ConnectionProfile) -> String? {
        let path = Self.configuredSourcePath(profile)
        guard !path.isEmpty, SupportLayout.isDeploySource(path),
              FileManager.default.fileExists(atPath: "\(path)/.git") else { return nil }
        return path
    }

    func openGitHubDeployment(for profileID: String, ref: String = "main") {
        do {
            guard let profile = configuration.connections.first(where: { $0.id == profileID }) else {
                throw ConfigurationError.profileNotFound
            }
            guard let source = gitHubUpdateSource(profile) else {
                throw RemoteActionError.gitHubSourceUnavailable
            }
            try openTerminalDeployment(
                profile,
                source: source,
                arguments: ["--github", ref, "--interactive"],
                launcherName: "mydgx-github-deploy-\(profile.id).command",
                completion: "Actualización desde GitHub terminada."
            )
            statusMessage = String(localized: "Actualización desde GitHub abierta en Terminal")
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func openTerminalDeployment(
        _ profile: ConnectionProfile,
        source: String,
        arguments: [String],
        launcherName: String,
        completion: String
    ) throws {
        try profile.validate()
        try validateSSHCredentials(profile)
        try SupportLayout.install()
        let launcher = SupportLayout.bin.appendingPathComponent(launcherName)
        let command = ([
            "\(source)/start.sh", "deploy",
            remoteTarget(profile),
            "-p", String(selectedSSHEndpoints[profile.id]?.port ?? profile.ssh.port),
            "-i", NSString(string: profile.ssh.identityFile).expandingTildeInPath,
        ] + arguments).map(shellQuote).joined(separator: " ")
        let script = """
        #!/bin/zsh
        set -euo pipefail
        export MYDGX_LANGUAGE=\(AppLanguage.active.rawValue)
        cd \(shellQuote(source))
        \(command)
        print
        print \(shellQuote(completion))
        print -n "Pulsa una tecla para cerrar…"
        read -k 1
        print
        """
        try Data(script.utf8).write(to: launcher, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: launcher.path
        )
        NSWorkspace.shared.open(launcher)
    }

    func activateAndStart(_ profile: InferenceProfile) async {
        guard !operationInProgress else { return }
        operationInProgress = true
        defer { operationInProgress = false }
        lastProfileJobPhase = nil
        pendingProfileName = profile.name
        do {
            let client = try MyDGXClient(configuration: self.configuration)
            let plan = try await client.runtimePlan(profileID: profile.id)
            guard plan.fits else {
                throw RemoteActionError.profilePreflightFailed(profilePlanFailure(plan))
            }
            let jobID = try await client.start(profileID: profile.id)
            let deadline = Date().addingTimeInterval(30 * 60)
            var consecutivePollingFailures = 0
            while Date() < deadline {
                let job: JobStatus
                do {
                    job = try await client.job(jobID: jobID)
                    consecutivePollingFailures = 0
                } catch {
                    consecutivePollingFailures += 1
                    machineActivity = String(localized: "Recuperando seguimiento · intento \(consecutivePollingFailures)/10")
                    if consecutivePollingFailures >= 10 {
                        throw error
                    }
                    try await Task.sleep(nanoseconds: 2_000_000_000)
                    continue
                }
                await waitWhileMenuIsOpen()
                updateProfileJob(job, profile: profile)
                if job.status == "completed" {
                    lastError = nil
                    await refresh()
                    pendingProfileName = nil
                    return
                }
                if ["failed", "cancelled"].contains(job.status) {
                    throw RemoteActionError.profileJobFailed(job.message)
                }
                try await Task.sleep(nanoseconds: 1_000_000_000)
            }
            if let state = try? await client.profiles(),
               state.runtime.running,
               state.runtime.profileIDs.contains(profile.id) {
                profiles = state.profiles
                runtime = state.runtime
                machineActivity = String(localized: "Perfil cargado: \(profile.name)")
                pendingProfileName = nil
                lastError = nil
                notifyProfilePhase(.profileLoaded, profile: profile)
                return
            }
            throw RemoteActionError.profileJobTimedOut
        } catch {
            machineActivity = String(localized: "Error al cargar \(profile.name)")
            machineActivityIsError = true
            pendingProfileName = nil
            lastError = error.localizedDescription
            notifyProfilePhase(.failed, profile: profile)
        }
    }

    func profileRuntimePlan(_ profile: InferenceProfile) async throws -> ProfileRuntimePlan {
        let client = try MyDGXClient(configuration: configuration)
        return try await client.runtimePlan(profileID: profile.id)
    }

    func profilePlanFailure(_ plan: ProfileRuntimePlan) -> String {
        if plan.exceedsLLMLimit {
            return String(localized: "Ya hay dos perfiles o modelos Quick cargados.")
        }
        if !plan.aliasConflicts.isEmpty, !plan.portConflicts.isEmpty {
            return String(localized: "Alias incompatibles: \(plan.aliasConflicts.joined(separator: ", ")); puertos ocupados: \(plan.portConflicts.map(String.init).joined(separator: ", ")).")
        }
        if !plan.aliasConflicts.isEmpty {
            return String(localized: "Alias incompatibles: \(plan.aliasConflicts.joined(separator: ", ")).")
        }
        if !plan.portConflicts.isEmpty {
            return String(localized: "Puertos ocupados: \(plan.portConflicts.map(String.init).joined(separator: ", ")).")
        }
        if plan.requiredMB > plan.capacityMB {
            return String(
                format: String(localized: "Los perfiles requieren %.1f GB en total y la capacidad segura es %.1f GB."),
                Double(plan.requiredMB) / 1024,
                Double(plan.capacityMB) / 1024
            )
        }
        if plan.incrementalMB + plan.reserveMB > plan.availableMB {
            return String(
                format: String(localized: "Se necesitan %.1f GB adicionales más %.1f GB de reserva; hay %.1f GB libres."),
                Double(plan.incrementalMB) / 1024,
                Double(plan.reserveMB) / 1024,
                Double(plan.availableMB) / 1024
            )
        }
        return String(localized: "La combinación no supera el preflight de memoria y compatibilidad.")
    }

    func stopQuickModel(_ quickModel: ProfileModelSummary) async {
        guard !operationInProgress else { return }
        operationInProgress = true
        defer { operationInProgress = false }
        await perform {
            try await MyDGXClient(configuration: self.configuration).stopQuickModel(quickModel)
            self.machineActivity = String(localized: "Modelo apagado: \(quickModel.label)")
        }
    }

    func stopProfile(_ profile: InferenceProfile) async {
        guard !operationInProgress else { return }
        operationInProgress = true
        defer { operationInProgress = false }
        await perform {
            try await MyDGXClient(configuration: self.configuration).stopProfile(profileID: profile.id)
            self.machineActivity = String(localized: "Perfil detenido: \(profile.name)")
            AppNotifications.send(
                title: String(localized: "Perfil detenido"),
                body: String(localized: "\(profile.name) se detuvo en \(self.configuration.activeConnection.alias).")
            )
        }
    }

    func shutdown() async {
        guard !operationInProgress else { return }
        operationInProgress = true
        defer { operationInProgress = false }
        do {
            let result = try await self.runSSH(arguments: ["sudo", "-n", "/usr/sbin/shutdown", "-h", "now"])
            guard result == 0 else {
                throw RemoteActionError.commandFailed(result)
            }
            statusMessage = String(localized: "Apagando…")
            AppNotifications.send(
                title: String(localized: "Apagado solicitado"),
                body: String(localized: "Esperando confirmación de \(configuration.activeConnection.alias).")
            )
            for _ in 0..<40 {
                try await Task.sleep(nanoseconds: 3_000_000_000)
                let sshStatus = (try? await runSSH(arguments: ["true"])) ?? -1
                if sshStatus != 0 {
                    overview = nil
                    profiles = []
                    runtime = nil
                    statusMessage = String(localized: "Apagado")
                    lastError = nil
                    notifyConnectionState(.disconnected)
                    AppNotifications.send(
                        title: String(localized: "Equipo apagado"),
                        body: String(localized: "\(configuration.activeConnection.alias) dejó de responder por SSH.")
                    )
                    return
                }
            }
            statusMessage = String(localized: "Apagado no confirmado")
            AppNotifications.send(
                title: String(localized: "Apagado no confirmado"),
                body: String(localized: "\(configuration.activeConnection.alias) continúa respondiendo por SSH.")
            )
        } catch {
            lastError = error.localizedDescription
            statusMessage = String(localized: "Error al apagar")
            AppNotifications.send(
                title: String(localized: "Error al apagar"),
                body: String(localized: "No se pudo confirmar la orden para \(configuration.activeConnection.alias).")
            )
        }
    }

    private func updateObservedProfileJob(
        _ jobs: [JobStatus],
        profiles: [InferenceProfile]
    ) {
        let activeStatuses = Set(["queued", "running", "cancelling"])
        if let job = jobs.first(where: {
            $0.kind == "profile.prepare-start" && activeStatuses.contains($0.status)
        }) {
            if observedProfileJobID != job.id {
                lastProfileJobPhase = nil
            }
            observedProfileJobID = job.id
            profileJobInProgress = true
            if let profile = profiles.first(where: { $0.id == job.target }) {
                pendingProfileName = profile.name
                updateProfileJob(job, profile: profile)
            } else {
                pendingProfileName = job.target
                machineActivity = String(localized: "Preparando perfil · \(Int(job.progress.rounded()))%")
            }
            return
        }

        profileJobInProgress = false
        guard let observedProfileJobID else { return }
        if let job = jobs.first(where: { $0.id == observedProfileJobID }),
           let profile = profiles.first(where: { $0.id == job.target }) {
            updateProfileJob(job, profile: profile)
            if ["failed", "cancelled"].contains(job.status) {
                lastError = String(localized: "No se pudo cargar el perfil: \(job.message)")
            }
        }
        pendingProfileName = nil
        self.observedProfileJobID = nil
    }

    private func updateProfileJob(_ job: JobStatus, profile: InferenceProfile) {
        let message = job.message.lowercased()
        let phase: ProfileJobPhase
        let label: String
        if job.status == "completed" {
            phase = .profileLoaded
            label = String(localized: "Perfil cargado")
        } else if ["failed", "cancelled"].contains(job.status) {
            phase = .failed
            label = String(localized: "Error al cargar el perfil")
        } else if job.status == "queued" {
            phase = .queued
            label = String(localized: "Perfil en cola")
        } else if job.progress >= 96 || message.contains("modelos cargados") {
            phase = .modelLoaded
            label = String(localized: "Modelo cargado")
        } else if job.progress >= 82 || message.contains("arrancando") {
            phase = .loading
            label = String(localized: "Cargando modelo")
        } else if job.progress >= 76 || message.contains("comprobando archivos") {
            phase = .installing
            label = String(localized: "Instalando modelo")
        } else if message.contains("descargando") || message.contains("preparando") {
            phase = .downloading
            label = String(localized: "Descargando modelo")
        } else {
            phase = .checking
            label = String(localized: "Comprobando modelos")
        }
        let progress = Int(job.progress.rounded())
        machineActivity = phase == .profileLoaded
            ? "\(label): \(profile.name)"
            : "\(label) · \(progress)%"
        machineActivityIsError = phase == .failed
        notifyProfilePhase(phase, profile: profile)
    }

    private func notifyProfilePhase(
        _ phase: ProfileJobPhase,
        profile: InferenceProfile
    ) {
        guard lastProfileJobPhase != phase else { return }
        lastProfileJobPhase = phase
        let title: String
        switch phase {
        case .queued: title = String(localized: "Perfil en cola")
        case .checking: title = String(localized: "Comprobando modelos")
        case .downloading: title = String(localized: "Descargando modelo")
        case .installing: title = String(localized: "Instalando modelo")
        case .loading: title = String(localized: "Cargando modelo")
        case .modelLoaded: title = String(localized: "Modelo cargado")
        case .profileLoaded: title = String(localized: "Perfil cargado")
        case .failed: title = String(localized: "Error al cargar perfil")
        }
        let body = phase == .profileLoaded
            ? String(localized: "\(profile.name) está listo en \(configuration.activeConnection.alias).")
            : String(localized: "\(profile.name) en \(configuration.activeConnection.alias).")
        AppNotifications.send(title: title, body: body)
    }

    private func notifyConnectionState(_ state: ConnectionState) {
        let previous = lastConnectionState
        guard previous != state else { return }
        lastConnectionState = state
        let alias = configuration.activeConnection.alias
        if state == .poweredOff, configuration.activeConnection.kind == .axforge {
            try? FileManager.default.removeItem(
                at: SupportLayout.sessionKnownHosts(
                    profileID: configuration.activeConnection.id
                )
            )
        }

        if previous == nil {
            if state == .undeployed {
                AppNotifications.send(
                    title: String(localized: "MyDGX no desplegado"),
                    body: String(localized: "El túnel con \(alias) funciona, pero la API MyDGX no responde.")
                )
            } else if state == .poweredOff {
                AppNotifications.send(
                    title: String(localized: "Equipo apagado"),
                    body: String(localized: "\(alias) no responde por API ni SSH.")
                )
            }
            return
        }

        switch state {
        case .connected:
            AppNotifications.send(
                title: String(localized: "Conexión restablecida"),
                body: String(localized: "MyDGX vuelve a responder en \(alias).")
            )
        case .disconnected:
            AppNotifications.send(
                title: String(localized: "Equipo desconectado"),
                body: String(localized: "Se perdió o detuvo la conexión con \(alias).")
            )
        case .undeployed:
            AppNotifications.send(
                title: String(localized: "MyDGX no desplegado"),
                body: String(localized: "El túnel con \(alias) funciona, pero la API MyDGX no responde.")
            )
        case .poweredOff:
            AppNotifications.send(
                title: String(localized: "Equipo apagado"),
                body: String(localized: "\(alias) ha dejado de responder por API y SSH.")
            )
        case .saturated:
            AppNotifications.send(
                title: String(localized: "Spark saturado"),
                body: String(localized: "\(alias) se está quedando sin memoria; para un modelo o cancela el trabajo de ComfyUI.")
            )
        case .unresponsive:
            AppNotifications.send(
                title: String(localized: "MyDGX tarda en responder"),
                body: String(localized: "\(alias) responde por SSH, pero la API de MyDGX no contesta a tiempo.")
            )
        }
    }

    /// Exit status 0 means "full avg10" in /proc/pressure/memory reached 40 %, the backend's alert threshold.
    private func remoteMemoryIsSaturated() async -> Bool {
        let script = "awk '/^full/ { split($2, value, \"=\"); pressure = value[2] + 0 } END { exit !(pressure >= 40) }' /proc/pressure/memory"
        return ((try? await runSSH(arguments: [script])) ?? -1) == 0
    }

    private func sshIsUnavailable() async -> Bool {
        for attempt in 0..<2 {
            let status = (try? await runSSH(arguments: ["true"])) ?? -1
            if status == 0 {
                return false
            }
            if attempt == 0 {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
        return true
    }

    private func perform(_ operation: @escaping () async throws -> Void) async {
        do {
            try await operation()
            lastError = nil
            await refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    @discardableResult
    private func selectSSHEndpoint(_ profile: ConnectionProfile) async -> Bool {
        if await ProfileReachability.sshAvailable(
            host: profile.ssh.host,
            port: profile.ssh.port
        ) {
            selectedSSHEndpoints[profile.id] = SSHEndpoint(
                host: profile.ssh.host,
                port: profile.ssh.port,
                isPublic: false
            )
            return true
        }
        if !profile.ssh.publicHost.isEmpty,
           await ProfileReachability.sshAvailable(
               host: profile.ssh.publicHost,
               port: profile.ssh.publicPort
           ) {
            selectedSSHEndpoints[profile.id] = SSHEndpoint(
                host: profile.ssh.publicHost,
                port: profile.ssh.publicPort,
                isPublic: true
            )
            return true
        }
        selectedSSHEndpoints.removeValue(forKey: profile.id)
        return false
    }

    private func profileUsingSelectedSSH(_ profile: ConnectionProfile) -> ConnectionProfile {
        guard let endpoint = selectedSSHEndpoints[profile.id] else { return profile }
        var selected = profile
        selected.ssh.host = endpoint.host
        selected.ssh.port = endpoint.port
        return selected
    }

    private func startTunnel(
        _ profile: ConnectionProfile,
        extraForwards: [(URL, String)] = []
    ) async throws {
        guard !profile.ssh.host.isEmpty, !profile.ssh.user.isEmpty else {
            throw RemoteActionError.incompleteSSH
        }
        guard await selectSSHEndpoint(profile) else {
            throw RemoteActionError.tunnelFailed
        }
        try validateSSHCredentials(profile)
        try SupportLayout.install()
        if await controlMasterRunning(profile) {
            let forwards = [
                (
                    URL(string: "http://127.0.0.1:\(profile.tunnel.localAPIPort)/api/health")!,
                    "\(profile.tunnel.localAPIPort):\(profile.tunnel.remoteAPIHost):\(profile.tunnel.remoteAPIPort)"
                ),
                (
                    URL(string: "http://127.0.0.1:\(profile.tunnel.localOpenWebUIPort)/")!,
                    "\(profile.tunnel.localOpenWebUIPort):\(profile.tunnel.remoteOpenWebUIHost):\(profile.tunnel.remoteOpenWebUIPort)"
                ),
                (
                    URL(string: "http://127.0.0.1:\(profile.tunnel.localComfyUIPort)/system_stats")!,
                    "\(profile.tunnel.localComfyUIPort):\(profile.tunnel.remoteComfyUIHost):\(profile.tunnel.remoteComfyUIPort)"
                ),
                (
                    URL(string: "http://127.0.0.1:\(profile.tunnel.localGatewayPort)/health")!,
                    "\(profile.tunnel.localGatewayPort):\(profile.tunnel.remoteGatewayHost):\(profile.tunnel.remoteGatewayPort)"
                ),
                (
                    URL(string: "http://127.0.0.1:\(profile.tunnel.localDGXDashboardPort)/")!,
                    "\(profile.tunnel.localDGXDashboardPort):\(profile.tunnel.remoteDGXDashboardHost):\(profile.tunnel.remoteDGXDashboardPort)"
                ),
            ] + extraForwards
            for (url, specification) in forwards {
                if !(await endpointReachable(url)) {
                    guard await addSSHForward(profile, specification: specification) == 0 else {
                        throw RemoteActionError.tunnelFailed
                    }
                }
            }
            managedTunnelRunning = true
            tunnelRunning = true
            activeTunnelEndpoints[profile.id] = selectedSSHEndpoints[profile.id]
            statusMessage = String(localized: "Túnel activo · \(profile.alias)")
            return
        }
        if tunnelProcess?.isRunning == true {
            tunnelProcess?.terminate()
            tunnelProcess = nil
            tunnelLog?.closeFile()
            tunnelLog = nil
        }
        let controlSocket = tunnelControlSocket(profile)
        try? FileManager.default.removeItem(at: controlSocket)
        let logURL = SupportLayout.logs.appendingPathComponent("tunnel-\(profile.id).log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let log = try FileHandle(forWritingTo: logURL)
        try log.seekToEnd()

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        var arguments = sshBaseArguments(profile) + [
            "-M",
            "-S", controlSocket.path,
            "-N",
            "-o", "ControlPersist=yes",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
        ]
        if !(await endpointReachable(
            URL(string: "http://127.0.0.1:\(profile.tunnel.localAPIPort)/api/health")!
        )) {
            arguments += [
                "-L", "\(profile.tunnel.localAPIPort):\(profile.tunnel.remoteAPIHost):\(profile.tunnel.remoteAPIPort)",
            ]
        }
        if !(await endpointReachable(
            URL(string: "http://127.0.0.1:\(profile.tunnel.localOpenWebUIPort)/")!
        )) {
            arguments += [
                "-L", "\(profile.tunnel.localOpenWebUIPort):\(profile.tunnel.remoteOpenWebUIHost):\(profile.tunnel.remoteOpenWebUIPort)",
            ]
        }
        if !(await endpointReachable(
            URL(string: "http://127.0.0.1:\(profile.tunnel.localComfyUIPort)/system_stats")!
        )) {
            arguments += [
                "-L", "\(profile.tunnel.localComfyUIPort):\(profile.tunnel.remoteComfyUIHost):\(profile.tunnel.remoteComfyUIPort)",
            ]
        }
        if !(await endpointReachable(
            URL(string: "http://127.0.0.1:\(profile.tunnel.localGatewayPort)/health")!
        )) {
            arguments += [
                "-L", "\(profile.tunnel.localGatewayPort):\(profile.tunnel.remoteGatewayHost):\(profile.tunnel.remoteGatewayPort)",
            ]
        }
        if !(await endpointReachable(
            URL(string: "http://127.0.0.1:\(profile.tunnel.localDGXDashboardPort)/")!
        )) {
            arguments += [
                "-L", "\(profile.tunnel.localDGXDashboardPort):\(profile.tunnel.remoteDGXDashboardHost):\(profile.tunnel.remoteDGXDashboardPort)",
            ]
        }
        for (url, specification) in extraForwards where !(await endpointReachable(url)) {
            arguments += ["-L", specification]
        }
        if !arguments.contains("-L") {
            managedTunnelRunning = false
            tunnelRunning = true
            statusMessage = String(localized: "Túneles externos disponibles · \(profile.alias)")
            log.closeFile()
            return
        }
        arguments.append(remoteTarget(profile))
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = log
        process.standardError = log
        process.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                self?.tunnelRunning = false
                self?.managedTunnelRunning = false
                self?.activeTunnelEndpoints.removeValue(forKey: profile.id)
            }
        }
        try process.run()
        tunnelProcess = process
        tunnelLog = log
        try await Task.sleep(nanoseconds: 500_000_000)
        guard process.isRunning else {
            tunnelProcess = nil
            log.closeFile()
            tunnelLog = nil
            throw RemoteActionError.tunnelFailed
        }
        managedTunnelRunning = true
        tunnelRunning = true
        activeTunnelEndpoints[profile.id] = selectedSSHEndpoints[profile.id]
        statusMessage = String(localized: "Túnel activo · \(profile.alias)")
    }

    /// A cached response would report a port as reachable after its forward is gone.
    private static let probeSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        return URLSession(configuration: configuration)
    }()

    private func endpointReachable(_ url: URL) async -> Bool {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.timeoutInterval = 1
        do {
            let (_, response) = try await Self.probeSession.data(for: request)
            return response is HTTPURLResponse
        } catch {
            return false
        }
    }

    private func detectTunnel() async -> (available: Bool, managed: Bool) {
        let profile = configuration.activeConnection
        guard profile.tunnel.enabled else { return (false, false) }
        guard let apiURL = URL(
            string: "http://127.0.0.1:\(profile.tunnel.localAPIPort)/api/health"
        ), let openWebUIURL = URL(
            string: "http://127.0.0.1:\(profile.tunnel.localOpenWebUIPort)/"
        ), let comfyUIURL = URL(
            string: "http://127.0.0.1:\(profile.tunnel.localComfyUIPort)/system_stats"
        ), let gatewayURL = URL(
            string: "http://127.0.0.1:\(profile.tunnel.localGatewayPort)/health"
        ) else {
            return (false, false)
        }
        try? SupportLayout.install()
        async let apiReachable = endpointReachable(apiURL)
        async let openWebUIReachable = endpointReachable(openWebUIURL)
        async let comfyUIReachable = endpointReachable(comfyUIURL)
        async let gatewayReachable = endpointReachable(gatewayURL)
        async let managed = controlMasterRunning(profile)
        let (
            apiAvailable, openWebUIAvailable, comfyUIAvailable,
            gatewayAvailable, managedAvailable
        ) = await (
            apiReachable,
            openWebUIReachable,
            comfyUIReachable,
            gatewayReachable,
            managed
        )
        return (
            apiAvailable && openWebUIAvailable && comfyUIAvailable && gatewayAvailable,
            managedAvailable
        )
    }

    private func tunnelControlSocket(_ profile: ConnectionProfile) -> URL {
        let safeID = profile.id.replacingOccurrences(
            of: #"[^A-Za-z0-9_-]"#,
            with: "_",
            options: .regularExpression
        )
        return SupportLayout.run.appendingPathComponent("tunnel-\(safeID.prefix(48)).sock")
    }

    private func controlMasterRunning(_ profile: ConnectionProfile) async -> Bool {
        await runSSHControl(profile, command: "check") == 0
    }

    private func runSSHControl(_ profile: ConnectionProfile, command: String) async -> Int32 {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
            process.arguments = sshBaseArguments(profile) + [
                "-S", tunnelControlSocket(profile).path,
                "-O", command,
                remoteTarget(profile),
            ]
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            process.terminationHandler = { completed in
                continuation.resume(returning: completed.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(returning: -1)
            }
        }
    }

    /// Name of the process listening on a local TCP port, or nil when the port is free.
    private func localPortListener(_ port: Int) async -> String? {
        await withCheckedContinuation { continuation in
            let process = Process()
            let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
            process.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-Fc"]
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = pipe
            process.standardError = FileHandle.nullDevice
            process.terminationHandler = { _ in
                let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                let name = output.split(separator: "\n").first { $0.hasPrefix("c") }.map { String($0.dropFirst()) }
                continuation.resume(returning: name)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(returning: nil)
            }
        }
    }

    private func addSSHForward(_ profile: ConnectionProfile, specification: String) async -> Int32 {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
            process.arguments = sshBaseArguments(profile) + [
                "-S", tunnelControlSocket(profile).path,
                "-O", "forward",
                "-L", specification,
                remoteTarget(profile),
            ]
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            process.terminationHandler = { completed in
                continuation.resume(returning: completed.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(returning: -1)
            }
        }
    }

    private func backup(_ profile: ConnectionProfile) async throws -> URL {
        guard !profile.ssh.host.isEmpty, !profile.ssh.user.isEmpty else {
            throw RemoteActionError.incompleteSSH
        }
        guard await selectSSHEndpoint(profile) else {
            throw RemoteActionError.tunnelFailed
        }
        try validateSSHCredentials(profile)
        try SupportLayout.install()

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
        let timestamp = formatter.string(from: Date())
        let safeAlias = profile.alias
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: "-")
        let profileDirectory = SupportLayout.backups.appendingPathComponent(
            safeAlias.isEmpty ? profile.id : safeAlias,
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: profileDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let destination = profileDirectory.appendingPathComponent(timestamp, isDirectory: true)
        let staging = profileDirectory.appendingPathComponent(".\(timestamp)-\(UUID().uuidString)", isDirectory: true)
        let archive = SupportLayout.backups.appendingPathComponent(".backup-\(UUID().uuidString).tar.gz")
        try FileManager.default.createDirectory(
            at: staging,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        defer {
            try? FileManager.default.removeItem(at: archive)
            try? FileManager.default.removeItem(at: staging)
        }

        let remoteScript = """
        set -euo pipefail
        remote_dir="$1"
        [[ "$remote_dir" =~ ^[A-Za-z0-9._/-]+$ && "$remote_dir" != /* && "$remote_dir" != *".."* ]] || exit 2
        app_root="$HOME/$remote_dir"
        python="$app_root/.venv/bin/python"
        [[ -x "$python" && -f "$app_root/backend/main.py" ]] || {
          echo "MyDGX no está instalado en el directorio configurado." >&2
          exit 1
        }
        snapshot="$(mktemp -d)"
        trap 'rm -rf -- "$snapshot"' EXIT
        mkdir -p "$snapshot/open-webui"
        cd "$app_root"
        "$python" - "$snapshot/mydgx.db" "$snapshot/manifest.json" <<'PY'
        import datetime
        import json
        import pathlib
        import socket
        import sqlite3
        import sys

        from backend.main import settings

        source = pathlib.Path(settings.database_path).expanduser()
        if not source.is_absolute():
            source = pathlib.Path.cwd() / source
        if not source.is_file():
            raise SystemExit(f"No existe la base de datos MyDGX: {source}")
        with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as src:
            with sqlite3.connect(sys.argv[1]) as dst:
                src.backup(dst)
                if dst.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise SystemExit("La copia de MyDGX no superó PRAGMA quick_check.")
        pathlib.Path(sys.argv[2]).write_text(json.dumps({
            "format": 1,
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "host": socket.gethostname(),
            "contents": ["mydgx.db", "open-webui/"],
            "excluded": [".env", "SSH keys", "model files", "caches"],
        }, indent=2) + "\\n", encoding="utf-8")
        PY
        webui_data="$HOME/.local/share/mydgx/open-webui/data"
        if [[ -d "$webui_data" ]]; then
          cp -a "$webui_data/." "$snapshot/open-webui/"
          find "$snapshot/open-webui" -type l -delete
          if [[ -f "$webui_data/webui.db" ]]; then
            rm -f "$snapshot/open-webui/webui.db" \
              "$snapshot/open-webui/webui.db-wal" "$snapshot/open-webui/webui.db-shm"
            "$python" - "$webui_data/webui.db" "$snapshot/open-webui/webui.db" <<'PY'
        import pathlib
        import sqlite3
        import sys

        source = pathlib.Path(sys.argv[1])
        with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as src:
            with sqlite3.connect(sys.argv[2]) as dst:
                src.backup(dst)
                if dst.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise SystemExit("La copia de Open WebUI no superó PRAGMA quick_check.")
        PY
          fi
        fi
        chmod 0600 "$snapshot/mydgx.db" "$snapshot/manifest.json"
        tar -C "$snapshot" -czf - .
        """

        let archiveStatus = try await runBackupArchive(
            profile: profile,
            remoteCommand: "bash -s -- \(shellQuote(profile.deployment.remoteDirectory))",
            script: remoteScript,
            archive: archive
        )
        guard archiveStatus == 0 else {
            throw RemoteActionError.backupFailed(archiveStatus)
        }
        let extractStatus = try await runProcess(
            executable: "/usr/bin/tar",
            arguments: ["-xzf", archive.path, "-C", staging.path],
            logName: "backup-\(profile.id).log"
        )
        guard extractStatus == 0,
              FileManager.default.fileExists(
                atPath: staging.appendingPathComponent("mydgx.db").path
              ) else {
            throw RemoteActionError.invalidBackup
        }
        try secureBackupTree(staging)
        try FileManager.default.moveItem(at: staging, to: destination)
        return destination
    }

    private func runBackupArchive(
        profile: ConnectionProfile,
        remoteCommand: String,
        script: String,
        archive: URL
    ) async throws -> Int32 {
        let logURL = SupportLayout.logs.appendingPathComponent("backup-\(profile.id).log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        FileManager.default.createFile(atPath: archive.path, contents: nil)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: archive.path
        )
        let log = try FileHandle(forWritingTo: logURL)
        let output = try FileHandle(forWritingTo: archive)
        try log.seekToEnd()
        return try await withCheckedThrowingContinuation { continuation in
            let input = Pipe()
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
            process.arguments = sshBaseArguments(profile) + [
                remoteTarget(profile),
                remoteCommand,
            ]
            process.standardInput = input
            process.standardOutput = output
            process.standardError = log
            process.terminationHandler = { completed in
                output.closeFile()
                log.closeFile()
                continuation.resume(returning: completed.terminationStatus)
            }
            do {
                try process.run()
                input.fileHandleForWriting.write(Data(script.utf8))
                input.fileHandleForWriting.closeFile()
            } catch {
                input.fileHandleForWriting.closeFile()
                output.closeFile()
                log.closeFile()
                continuation.resume(throwing: error)
            }
        }
    }

    private func secureBackupTree(_ root: URL) throws {
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: []
        ) else {
            return
        }
        for case let item as URL in enumerator {
            let values = try item.resourceValues(forKeys: [.isDirectoryKey])
            try FileManager.default.setAttributes(
                [.posixPermissions: values.isDirectory == true ? 0o700 : 0o600],
                ofItemAtPath: item.path
            )
        }
    }

    private func deploy(_ profile: ConnectionProfile) async throws {
        guard !profile.ssh.host.isEmpty, !profile.ssh.user.isEmpty else {
            throw RemoteActionError.incompleteSSH
        }
        guard await selectSSHEndpoint(profile) else {
            throw RemoteActionError.tunnelFailed
        }
        try validateSSHCredentials(profile)
        let source = try deploymentSource(profile)
        try SupportLayout.install()
        let sshCommand = (["/usr/bin/ssh"] + sshBaseArguments(profile))
            .map(shellQuote)
            .joined(separator: " ")
        let destination = "\(remoteTarget(profile)):\(profile.deployment.remoteDirectory)/"
        updateDeployment(
            progress: 0.06,
            phase: String(localized: "Sincronizando proyecto"),
            detail: String(localized: "Calculando los archivos que deben copiarse.")
        )
        let rsyncStatus = try await runProcess(
            executable: "/usr/bin/rsync",
            arguments: [
                "-az", "--delete", "--progress",
                "--exclude=.env",
                "--exclude=.venv/",
                "--exclude=frontend/node_modules/",
                "--exclude=.tmp-pycache/",
                "--exclude=__pycache__/",
                "--exclude=*.pyc",
                "--exclude=data/",
                "--exclude=logs/",
                "--exclude=macos/MyDGXTray/.build/",
                "--exclude=macos/MyDGXTray/dist/",
                "-e", sshCommand,
                source.hasSuffix("/") ? source : "\(source)/",
                destination,
            ],
            logName: "deploy-\(profile.id).log",
            onOutput: { [weak self] output in
                self?.handleRsyncOutput(output)
            }
        )
        guard rsyncStatus == 0 else {
            throw RemoteActionError.deployFailed(rsyncStatus)
        }
        updateDeployment(
            progress: 0.38,
            phase: String(localized: "Proyecto sincronizado"),
            detail: String(localized: "Iniciando la preparación remota de MyDGX.")
        )
        let remoteDirectory = profile.deployment.remoteDirectory
        let openWebUIPublicURL = "http://127.0.0.1:\(profile.tunnel.localOpenWebUIPort)"
        let comfyUIPublicURL = "http://127.0.0.1:\(profile.tunnel.localComfyUIPort)"
        let remoteCommand = "cd \(shellQuote(remoteDirectory)) && chmod +x scripts/deploy-from-tray.sh && MYDGX_LANGUAGE=\(AppLanguage.active.rawValue) MYDGX_OPENWEBUI_PUBLIC_URL=\(shellQuote(openWebUIPublicURL)) MYDGX_COMFYUI_PUBLIC_URL=\(shellQuote(comfyUIPublicURL)) ./scripts/deploy-from-tray.sh"
        let sshStatus = try await runProcess(
            executable: "/usr/bin/ssh",
            arguments: sshBaseArguments(profile) + [remoteTarget(profile), remoteCommand],
            logName: "deploy-\(profile.id).log",
            onOutput: { [weak self] output in
                self?.handleRemoteDeploymentOutput(output)
            }
        )
        guard sshStatus == 0 else {
            throw RemoteActionError.deployFailed(sshStatus)
        }
    }

    func openDeploymentLog() {
        let profile = configuration.activeConnection
        let url = SupportLayout.logs.appendingPathComponent("deploy-\(profile.id).log")
        guard FileManager.default.fileExists(atPath: url.path) else {
            lastError = String(localized: "Todavía no existe un log de despliegue para este equipo.")
            return
        }
        NSWorkspace.shared.open(url)
    }

    private func updateDeployment(progress: Double, phase: String, detail: String) {
        deploymentStatus = DeploymentStatus(
            progress: max(0, min(1, progress)),
            phase: phase,
            detail: String(detail.prefix(300)),
            error: nil,
            completed: false
        )
    }

    private func handleRsyncOutput(_ output: String) {
        let lines = output.split(whereSeparator: \.isNewline)
        guard let line = lines.last else { return }
        let text = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
        let percentage = text.range(
            of: #"([0-9]{1,3})%"#,
            options: .regularExpression
        ).flatMap { range -> Double? in
            Double(text[range].dropLast())
        }
        let progress = 0.06 + min(100, percentage ?? 0) / 100 * 0.30
        updateDeployment(
            progress: progress,
            phase: String(localized: "Sincronizando proyecto"),
            detail: percentage.map { String(localized: "Transferencia: \(Int($0))%") } ?? text
        )
    }

    private func handleRemoteDeploymentOutput(_ output: String) {
        let lines = output.split(whereSeparator: \.isNewline)
        guard let line = lines.last else { return }
        let text = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let lower = text.lowercased()
        let progress: Double
        let phase: String
        // deploy.sh prints these markers in MYDGX_LANGUAGE (es or en).
        if lower.contains("instalando mydgx") || lower.contains("mydgx preparado")
            || lower.contains("installing mydgx") || lower.contains("mydgx ready") {
            progress = 0.55
            phase = String(localized: "Preparando MyDGX")
        } else if lower.contains("open webui preparado") || lower.contains("open webui ready") {
            progress = 0.74
            phase = String(localized: "Preparando Open WebUI")
        } else if lower.contains("systemd") || lower.contains("supervisor local") || lower.contains("local supervisor") {
            progress = 0.84
            phase = String(localized: "Reiniciando servicios")
        } else if lower.contains("comprobando preparación") || lower.contains("checking mydgx readiness") {
            progress = 0.93
            phase = String(localized: "Comprobando el sistema")
        } else if lower.contains("versiones desplegadas") || lower.contains("deployed versions") {
            progress = 0.98
            phase = String(localized: "Verificando versiones")
        } else {
            progress = max(0.40, deploymentStatus?.progress ?? 0.40)
            phase = deploymentStatus?.phase ?? String(localized: "Preparando equipo remoto")
        }
        updateDeployment(progress: progress, phase: phase, detail: text)
    }

    private func deploymentDiagnostic(profile: ConnectionProfile) -> String? {
        let url = SupportLayout.logs.appendingPathComponent("deploy-\(profile.id).log")
        guard let data = try? Data(contentsOf: url),
              let text = String(data: data.suffix(65_536), encoding: .utf8) else {
            return nil
        }
        if text.contains("REMOTE HOST IDENTIFICATION HAS CHANGED") {
            return profile.kind == .axforge
                ? String(localized: "AxForge cambió la clave SSH de esta instancia. Reinicia MyDGXTray para fijar la clave de la sesión actual y vuelve a desplegar.")
                : String(localized: "La identidad SSH del equipo cambió. Verifica su huella antes de actualizar known_hosts.")
        }
        if text.localizedCaseInsensitiveContains("permission denied") {
            return String(localized: "SSH rechazó la autenticación. Comprueba el usuario, la clave privada y sus permisos.")
        }
        if text.contains("sudo:") {
            return String(localized: "El equipo remoto necesita permisos sudo no interactivos para los comandos de instalación autorizados.")
        }
        if text.localizedCaseInsensitiveContains("no space left") {
            return String(localized: "El equipo remoto no tiene espacio suficiente para completar el despliegue.")
        }
        if text.localizedCaseInsensitiveContains("connection refused") {
            return String(localized: "El puerto SSH remoto rechazó la conexión.")
        }
        return nil
    }

    private func sshBaseArguments(_ profile: ConnectionProfile) -> [String] {
        let endpoint = selectedSSHEndpoints[profile.id]
        let knownHosts = profile.kind == .axforge
            ? SupportLayout.sessionKnownHosts(profileID: profile.id)
            : SupportLayout.knownHosts
        var arguments = [
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=15",
            "-o", "UserKnownHostsFile=\(knownHosts.path)",
            "-o", "StrictHostKeyChecking=accept-new",
            "-p", String(endpoint?.port ?? profile.ssh.port),
        ]
        if !profile.ssh.identityFile.isEmpty {
            arguments += [
                "-o", "IdentitiesOnly=yes",
                "-i", NSString(string: profile.ssh.identityFile).expandingTildeInPath,
            ]
        }
        return arguments
    }

    private func remoteTarget(_ profile: ConnectionProfile) -> String {
        "\(profile.ssh.user)@\(selectedSSHEndpoints[profile.id]?.host ?? profile.ssh.host)"
    }

    private func validateSSHCredentials(_ profile: ConnectionProfile) throws {
        guard !profile.ssh.identityFile.isEmpty else { return }
        let path = NSString(string: profile.ssh.identityFile).expandingTildeInPath
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
              let permissions = attributes[.posixPermissions] as? NSNumber,
              permissions.intValue & 0o077 == 0 else {
            throw RemoteActionError.unsafeIdentity
        }
    }

    private func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    private func runProcess(
        executable: String,
        arguments: [String],
        logName: String,
        onOutput: (@MainActor (String) -> Void)? = nil
    ) async throws -> Int32 {
        let logURL = SupportLayout.logs.appendingPathComponent(logName)
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let log = try FileHandle(forWritingTo: logURL)
        try log.seekToEnd()
        return try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            var environment = ProcessInfo.processInfo.environment
            environment["MYDGX_LANGUAGE"] = AppLanguage.active.rawValue
            process.environment = environment
            process.standardInput = FileHandle.nullDevice
            let pipe = onOutput == nil ? nil : Pipe()
            process.standardOutput = pipe ?? log
            process.standardError = pipe ?? log
            pipe?.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                log.write(data)
                if let text = String(data: data, encoding: .utf8), let onOutput {
                    Task { @MainActor in onOutput(text) }
                }
            }
            process.terminationHandler = { completed in
                pipe?.fileHandleForReading.readabilityHandler = nil
                log.closeFile()
                continuation.resume(returning: completed.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                log.closeFile()
                continuation.resume(throwing: error)
            }
        }
    }

    private func runSSH(arguments remoteArguments: [String]) async throws -> Int32 {
        let profile = configuration.activeConnection
        guard !profile.ssh.host.isEmpty, !profile.ssh.user.isEmpty else {
            throw RemoteActionError.incompleteSSH
        }
        guard await selectSSHEndpoint(profile) else { return -1 }
        try validateSSHCredentials(profile)
        var arguments = sshBaseArguments(profile)
        arguments.append(remoteTarget(profile))
        arguments += remoteArguments

        return try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
            process.arguments = arguments
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            process.terminationHandler = { completed in
                continuation.resume(returning: completed.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}

enum RemoteActionError: LocalizedError {
    case backupFailed(Int32)
    case commandFailed(Int32)
    case incompleteSSH
    case invalidBackup
    case tunnelFailed
    case invalidDeploySource
    case gitHubSourceUnavailable
    case deployFailed(Int32)
    case profilePreflightFailed(String)
    case profileJobFailed(String)
    case profileJobTimedOut
    case unsafeIdentity
    case webAppUnavailable(String, Int)

    var errorDescription: String? {
        switch self {
        case let .backupFailed(code):
            return String(localized: "La copia de seguridad falló (código \(code)). Revisa ~/.MyDGX/logs.")
        case let .commandFailed(code):
            return String(localized: "La operación SSH falló (código \(code)). Comprueba la clave y la regla sudoers limitada.")
        case .incompleteSSH:
            return String(localized: "Completa host, usuario y puerto SSH del perfil.")
        case .invalidBackup:
            return String(localized: "La copia recibida está incompleta o no contiene mydgx.db.")
        case .tunnelFailed:
            return String(localized: "El túnel SSH no pudo iniciarse. Revisa el log del perfil en ~/.MyDGX/logs.")
        case .invalidDeploySource:
            return String(localized: "Selecciona en Proyecto local una carpeta de MyDGX que contenga start.sh.")
        case .gitHubSourceUnavailable:
            return String(localized: "Para actualizar desde GitHub, indica en Proyecto local un clon git de MyDGX.")
        case let .deployFailed(code):
            return String(localized: "El despliegue falló (código \(code)). Revisa ~/.MyDGX/logs.")
        case let .profilePreflightFailed(message):
            return String(localized: "No se puede arrancar el perfil: \(message)")
        case let .profileJobFailed(message):
            return String(localized: "No se pudo cargar el perfil: \(message)")
        case .profileJobTimedOut:
            return String(localized: "La carga del perfil no terminó en 30 minutos.")
        case .unsafeIdentity:
            return String(localized: "La clave SSH no existe o sus permisos permiten acceso a otros usuarios; usa chmod 600.")
        case let .webAppUnavailable(alias, port):
            return String(localized: "\(alias) no responde en el puerto \(String(port)). Comprueba que su start.sh use MYDGX_APP_PORT y que el puerto local esté libre en el Mac.")
        }
    }
}

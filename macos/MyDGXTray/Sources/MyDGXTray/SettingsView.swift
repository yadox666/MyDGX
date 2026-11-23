import AppKit
import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: AppModel
    @ObservedObject private var updater = AppUpdater.shared
    @State private var draft: MyDGXConfiguration
    @State private var selectedID: String?
    /// API keys typed but not saved yet, by profile id; switching profiles keeps them.
    @State private var apiKeys: [String: String] = [:]
    @State private var message = ""
    @State private var messageIsError = false
    @State private var language = AppLanguage.selected
    @State private var showNetworkDiscovery = false
    /// Profile ids last seen in the saved config; only ids outside this set count as new.
    @State private var savedIDs: Set<String>
    @State private var savedActiveID: String

    init(model: AppModel) {
        self.model = model
        _draft = State(initialValue: model.configuration)
        _savedActiveID = State(initialValue: model.configuration.activeConnectionID)
        _savedIDs = State(initialValue: Set(model.configuration.connections.map(\.id)))
        _selectedID = State(initialValue: model.configuration.activeConnectionID)
    }

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                List(selection: keptSelection) {
                    ForEach(draft.connections) { profile in
                        HStack {
                            ProfileThumbnail(
                                kind: profile.kind,
                                deviceModel: profile.id == model.configuration.activeConnectionID
                                    ? model.overview?.host.deviceModel
                                        ?? profile.detectedDeviceModel
                                    : profile.detectedDeviceModel,
                                deviceVariant: profile.id == model.configuration.activeConnectionID
                                    ? model.overview?.host.deviceVariant
                                        ?? profile.detectedDeviceVariant
                                    : profile.detectedDeviceVariant,
                                isActive: profile.id == draft.activeConnectionID
                            )
                            Text(profile.alias)
                            Spacer()
                            if profile.id == draft.activeConnectionID {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            }
                        }
                        .tag(Optional(profile.id))
                    }
                }
                .frame(minHeight: 120, maxHeight: .infinity)
                HStack {
                    Button {
                        addProfile()
                    } label: {
                        Image(systemName: "plus")
                            .frame(width: 24, height: 14)
                    }
                    .help("Añadir perfil")
                    Button {
                        duplicateProfile()
                    } label: {
                        Image(systemName: "plus.square.on.square")
                            .frame(width: 24, height: 14)
                    }
                    .disabled(selectedProfile == nil)
                    .help("Duplicar perfil")
                    Button {
                        deleteProfile()
                    } label: {
                        Image(systemName: "minus")
                            .frame(width: 24, height: 14)
                    }
                    .disabled(draft.connections.count <= 1 || selectedProfile == nil)
                    .help("Eliminar perfil")
                    Spacer()
                }
                .padding(8)

                Divider()

                Button {
                    model.openSetupWizard()
                } label: {
                    Label("Asistente de instalación Spark", systemImage: "wand.and.stars")
                        .font(.callout.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 34)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(.blue)
                .padding([.horizontal, .top], 10)
                .help("Asistente de instalación Spark: añadir e instalar otro Spark")

                Button {
                    showNetworkDiscovery = true
                } label: {
                    Label("Buscar DGX en red", systemImage: "dot.radiowaves.left.and.right")
                        .font(.callout.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 34)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(.green)
                .padding(10)
                .help("Detectar y añadir automáticamente equipos con acceso SSH autorizado")
            }
            .frame(minWidth: 190, idealWidth: 220, maxHeight: .infinity)

            if let profile = selectedProfileBinding {
                profileForm(profile)
                    .frame(minWidth: 540, maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "server.rack")
                        .font(.largeTitle)
                    Text("Selecciona un equipo")
                }
                .foregroundStyle(.secondary)
                .frame(minWidth: 540, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 820, height: 760)
        .sheet(isPresented: $showNetworkDiscovery) {
            NetworkDiscoveryView(configuration: draft) { updated in
                try model.save(configuration: updated, apiKey: nil)
                draft = model.configuration
                show(String(localized: "Detección de red completada"))
            }
        }
        .onReceive(model.$configuration) { updated in
            let previous = savedIDs
            savedIDs = Set(updated.connections.map(\.id))
            if updated.activeConnectionID != savedActiveID {
                savedActiveID = updated.activeConnectionID
                draft.activeConnectionID = updated.activeConnectionID
            }
            let known = Set(draft.connections.map(\.id)).union(previous)
            if let added = updated.connections.first(where: { !known.contains($0.id) }) {
                draft.connections += updated.connections.filter { !known.contains($0.id) }
                selectedID = added.id
                show(String(localized: "Perfil \(added.alias) creado por el asistente"))
                return
            }
            for detected in updated.connections {
                guard let index = draft.connections.firstIndex(where: { $0.id == detected.id }) else {
                    continue
                }
                draft.connections[index].detectedDeviceModel = detected.detectedDeviceModel
                draft.connections[index].detectedDeviceVariant = detected.detectedDeviceVariant
            }
        }
        .onAppear {
            model.settingsEditor = SettingsEditor(
                hasChanges: { hasChanges },
                save: { save() },
                discard: { discard() }
            )
            model.settingsChanged(hasChanges)
        }
        .onChange(of: hasChanges) { model.settingsChanged($0) }
    }

    /// A click on the empty part of the list would clear the selection and collapse the split view.
    private var keptSelection: Binding<String?> {
        Binding(
            get: { selectedID },
            set: { newValue in
                if newValue != nil || draft.connections.isEmpty { selectedID = newValue }
            }
        )
    }

    private var hasChanges: Bool {
        draft != model.configuration || apiKeys.values.contains { !$0.isEmpty }
    }

    private func discard() {
        draft = model.configuration
        apiKeys = [:]
        if !draft.connections.contains(where: { $0.id == selectedID }) {
            selectedID = draft.activeConnectionID
        }
        show("")
    }

    private var selectedProfile: ConnectionProfile? {
        guard let selectedID else { return nil }
        return draft.connections.first(where: { $0.id == selectedID })
    }

    private var selectedProfileBinding: Binding<ConnectionProfile>? {
        guard let selectedID,
              let index = draft.connections.firstIndex(where: { $0.id == selectedID }) else {
            return nil
        }
        return $draft.connections[index]
    }

    private func profileForm(_ profile: Binding<ConnectionProfile>) -> some View {
        Form {
            Section {
                DevicePhoto(
                    detectedModel: profile.wrappedValue.id == model.configuration.activeConnectionID
                        ? model.overview?.host.deviceModel
                            ?? profile.wrappedValue.detectedDeviceModel
                        : profile.wrappedValue.detectedDeviceModel,
                    detectedVariant: profile.wrappedValue.id == model.configuration.activeConnectionID
                        ? model.overview?.host.deviceVariant
                            ?? profile.wrappedValue.detectedDeviceVariant
                        : profile.wrappedValue.detectedDeviceVariant,
                    kind: profile.wrappedValue.kind
                )
            }

            Section("Aplicación") {
                Toggle(
                    "Abrir MyDGXTray al iniciar sesión",
                    isOn: Binding(
                        get: { model.launchAtLoginEnabled },
                        set: { model.setLaunchAtLogin($0) }
                    )
                )
                Text("macOS puede solicitar autorización en Ajustes del Sistema → Ítems de inicio.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("Idioma", selection: $language) {
                    ForEach(AppLanguage.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                .onChange(of: language) { $0.save() }
                if language.effective != AppLanguage.active {
                    HStack {
                        Text("El idioma cambiará al reiniciar MyDGXTray. El túnel SSH y la configuración se conservan.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Reiniciar ahora") {
                            if model.settingsMayClose() { AppLanguage.relaunch() }
                        }
                            .disabled(model.operationInProgress)
                    }
                }
                UpdateRow(updater: updater, model: model)
            }

            Section("Perfil") {
                TextField("Alias", text: profile.alias)
                Picker("Tipo", selection: profile.kind) {
                    ForEach(ConnectionKind.allCases) { kind in
                        Text(kind.label).tag(kind)
                    }
                }
                Button(
                    profile.wrappedValue.id == draft.activeConnectionID
                        ? String(localized: "Perfil activo")
                        : String(localized: "Usar este equipo")
                ) {
                    draft.activeConnectionID = profile.wrappedValue.id
                }
                .disabled(profile.wrappedValue.id == draft.activeConnectionID)
            }

            Section("API MyDGX") {
                Picker("Protocolo", selection: profile.scheme) {
                    Text("HTTP").tag("http")
                    Text("HTTPS").tag("https")
                }
                TextField("Host", text: profile.apiHost)
                TextField("Puerto", value: profile.apiPort, format: .number)
                TextField("Ruta del dashboard", text: profile.dashboardPath)
                TextField(
                    "URL de Open WebUI",
                    text: optionalString(profile.openWebUIURL)
                )
                Stepper(
                    "Actualizar cada \(profile.wrappedValue.refreshIntervalSeconds) s",
                    value: profile.refreshIntervalSeconds,
                    in: 1...3600
                )
            }

            Section("Autenticación y certificados") {
                SecureField("Clave API (vacío conserva la actual)", text: Binding(
                    get: { apiKeys[profile.wrappedValue.id] ?? "" },
                    set: { apiKeys[profile.wrappedValue.id] = $0.isEmpty ? nil : $0 }
                ))
                TextField("Identificador de credencial", text: profile.apiKeyAccount)
                pathField(
                    title: String(localized: "Certificado CA"),
                    value: profile.caCertificatePath,
                    canChooseDirectories: false
                )
                Text("Las API keys se guardan en ~/.MyDGX/credentials con permisos 0600 y no se escriben en config.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("SSH") {
                TextField("IP o hostname de red local", text: profile.ssh.host)
                TextField("Usuario", text: profile.ssh.user)
                TextField("Puerto en red local", value: profile.ssh.port, format: .number)
                TextField("IP o hostname público (opcional)", text: profile.ssh.publicHost)
                TextField("Puerto público/NAT", value: profile.ssh.publicPort, format: .number)
                Text("Se prueba primero la red local y, si no responde, la dirección pública.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                pathField(
                    title: String(localized: "Clave privada"),
                    value: profile.ssh.identityFile,
                    canChooseDirectories: false
                )
            }

            Section("Túnel SSH administrado") {
                Toggle("Usar túnel", isOn: profile.tunnel.enabled)
                if profile.wrappedValue.tunnel.enabled {
                    TextField("Puerto API local", value: profile.tunnel.localAPIPort, format: .number)
                    TextField("Puerto API remoto", value: profile.tunnel.remoteAPIPort, format: .number)
                    TextField("Puerto Open WebUI local", value: profile.tunnel.localOpenWebUIPort, format: .number)
                    TextField("Puerto Open WebUI remoto", value: profile.tunnel.remoteOpenWebUIPort, format: .number)
                    TextField("Puerto ComfyUI local", value: profile.tunnel.localComfyUIPort, format: .number)
                    TextField("Puerto ComfyUI remoto", value: profile.tunnel.remoteComfyUIPort, format: .number)
                    TextField("Puerto Gateway local", value: profile.tunnel.localGatewayPort, format: .number)
                    TextField("Puerto Gateway remoto", value: profile.tunnel.remoteGatewayPort, format: .number)
                    TextField("Puerto DGX Dashboard local", value: profile.tunnel.localDGXDashboardPort, format: .number)
                    TextField("Puerto DGX Dashboard remoto", value: profile.tunnel.remoteDGXDashboardPort, format: .number)
                }
            }

            Section("Despliegue") {
                pathField(
                    title: SupportLayout.bundledSource == nil
                        ? String(localized: "Proyecto local")
                        : String(localized: "Proyecto local (vacío: versión \(SupportLayout.bundledSourceVersion) incluida)"),
                    value: profile.deployment.sourcePath,
                    canChooseDirectories: true
                )
                TextField("Directorio remoto", text: profile.deployment.remoteDirectory)
                Button {
                    guard save() else { return }
                    model.openFirstDeployment(for: profile.wrappedValue.id)
                } label: {
                    Label("Primer despliegue completo…", systemImage: "shippingbox.and.arrow.backward")
                }
                .disabled(
                    model.operationInProgress
                        || !model.canDeploy(profile.wrappedValue)
                        || profile.wrappedValue.ssh.host.isEmpty
                )
                .help("Prepara un Spark nuevo en Terminal; sudo solicitará la contraseña directamente")
                Button {
                    confirmDeploy(profile.wrappedValue)
                } label: {
                    Label("Guardar y desplegar…", systemImage: "shippingbox.and.arrow.backward")
                }
                .disabled(
                    model.operationInProgress
                        || !model.canDeploy(profile.wrappedValue)
                        || profile.wrappedValue.ssh.host.isEmpty
                )
                Button {
                    confirmGitHubDeploy(profile.wrappedValue)
                } label: {
                    Label("Actualizar desde GitHub (main)…", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(
                    model.operationInProgress
                        || model.gitHubUpdateSource(profile.wrappedValue) == nil
                        || !model.canDeploy(profile.wrappedValue)
                        || profile.wrappedValue.ssh.host.isEmpty
                )
                .help(
                    model.gitHubUpdateSource(profile.wrappedValue) == nil
                        ? String(localized: "Indica en Proyecto local un clon git de MyDGX")
                        : String(localized: "Despliega en Terminal el último commit de origin/main, con copia de seguridad y vuelta atrás")
                )
                if let deployment = model.deploymentStatus {
                    DeploymentProgressView(status: deployment) {
                        model.openDeploymentLog()
                    }
                    .padding(.vertical, 6)
                }
            }

            Section("Copia de seguridad") {
                Button {
                    if save() {
                        model.backupConnection(id: profile.wrappedValue.id)
                    }
                } label: {
                    Label("Copia de Seguridad DGX", systemImage: "externaldrive.badge.timemachine")
                }
                .disabled(model.operationInProgress || profile.wrappedValue.ssh.host.isEmpty)
                Text("Guarda MyDGX y los datos de Open WebUI en ~/.MyDGX/backups.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if model.operationInProgress
                    || model.statusMessage.localizedCaseInsensitiveContains(String(localized: "copia", comment: "Word shared by every backup status message")) {
                    Text(model.operationInProgress ? String(localized: "Creando copia…") : model.statusMessage)
                        .font(.caption)
                }
            }

            HStack {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(messageIsError ? .red : .green)
                Spacer()
                Button {
                    model.requestRefresh()
                } label: {
                    Label("Actualizar", systemImage: "arrow.clockwise")
                }
                .disabled(model.isRefreshing)
                Button("Guardar") { _ = save() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .formStyle(.grouped)
        .onChange(of: selectedID) { _ in
            show("")
        }
    }

    private func optionalString(_ value: Binding<String?>) -> Binding<String> {
        Binding(
            get: { value.wrappedValue ?? "" },
            set: { value.wrappedValue = $0.isEmpty ? nil : $0 }
        )
    }

    private func show(_ text: String, error: Bool = false) {
        message = text
        messageIsError = error
    }

    private func pathField(
        title: String,
        value: Binding<String>,
        canChooseDirectories: Bool
    ) -> some View {
        HStack {
            TextField(title, text: value)
            Button("Elegir…") {
                let panel = NSOpenPanel()
                panel.canChooseFiles = !canChooseDirectories
                panel.canChooseDirectories = canChooseDirectories
                panel.allowsMultipleSelection = false
                if panel.runModal() == .OK, let url = panel.url {
                    value.wrappedValue = url.path
                }
            }
        }
    }

    private func addProfile() {
        var profile = ConnectionProfile()
        profile.alias = String(localized: "Nuevo equipo \(draft.connections.count + 1)")
        draft.connections.append(profile)
        selectedID = profile.id
    }

    private func duplicateProfile() {
        guard var copy = selectedProfile else { return }
        copy.id = UUID().uuidString
        copy.alias = String(localized: "\(copy.alias) copia", comment: "Alias of a duplicated device profile")
        copy.apiKeyAccount = UUID().uuidString
        draft.connections.append(copy)
        selectedID = copy.id
    }

    private func deleteProfile() {
        guard let selectedID,
              let profile = selectedProfile,
              draft.connections.count > 1 else {
            return
        }
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = String(localized: "¿Eliminar \(profile.alias)?")
        alert.informativeText = String(localized: """
        El equipo se quitará de MyDGX inmediatamente. \
        No se borrarán claves SSH, copias de seguridad ni datos del equipo remoto.
        """)
        let deleteButton = alert.addButton(withTitle: String(localized: "Eliminar equipo"))
        deleteButton.hasDestructiveAction = true
        alert.addButton(withTitle: String(localized: "Cancelar"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        if model.configuration.connections.contains(where: { $0.id == selectedID }) {
            do {
                try model.deleteConnection(id: selectedID)
            } catch {
                show(error.localizedDescription, error: true)
                return
            }
        }
        draft.connections.removeAll(where: { $0.id == selectedID })
        if draft.activeConnectionID == selectedID
            || !draft.connections.contains(where: { $0.id == draft.activeConnectionID }) {
            draft.activeConnectionID = model.configuration.activeConnectionID
        }
        self.selectedID = draft.connections.first?.id
        apiKeys[selectedID] = nil
        show(String(localized: "\(profile.alias) eliminado"))
    }

    @discardableResult
    private func save() -> Bool {
        do {
            _ = try draft.validated()
            for (id, key) in apiKeys where !key.isEmpty {
                guard let account = draft.connections.first(where: { $0.id == id })?.apiKeyAccount else { continue }
                try CredentialStore.write(key, account: account)
                apiKeys[id] = nil
            }
            try model.save(configuration: draft, apiKey: nil)
            apiKeys = [:]
            show(String(localized: "Configuración guardada"))
            return true
        } catch {
            show(error.localizedDescription, error: true)
            return false
        }
    }

    private func confirmDeploy(_ profile: ConnectionProfile) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = String(localized: "¿Desplegar MyDGX en \(profile.alias)?")
        alert.informativeText = String(localized: """
        Se sincronizará \(model.deploymentSourceDescription(profile)) con \
        \(profile.deployment.remoteDirectory), excluyendo secretos, datos y dependencias locales. \
        Después se preparará y reiniciará MyDGX.
        """)
        alert.addButton(withTitle: String(localized: "Guardar y desplegar"))
        alert.addButton(withTitle: String(localized: "Cancelar"))
        guard alert.runModal() == .alertFirstButtonReturn, save() else { return }
        show(String(localized: "Despliegue iniciado; consulta el progreso en esta sección."))
        model.deployConnection(id: profile.id)
    }

    private func confirmGitHubDeploy(_ profile: ConnectionProfile) {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = String(localized: "¿Actualizar \(profile.alias) desde GitHub?")
        alert.informativeText = String(localized: """
        Se desplegará el último commit de main en origin, no los cambios locales sin publicar. \
        Se hace copia de seguridad, se reinician los servicios y, si algo falla, se restaura la versión anterior.
        """)
        alert.addButton(withTitle: String(localized: "Guardar y actualizar"))
        alert.addButton(withTitle: String(localized: "Cancelar"))
        guard alert.runModal() == .alertFirstButtonReturn, save() else { return }
        show(String(localized: "Actualización abierta en Terminal."))
        model.openGitHubDeployment(for: profile.id)
    }
}

struct UpdateRow: View {
    @ObservedObject var updater: AppUpdater
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Versión \(updater.currentVersion)")
                Spacer()
                if let release = updater.availableRelease {
                    Link("Novedades", destination: release.pageURL)
                    Button("Descargar e instalar \(release.version)") { confirmInstall(release) }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.operationInProgress)
                } else {
                    Button("Buscar actualizaciones") { Task { await updater.check() } }
                        .disabled(updater.isBusy)
                }
            }
            status
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .onAppear { updater.checkIfStale() }
    }

    @ViewBuilder
    private var status: some View {
        switch updater.state {
        case .idle:
            Text("Las versiones se descargan de GitHub (\(AppUpdater.repository)) y se verifican con SHA-256 y codesign.")
        case .checking:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Buscando actualizaciones…")
            }
        case .upToDate:
            Text("MyDGXTray está al día\(checkedSuffix).")
        case .available(let release):
            Text("Hay una versión nueva: \(release.version). Se cerrará y volverá a abrir MyDGXTray; la configuración no cambia.")
        case .downloading(let fraction):
            HStack(spacing: 6) {
                ProgressView(value: fraction).frame(width: 160)
                Text("Descargando… \(Int(fraction * 100)) %")
            }
        case .installing:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Verificando e instalando…")
            }
        case .failed(let error):
            Text(error).foregroundStyle(.red)
        }
    }

    private var checkedSuffix: String {
        guard let date = updater.lastChecked else { return "" }
        return String(localized: " (comprobado a las \(date.formatted(date: .omitted, time: .shortened)))")
    }

    private func confirmInstall(_ release: AppUpdater.Release) {
        let alert = NSAlert()
        alert.messageText = String(localized: "¿Actualizar MyDGXTray a \(release.version)?")
        alert.informativeText = String(localized: """
        Se descargará \(release.archiveName) desde GitHub, se comprobará su SHA-256 y su firma, \
        y la versión \(updater.currentVersion) irá a la Papelera. MyDGXTray se reiniciará; \
        el túnel SSH y la configuración se conservan.
        """)
        alert.addButton(withTitle: String(localized: "Actualizar y reiniciar"))
        alert.addButton(withTitle: String(localized: "Cancelar"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task { await updater.install(release) }
    }
}

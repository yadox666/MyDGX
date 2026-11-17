import AppKit
import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: AppModel
    @State private var draft: MyDGXConfiguration
    @State private var selectedID: String?
    @State private var apiKey = ""
    @State private var message = ""
    @State private var showNetworkDiscovery = false

    init(model: AppModel) {
        self.model = model
        _draft = State(initialValue: model.configuration)
        _selectedID = State(initialValue: model.configuration.activeConnectionID)
    }

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                List(selection: $selectedID) {
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
                    Button {
                        model.openSetupWizard()
                    } label: {
                        Image(systemName: "wand.and.stars")
                            .frame(width: 24, height: 14)
                    }
                    .help("Asistente de instalación Spark: añadir e instalar otro Spark")
                    Spacer()
                }
                .padding(8)

                Divider()

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
            .frame(minWidth: 190, idealWidth: 220)

            if let profile = selectedProfileBinding {
                profileForm(profile)
                    .frame(minWidth: 540)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "server.rack")
                        .font(.largeTitle)
                    Text("Selecciona un equipo")
                }
                .foregroundStyle(.secondary)
                .frame(minWidth: 540)
            }
        }
        .frame(width: 820, height: 760)
        .sheet(isPresented: $showNetworkDiscovery) {
            NetworkDiscoveryView(configuration: draft) { updated in
                try model.save(configuration: updated, apiKey: nil)
                draft = model.configuration
                message = "Detección de red completada"
            }
        }
        .onReceive(model.$configuration) { updated in
            let known = Set(draft.connections.map(\.id))
            if let added = updated.connections.first(where: { !known.contains($0.id) }) {
                draft = updated
                selectedID = added.id
                message = "Perfil \(added.alias) creado por el asistente"
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
                        : profile.wrappedValue.detectedDeviceVariant
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
                        ? "Perfil activo"
                        : "Usar este equipo"
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
                SecureField("Clave API (vacío conserva la actual)", text: $apiKey)
                TextField("Identificador de credencial", text: profile.apiKeyAccount)
                pathField(
                    title: "Certificado CA",
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
                    title: "Clave privada",
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
                        ? "Proyecto local"
                        : "Proyecto local (vacío: versión \(SupportLayout.bundledSourceVersion) incluida)",
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
                    || model.statusMessage.localizedCaseInsensitiveContains("copia") {
                    Text(model.operationInProgress ? "Creando copia…" : model.statusMessage)
                        .font(.caption)
                }
            }

            HStack {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(
                        message == "Configuración guardada"
                            || message.hasPrefix("Despliegue iniciado")
                                ? .green
                                : .red
                    )
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
            apiKey = ""
            message = ""
        }
    }

    private func optionalString(_ value: Binding<String?>) -> Binding<String> {
        Binding(
            get: { value.wrappedValue ?? "" },
            set: { value.wrappedValue = $0.isEmpty ? nil : $0 }
        )
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
        profile.alias = "Nuevo equipo \(draft.connections.count + 1)"
        draft.connections.append(profile)
        selectedID = profile.id
        apiKey = ""
    }

    private func duplicateProfile() {
        guard var copy = selectedProfile else { return }
        copy.id = UUID().uuidString
        copy.alias = "\(copy.alias) copia"
        copy.apiKeyAccount = UUID().uuidString
        draft.connections.append(copy)
        selectedID = copy.id
        apiKey = ""
    }

    private func deleteProfile() {
        guard let selectedID,
              let profile = selectedProfile,
              draft.connections.count > 1 else {
            return
        }
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "¿Eliminar \(profile.alias)?"
        alert.informativeText = """
        El equipo se quitará de MyDGX al guardar la configuración. \
        No se borrarán claves SSH, copias de seguridad ni datos del equipo remoto.
        """
        let deleteButton = alert.addButton(withTitle: "Eliminar equipo")
        deleteButton.hasDestructiveAction = true
        alert.addButton(withTitle: "Cancelar")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        draft.connections.removeAll(where: { $0.id == selectedID })
        if draft.activeConnectionID == selectedID {
            draft.activeConnectionID = draft.connections[0].id
        }
        self.selectedID = draft.connections[0].id
        apiKey = ""
    }

    @discardableResult
    private func save() -> Bool {
        do {
            guard let profile = selectedProfile else { return false }
            try model.save(
                configuration: draft,
                apiKey: apiKey.isEmpty ? nil : apiKey,
                apiKeyAccount: profile.apiKeyAccount
            )
            apiKey = ""
            message = "Configuración guardada"
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    private func confirmDeploy(_ profile: ConnectionProfile) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "¿Desplegar MyDGX en \(profile.alias)?"
        alert.informativeText = """
        Se sincronizará \(model.deploymentSourceDescription(profile)) con \
        \(profile.deployment.remoteDirectory), excluyendo secretos, datos y dependencias locales. \
        Después se preparará y reiniciará MyDGX.
        """
        alert.addButton(withTitle: "Guardar y desplegar")
        alert.addButton(withTitle: "Cancelar")
        guard alert.runModal() == .alertFirstButtonReturn, save() else { return }
        message = "Despliegue iniciado; consulta el progreso en esta sección."
        model.deployConnection(id: profile.id)
    }
}

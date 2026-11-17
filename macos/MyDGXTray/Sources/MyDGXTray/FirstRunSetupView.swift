import AppKit
import SwiftUI

struct FirstRunSetupView: View {
    let onComplete: (ConnectionProfile) -> Void
    private let existingProfiles: [ConnectionProfile]

    @Environment(\.dismiss) private var dismiss
    @StateObject private var discovery = DGXDiscovery()
    @State private var profile: ConnectionProfile
    @State private var firstBootComplete = false
    @State private var keyGenerated = false
    @State private var verified = false
    @State private var verifying = false
    @State private var statusMessage = ""
    @State private var discoveryProgress = 0.0

    init(
        existingProfiles: [ConnectionProfile] = [],
        onComplete: @escaping (ConnectionProfile) -> Void
    ) {
        self.existingProfiles = existingProfiles
        self.onComplete = onComplete
        var initial = ConnectionProfile()
        initial.alias = "DGX Spark"
        initial.kind = .lan
        initial.apiHost = "127.0.0.1"
        initial.apiPort = 8088
        initial.ssh.port = 22
        initial.tunnel.enabled = true
        _profile = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Configurar un DGX Spark nuevo")
                .font(.title2.weight(.semibold))

            GroupBox("0. Preparar USB OEMDATA (opcional)") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(
                        "Para imágenes DGX Spark de octubre de 2026 o posteriores. "
                            + "El volumen debe estar formateado previamente como FAT32 y llamarse OEMDATA. "
                            + "Se conservará el asistente oficial y no se escribirán credenciales."
                    )
                    HStack {
                        Button("Crear archivos en OEMDATA…") { createOEMData() }
                        Button("Abrir documentación oficial") {
                            NSWorkspace.shared.open(OEMDataGenerator.officialGuide)
                        }
                    }
                }
                .padding(6)
            }

            GroupBox("1. Completa el primer arranque oficial") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(
                        "Conecta pantalla y teclado, o usa el hotspot indicado en la guía rápida. "
                            + "Crea el usuario, conecta el Spark a una red estable y espera a que terminen "
                            + "todas las actualizaciones. No apagues el equipo durante este proceso."
                    )
                    HStack {
                        Button("Abrir guía oficial de NVIDIA") {
                            NSWorkspace.shared.open(SSHBootstrap.officialSetupURL)
                        }
                        Toggle("Primer arranque completado", isOn: $firstBootComplete)
                    }
                }
                .padding(6)
            }

            GroupBox("2. Localiza el equipo") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Button {
                            discoverOnLocalNetwork()
                        } label: {
                            Label(
                                discovery.searching ? "Buscando…" : "Buscar en la red local",
                                systemImage: "dot.radiowaves.left.and.right"
                            )
                        }
                        .disabled(discovery.searching)
                        if !discovery.devices.isEmpty {
                            Menu("Equipos encontrados") {
                                ForEach(discovery.devices) { device in
                                    Button(
                                        "\(device.name) · "
                                            + "\(device.ipAddress ?? device.host):\(device.port)"
                                    ) {
                                        select(device)
                                    }
                                }
                            }
                        }
                    }

                    if discovery.searching {
                        HStack(spacing: 12) {
                            DiscoveryRadarView(active: true, size: 48)
                            VStack(alignment: .leading, spacing: 5) {
                                Text("Explorando la red local")
                                    .font(.callout.weight(.semibold))
                                ProgressView(value: discoveryProgress)
                                    .progressViewStyle(.linear)
                                    .tint(.green)
                                Text(
                                    discovery.devices.isEmpty
                                        ? "Esperando anuncios Bonjour…"
                                        : "\(discovery.devices.count) equipo(s) encontrado(s)"
                                )
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                        }
                        .padding(10)
                        .background(Color.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                    }

                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                        GridRow {
                            Text("Alias")
                            TextField("DGX Spark oficina", text: $profile.alias)
                        }
                        GridRow {
                            Text("Host o IP")
                            TextField("dgx-spark.local", text: $profile.ssh.host)
                        }
                        GridRow {
                            Text("Usuario")
                            TextField("Usuario creado en el asistente", text: $profile.ssh.user)
                        }
                        GridRow {
                            Text("Puerto SSH")
                            TextField("22", value: $profile.ssh.port, format: .number)
                        }
                    }
                }
                .padding(6)
            }

            GroupBox("3. Configura el acceso mediante clave pública") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Button("Generar par Ed25519") { generateKey() }
                            .disabled(!connectionFieldsComplete || keyGenerated)
                        Image(systemName: keyGenerated ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(keyGenerated ? .green : .secondary)

                        Button("Instalar clave pública…") { installPublicKey() }
                            .disabled(!keyGenerated)

                        Button("Verificar acceso") {
                            Task { await verifyAccess() }
                        }
                        .disabled(!keyGenerated || verifying)
                        if verifying {
                            ProgressView().controlSize(.small)
                        } else if verified {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundStyle(.green)
                        }
                    }
                    if !profile.ssh.identityFile.isEmpty {
                        Text(profile.ssh.identityFile)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                    }
                    Text(
                        "La instalación abre Terminal y solicita una sola vez la contraseña inicial. "
                            + "MyDGX no recibe ni guarda esa contraseña."
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .padding(6)
            }
            .disabled(!firstBootComplete)

            if !statusMessage.isEmpty {
                Text(statusMessage)
                    .font(.callout)
                    .foregroundStyle(verified ? .green : .secondary)
            }

            Spacer()

            HStack {
                Button("Cancelar", role: .cancel) { dismiss() }
                Spacer()
                Button("Crear perfil") {
                    onComplete(profile)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(createProfileBlockingReason != nil)
                .help(createProfileBlockingReason ?? "Crear el perfil y guardarlo")
            }
            if let reason = createProfileBlockingReason {
                Text("Para crear el perfil: \(reason)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(20)
        .frame(width: 740, height: 760)
        .background(FloatingAssistantWindow())
        .onDisappear { discovery.stop() }
    }

    private var connectionFieldsComplete: Bool {
        firstBootComplete
            && profile.alias.count >= 2
            && !profile.ssh.host.isEmpty
            && !profile.ssh.user.isEmpty
            && (1...65535).contains(profile.ssh.port)
    }

    private var createProfileBlockingReason: String? {
        let normalizedHost = profile.ssh.host
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if !normalizedHost.isEmpty,
           let existing = existingProfiles.first(where: {
               $0.ssh.host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                   == normalizedHost
                   && $0.ssh.port == profile.ssh.port
           }) {
            return "el equipo ya existe como «\(existing.alias)»."
        }
        let normalizedAlias = profile.alias
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if !normalizedAlias.isEmpty,
           existingProfiles.contains(where: {
               $0.alias.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                   == normalizedAlias
           }) {
            return "ya existe un perfil con ese alias."
        }
        if !firstBootComplete {
            return "marca «Primer arranque completado»."
        }
        if !connectionFieldsComplete {
            return "completa alias, host, usuario y puerto SSH."
        }
        if !keyGenerated {
            return "genera el par de claves Ed25519."
        }
        if !verified {
            return "instala la clave pública y verifica el acceso."
        }
        return nil
    }

    private func discoverOnLocalNetwork() {
        guard !discovery.searching else { return }
        statusMessage = "Buscando anuncios SSH de DGX en la red local…"
        discoveryProgress = 0
        discovery.start()
        Task { @MainActor in
            for tick in 1...30 {
                try? await Task.sleep(nanoseconds: 200_000_000)
                discoveryProgress = Double(tick) / 30.0
            }
            discovery.stop()
            if discovery.devices.count == 1, let device = discovery.devices.first {
                select(device)
                statusMessage = "1 equipo encontrado. Alias, host y puerto SSH autocompletados."
            } else if discovery.devices.isEmpty {
                statusMessage = "No se encontró ningún DGX anunciado en la red local."
            } else {
                statusMessage = "\(discovery.devices.count) equipos encontrados. Selecciona uno en el menú."
            }
        }
    }

    private func generateKey() {
        do {
            profile.ssh.identityFile = try SSHBootstrap.generateKeyPair(
                profileID: profile.id,
                alias: profile.alias
            )
            keyGenerated = true
            verified = false
            statusMessage = "Par de claves creado con permisos seguros."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func select(_ device: DiscoveredDGX) {
        profile.ssh.host = device.connectionHost
        profile.apiHost = device.connectionHost
        profile.ssh.port = device.port
        if profile.alias == "DGX Spark" {
            profile.alias = device.name
        }
        verified = false
        statusMessage = "Equipo \(device.name) seleccionado."
    }

    private func createOEMData() {
        let panel = NSOpenPanel()
        panel.title = "Selecciona el volumen OEMDATA"
        panel.message = "Debe ser un volumen FAT32 montado y etiquetado exactamente OEMDATA."
        panel.directoryURL = URL(fileURLWithPath: "/Volumes", isDirectory: true)
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let volume = panel.url else { return }

        let existing = ["meta-data", "user-data"].filter {
            FileManager.default.fileExists(
                atPath: volume.appendingPathComponent($0).path
            )
        }
        if !existing.isEmpty {
            let alert = NSAlert()
            alert.alertStyle = .critical
            alert.messageText = "¿Sobrescribir los archivos cloud-init?"
            alert.informativeText = "Se sustituirán \(existing.joined(separator: " y ")) en \(volume.path)."
            alert.addButton(withTitle: "Sobrescribir")
            alert.addButton(withTitle: "Cancelar")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }

        do {
            try OEMDataGenerator.writeSeed(to: volume)
            statusMessage = "OEMDATA preparado. Expulsa el volumen de forma segura antes de usarlo."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func installPublicKey() {
        do {
            try SSHBootstrap.openPublicKeyInstaller(profile: profile)
            verified = false
            statusMessage = "Completa la autenticación en Terminal y vuelve para verificar."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func verifyAccess() async {
        verifying = true
        defer { verifying = false }
        do {
            try await SSHBootstrap.verify(profile: profile)
            verified = true
            statusMessage = "Acceso SSH mediante clave pública verificado."
        } catch {
            verified = false
            statusMessage = error.localizedDescription
        }
    }
}

private struct FloatingAssistantWindow: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        configureWhenAttached(view)
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        configureWhenAttached(view)
    }

    private func configureWhenAttached(_ view: NSView) {
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            window.level = .floating
            window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
            window.hidesOnDeactivate = false
            window.orderFrontRegardless()
        }
    }
}

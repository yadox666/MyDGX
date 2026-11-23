import AppKit
import SwiftUI

private let nvidiaGreen = Color(red: 0.46, green: 0.73, blue: 0)

struct SparkSetupWizardView: View {
    @ObservedObject var wizard: SparkSetupWizard

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                Group {
                    switch wizard.step {
                    case .find: FindStepView(wizard: wizard)
                    case .connect: ConnectStepView(wizard: wizard)
                    case .install: InstallStepView(wizard: wizard)
                    case .done: DoneStepView(wizard: wizard)
                    }
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 22)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let error = wizard.errorMessage {
                ErrorBanner(message: error)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 8)
            }
            Divider()
            footer
        }
        .frame(width: 720, height: 700)
        .animation(.easeInOut(duration: 0.25), value: wizard.step)
    }

    private var header: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                Image(nsImage: TrayImages.nvidia)
                    .resizable()
                    .frame(width: 22, height: 22)
                Text("Asistente de instalación Spark")
                    .font(.title3.weight(.semibold))
                Spacer()
            }
            StepIndicator(current: wizard.step)
        }
        .padding(.horizontal, 28)
        .padding(.top, 34)
        .padding(.bottom, 16)
        .background(
            LinearGradient(
                colors: [nvidiaGreen.opacity(0.16), nvidiaGreen.opacity(0.03)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
    }

    @ViewBuilder
    private var footer: some View {
        HStack {
            if wizard.step != .find && wizard.step != .done {
                Button("Atrás") { wizard.goBack() }
                    .buttonStyle(WizardButtonStyle(prominent: false))
                    .disabled(wizard.isBusy)
            }
            Spacer()
            switch wizard.step {
            case .find:
                Button("Continuar") { wizard.continueToConnect() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(wizard.selected == nil)
            case .connect:
                Button(wizard.connecting ? String(localized: "Conectando…") : String(localized: "Conectar")) { wizard.connect() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(wizard.connecting || wizard.user.isEmpty)
            case .install:
                InstallFooterButtons(wizard: wizard)
            case .done:
                Button("Abrir Dashboard") { wizard.openDashboard() }
                    .buttonStyle(WizardButtonStyle(prominent: false))
                Button("Terminar") { wizard.finish() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .buttonStyle(WizardButtonStyle(prominent: true))
        .padding(.horizontal, 24)
        .padding(.vertical, 14)
    }
}

// MARK: Step indicator

private struct StepIndicator: View {
    let current: SparkSetupWizard.Step

    var body: some View {
        HStack(spacing: 0) {
            ForEach(SparkSetupWizard.Step.allCases, id: \.self) { step in
                let reached = step.rawValue <= current.rawValue
                HStack(spacing: 8) {
                    ZStack {
                        Circle()
                            .fill(reached ? nvidiaGreen : Color.secondary.opacity(0.18))
                            .frame(width: 30, height: 30)
                        Image(systemName: step.rawValue < current.rawValue ? "checkmark" : step.symbol)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(reached ? Color.white : Color.secondary)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Paso \(step.rawValue + 1)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(step.title)
                            .font(.callout.weight(step == current ? .semibold : .regular))
                            .foregroundStyle(reached ? .primary : .secondary)
                    }
                }
                if step != SparkSetupWizard.Step.allCases.last {
                    Capsule()
                        .fill(step.rawValue < current.rawValue ? nvidiaGreen : Color.secondary.opacity(0.2))
                        .frame(height: 3)
                        .padding(.horizontal, 10)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Paso \(current.rawValue + 1) de 4: \(current.title)")
    }
}

// MARK: Step 1 · find

private struct FindStepView: View {
    @ObservedObject var wizard: SparkSetupWizard
    @State private var showNewSparkHelp = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            StepTitle(
                title: String(localized: "Busca tu Spark"),
                detail: String(localized: "Enciende el Spark y conéctalo a la misma red que este Mac, por cable o Wi-Fi. MyDGX lo busca solo y detecta la marca, el modelo y el puerto de acceso.")
            )

            if !wizard.localNetworkPrimed {
                LocalNetworkPrimer { wizard.startSearch() }
            } else {
                searchCard
            }

            if wizard.localNetworkDenied {
                VStack(alignment: .leading, spacing: 8) {
                    Label("macOS ha bloqueado el acceso a la red local", systemImage: "hand.raised.fill")
                        .font(.headline)
                        .foregroundStyle(.orange)
                    Text(
                        "Abre Ajustes del Sistema › Privacidad y seguridad › Red local, activa «MyDGX Tray» y pulsa Buscar otra vez."
                    )
                    .font(.callout)
                    Button("Abrir Ajustes de Red local") { wizard.openLocalNetworkSettings() }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
            }

            if !wizard.candidates.isEmpty {
                VStack(spacing: 8) {
                    ForEach(wizard.candidates) { candidate in
                        CandidateRow(
                            candidate: candidate,
                            selected: wizard.selectedID == candidate.id
                        )
                        .onTapGesture(count: 2) {
                            wizard.selectedID = candidate.id
                            wizard.continueToConnect()
                        }
                        .onTapGesture { wizard.selectedID = candidate.id }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("¿No aparece? Escribe su dirección")
                    .font(.headline)
                HStack {
                    TextField("IP o nombre, por ejemplo 192.168.1.50 o spark-1a2b.local", text: $wizard.manualAddress)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { wizard.checkManualAddress() }
                    TextField("Puerto", text: $wizard.manualPort, prompt: Text("auto"))
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 72)
                    Button(wizard.checkingAddress ? String(localized: "Comprobando…") : String(localized: "Comprobar")) {
                        wizard.checkManualAddress()
                    }
                    .disabled(wizard.manualAddress.isEmpty || wizard.checkingAddress)
                }
                Text("El nombre viene en la etiqueta del Spark. Si no sabes el puerto, déjalo en «auto».")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            DisclosureGroup("¿Tu Spark es nuevo y aún no lo has encendido?", isExpanded: $showNewSparkHelp) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(
                        "Primero completa el arranque oficial de NVIDIA: conecta pantalla y teclado (o usa el Wi-Fi temporal de la guía), crea tu usuario y contraseña, conéctalo a tu red y espera a que terminen las actualizaciones. Después vuelve aquí."
                    )
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    HStack {
                        Button("Abrir la guía de NVIDIA") {
                            NSWorkspace.shared.open(SSHBootstrap.officialSetupURL)
                        }
                        Button("Preparar un USB OEMDATA…") { OEMDataPicker.run() }
                    }
                }
                .padding(.top, 6)
            }
        }
        .onAppear {
            if wizard.candidates.isEmpty && wizard.localNetworkPrimed { wizard.startSearch() }
        }
    }

    private var searchCard: some View {
        HStack(spacing: 16) {
            DiscoveryRadarView(active: wizard.searching, size: 56)
            VStack(alignment: .leading, spacing: 6) {
                Text(searchTitle)
                    .font(.headline)
                if wizard.searching {
                    WizardProgressBar(value: wizard.searchProgress)
                }
                Text(searchDetail)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if !wizard.searching {
                Button {
                    wizard.startSearch()
                } label: {
                    Label("Buscar otra vez", systemImage: "arrow.clockwise")
                }
            }
        }
        .padding(14)
        .background(nvidiaGreen.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }

    private var searchTitle: String {
        if wizard.searching { return String(localized: "Buscando en tu red…") }
        switch wizard.candidates.count {
        case 0: return String(localized: "No se encontró ningún Spark")
        case 1: return String(localized: "¡Spark encontrado!")
        default: return String(localized: "\(wizard.candidates.count) equipos encontrados")
        }
    }

    private var searchDetail: String {
        if wizard.searching {
            return wizard.candidates.isEmpty
                ? String(localized: "Puede tardar unos segundos.")
                : String(localized: "Ya hay \(wizard.candidates.count) equipo(s). Sigo buscando…")
        }
        return wizard.candidates.isEmpty
            ? String(localized: "Comprueba que está encendido, o escribe su dirección abajo.")
            : String(localized: "Elige tu equipo y pulsa Continuar.")
    }
}

private struct LocalNetworkPrimer: View {
    let onSearch: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: "network")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(nvidiaGreen)
                .frame(width: 56, height: 56)
                .background(nvidiaGreen.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 8) {
                Text("Primero, permite el acceso a tu red")
                    .font(.headline)
                Text(
                    "Al pulsar Buscar, macOS preguntará si «MyDGX Tray» puede encontrar dispositivos en tu red local. Pulsa **Permitir**: sin ese permiso la app no puede encontrar el Spark ni conectarse a él. Solo se pregunta una vez."
                )
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                Button {
                    onSearch()
                } label: {
                    Label("Buscar mi Spark", systemImage: "dot.radiowaves.left.and.right")
                }
                .buttonStyle(WizardButtonStyle(prominent: true))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(nvidiaGreen.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct CandidateRow: View {
    let candidate: SparkSetupWizard.Candidate
    let selected: Bool

    var body: some View {
        HStack(spacing: 14) {
            Image(nsImage: DevicePhoto.image(model: candidate.guess.model, variant: candidate.guess.variant))
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: "\(candidate.guess.brand) \(candidate.guess.model)")
                    .font(.headline)
                Text(
                    String(localized: "\([candidate.name, candidate.host].uniqued().joined(separator: " · ")) · puerto SSH \(String(candidate.port))")
                )
                .font(.callout)
                .foregroundStyle(.secondary)
                if let hint = candidate.systemHint {
                    Label(hint, systemImage: "cpu")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .font(.title2)
                .foregroundStyle(selected ? nvidiaGreen : Color.secondary.opacity(0.5))
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(selected ? nvidiaGreen.opacity(0.1) : Color(nsColor: .controlBackgroundColor))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(selected ? nvidiaGreen : Color.primary.opacity(0.08), lineWidth: selected ? 2 : 1)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: Step 2 · connect

private struct ConnectStepView: View {
    @ObservedObject var wizard: SparkSetupWizard

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            StepTitle(
                title: String(localized: "Inicia sesión en el Spark"),
                detail: String(localized: "Usa el usuario y la contraseña que creaste al encender el Spark por primera vez. La contraseña solo sirve para autorizar este Mac con una clave segura: no se guarda.")
            )

            HStack(alignment: .top, spacing: 24) {
                DevicePhoto(detectedModel: wizard.detectedModel, detectedVariant: wizard.detectedVariant)
                    .frame(width: 200)

                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                    GridRow {
                        Text("Nombre")
                            .foregroundStyle(.secondary)
                        TextField("Mi Spark", text: $wizard.alias)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        Text("Usuario")
                            .foregroundStyle(.secondary)
                        TextField("usuario", text: $wizard.user)
                            .textFieldStyle(.roundedBorder)
                            .textContentType(.username)
                    }
                    GridRow {
                        Text("Contraseña")
                            .foregroundStyle(.secondary)
                        SecureField(
                            wizard.useExistingKey
                                ? String(localized: "Solo si el Spark aún no acepta tu clave")
                                : String(localized: "Contraseña del Spark"),
                            text: $wizard.password
                        )
                        .textFieldStyle(.roundedBorder)
                        .textContentType(.password)
                        .onSubmit { wizard.connect() }
                    }
                    GridRow {
                        Color.clear.frame(width: 1, height: 1)
                        Toggle("Ya tengo una clave SSH", isOn: $wizard.useExistingKey)
                    }
                    if wizard.useExistingKey {
                        GridRow {
                            Text("Clave")
                                .foregroundStyle(.secondary)
                            HStack {
                                Text(wizard.existingKeyPath.isEmpty ? String(localized: "Ninguna elegida") : wizard.existingKeyPath)
                                    .font(.caption.monospaced())
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Spacer()
                                Button("Elegir…") { wizard.chooseExistingKey() }
                            }
                        }
                        if let error = wizard.existingKeyError {
                            GridRow {
                                Color.clear.frame(width: 1, height: 1)
                                Label(error, systemImage: "exclamationmark.triangle.fill")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                        } else if wizard.needsKeyPassphrase {
                            GridRow {
                                Text("Frase de paso")
                                    .foregroundStyle(.secondary)
                                SecureField("Frase de paso de tu clave", text: $wizard.keyPassphrase)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { wizard.connect() }
                            }
                            GridRow {
                                Color.clear.frame(width: 1, height: 1)
                                Text("Se guarda en el Llavero de macOS para que el túnel se reconecte solo.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } else if wizard.existingKeyInfo?.encrypted == true {
                            GridRow {
                                Color.clear.frame(width: 1, height: 1)
                                Label("Clave desbloqueada en el agente SSH", systemImage: "lock.open")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .disabled(wizard.connecting)

            if !wizard.connectChecklist.isEmpty {
                Checklist(items: wizard.connectChecklist)
            }

            if let facts = wizard.facts {
                FactsCard(facts: facts)
            }

            if let existing = wizard.existingProfile {
                Label(
                    "Este Spark ya estaba en MyDGX como «\(existing.alias)». Se actualizará ese perfil en vez de crear otro.",
                    systemImage: "arrow.triangle.2.circlepath"
                )
                .font(.callout)
                .foregroundStyle(.blue)
            }

            if !wizard.hostFingerprint.isEmpty {
                Label("Huella del Spark guardada: \(wizard.hostFingerprint)", systemImage: "lock.shield")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
    }
}

private struct FactsCard: View {
    let facts: SparkSetup.SparkFacts

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
            row("Equipo", "\(facts.device.brand) \(facts.device.model)", "desktopcomputer")
            row("Sistema", facts.systemDescription, facts.isDGXOS ? "checkmark.seal" : "info.circle")
            if !facts.gpu.isEmpty {
                row("GPU", facts.gpu, "cpu")
            }
            row(
                "MyDGX",
                facts.mydgxRunning
                    ? String(localized: "Instalado y funcionando")
                    : (facts.mydgxInstalled ? String(localized: "Instalado, detenido") : String(localized: "Aún no instalado")),
                "shippingbox"
            )
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
    }

    private func row(_ title: LocalizedStringKey, _ value: String, _ symbol: String) -> some View {
        GridRow {
            Label(title, systemImage: symbol)
                .foregroundStyle(.secondary)
            Text(value)
                .textSelection(.enabled)
        }
    }
}

// MARK: Step 3 · install

private struct InstallStepView: View {
    @ObservedObject var wizard: SparkSetupWizard

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            StepTitle(
                title: alreadyRunning ? String(localized: "MyDGX ya está instalado en el Spark") : String(localized: "Instala MyDGX en el Spark"),
                detail: alreadyRunning && !wizard.installing
                    ? String(localized: "MyDGX ya funciona en este Spark. Pulsa Conectar para empezar a usarlo, o Reinstalar para actualizarlo con la versión de esta app.")
                    : String(localized: "Se instalará el panel MyDGX, el motor de IA optimizado para la GPU GB10, Open WebUI, ComfyUI y Whisper. La primera vez tarda entre 20 y 40 minutos. Puedes seguir usando el Mac; no apagues el Spark.")
            )

            if wizard.installing || wizard.installFinished || wizard.logURL != nil {
                progressCard
            } else {
                if let facts = wizard.facts {
                    FactsCard(facts: facts)
                }
                if wizard.needsSudoPassword {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Contraseña de administrador del Spark")
                            .font(.headline)
                        SecureField("Contraseña", text: $wizard.sudoPassword)
                            .textFieldStyle(.roundedBorder)
                            .textContentType(.password)
                            .frame(maxWidth: 320)
                        Text(alreadyRunning
                             ? LocalizedStringKey("Solo hace falta para Reinstalar. Conectar no instala nada en el Spark.")
                             : LocalizedStringKey("Hace falta para instalar paquetes del sistema. Solo se usa durante la instalación."))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var alreadyRunning: Bool {
        wizard.facts?.mydgxInstalled == true && wizard.facts?.mydgxRunning == true
    }

    private var progressCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(SparkSetupWizard.installPhases[wizard.phaseIndex].title)
                    .font(.headline)
                Spacer()
                Text("\(Int((wizard.overallProgress * 100).rounded()))% total")
                    .font(.title2.monospacedDigit().weight(.semibold))
                    .foregroundStyle(nvidiaGreen)
            }
            WizardProgressBar(value: wizard.overallProgress, height: 10)
            HStack {
                if wizard.installing {
                    ProgressView().controlSize(.small)
                }
                Text(wizard.currentActivity)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Spacer()
                Text(elapsed)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(SparkSetupWizard.installPhases.enumerated()).filter { !wizard.linkOnly || $0.element.id == "link" }, id: \.element.id) { index, phase in
                    PhaseRow(
                        title: phase.title,
                        state: phaseState(index),
                        fraction: index == wizard.phaseIndex ? wizard.phaseFraction : nil
                    )
                }
            }
            .padding(.top, 4)

            if wizard.logURL != nil {
                Button {
                    wizard.openLog()
                } label: {
                    Label("Ver registro detallado", systemImage: "doc.text.magnifyingglass")
                }
                .buttonStyle(.link)
            }
        }
        .padding(16)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
    }

    private func phaseState(_ index: Int) -> SparkSetupWizard.TaskState {
        if wizard.installFinished || index < wizard.phaseIndex { return .done }
        if index == wizard.phaseIndex {
            if wizard.installing { return .running }
            return wizard.errorMessage == nil ? .pending : .failed
        }
        return .pending
    }

    private var elapsed: String {
        let seconds = wizard.elapsedSeconds
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

private struct InstallFooterButtons: View {
    @ObservedObject var wizard: SparkSetupWizard

    var body: some View {
        let running = wizard.facts?.mydgxInstalled == true && wizard.facts?.mydgxRunning == true
        let started = wizard.logURL != nil || wizard.installFinished
        if wizard.installing {
            Button(wizard.linkOnly ? LocalizedStringKey("Conectando…") : LocalizedStringKey("Instalando…")) {}
                .disabled(true)
        } else if started || wizard.errorMessage != nil {
            Button("Reintentar") { wizard.install(reinstall: started) }
                .keyboardShortcut(.defaultAction)
        } else if running {
            Button("Reinstalar") { wizard.install(reinstall: true) }
                .buttonStyle(WizardButtonStyle(prominent: false))
            Button("Conectar") { wizard.install(reinstall: false) }
                .keyboardShortcut(.defaultAction)
        } else {
            Button("Instalar MyDGX") { wizard.install(reinstall: true) }
                .keyboardShortcut(.defaultAction)
                .disabled(wizard.needsSudoPassword && wizard.sudoPassword.isEmpty)
        }
    }
}

private struct PhaseRow: View {
    let title: String
    let state: SparkSetupWizard.TaskState
    let fraction: Double?

    var body: some View {
        HStack(spacing: 10) {
            StateIcon(state: state)
            Text(title)
                .foregroundStyle(state == .pending ? .secondary : .primary)
            Spacer()
            if state == .running, let fraction {
                WizardProgressBar(value: fraction)
                    .frame(width: 120)
            }
        }
        .font(.callout)
    }
}

// MARK: Step 4 · done

private struct DoneStepView: View {
    @ObservedObject var wizard: SparkSetupWizard

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(nvidiaGreen)
                .padding(.top, 8)
            Text("¡Tu Spark está listo!")
                .font(.largeTitle.weight(.semibold))
            Text(
                "\(wizard.alias) está conectado a este Mac mediante un túnel seguro. Encontrarás MyDGX en la barra de menús, junto al reloj: desde ahí puedes ver el estado, cargar modelos y abrir el Dashboard."
            )
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)
            .frame(maxWidth: 520)

            HStack(spacing: 20) {
                DevicePhoto(detectedModel: wizard.detectedModel, detectedVariant: wizard.detectedVariant)
                    .frame(width: 210)
                if let facts = wizard.facts {
                    FactsCard(facts: facts)
                }
            }
            .frame(maxWidth: 600)
            Text("¿Tienes otro Spark? Abre Preferencias y pulsa el botón del asistente.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: Shared pieces

private struct StepTitle: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.title.weight(.semibold))
            Text(detail)
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct Checklist: View {
    let items: [SparkSetupWizard.ChecklistItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            WizardProgressBar(value: progress)
            LazyVGrid(
                columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)],
                alignment: .leading,
                spacing: 8
            ) {
                ForEach(items) { item in
                    row(item)
                }
            }
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
    }

    private func row(_ item: SparkSetupWizard.ChecklistItem) -> some View {
        HStack(spacing: 10) {
            StateIcon(state: item.state)
            Text(item.title)
                .foregroundStyle(item.state == .pending ? .secondary : .primary)
            if item.state == .skipped {
                Text("· no hacía falta")
                    .foregroundStyle(.secondary)
            }
        }
        .font(.callout)
    }

    private var progress: Double {
        let finished = items.filter { $0.state == .done || $0.state == .skipped }.count
        return items.isEmpty ? 0 : Double(finished) / Double(items.count)
    }
}

private struct StateIcon: View {
    let state: SparkSetupWizard.TaskState

    var body: some View {
        Group {
            switch state {
            case .pending:
                Image(systemName: "circle")
                    .foregroundStyle(Color.secondary.opacity(0.5))
            case .running:
                ProgressView().controlSize(.small)
            case .done:
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(nvidiaGreen)
            case .skipped:
                Image(systemName: "checkmark.circle")
                    .foregroundStyle(nvidiaGreen)
            case .failed:
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.red)
            }
        }
        .frame(width: 18, height: 18)
    }
}

private struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .font(.callout)
        .padding(12)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }
}

private enum OEMDataPicker {
    @MainActor
    static func run() {
        let panel = NSOpenPanel()
        panel.title = String(localized: "Selecciona el volumen OEMDATA")
        panel.message = String(localized: "Debe ser un USB FAT32 montado con el nombre exacto OEMDATA.")
        panel.directoryURL = URL(fileURLWithPath: "/Volumes", isDirectory: true)
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let volume = panel.url else { return }
        let existing = ["meta-data", "user-data"].filter {
            FileManager.default.fileExists(atPath: volume.appendingPathComponent($0).path)
        }
        if !existing.isEmpty {
            let alert = NSAlert()
            alert.alertStyle = .critical
            alert.messageText = String(localized: "¿Sobrescribir los archivos cloud-init?")
            alert.informativeText = String(localized: "Se sustituirán \(ListFormatter.localizedString(byJoining: existing)) en \(volume.path).")
            alert.addButton(withTitle: String(localized: "Sobrescribir"))
            alert.addButton(withTitle: String(localized: "Cancelar"))
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        let alert = NSAlert()
        do {
            try OEMDataGenerator.writeSeed(to: volume)
            alert.messageText = String(localized: "USB OEMDATA preparado")
            alert.informativeText = String(localized: "Expúlsalo de forma segura antes de conectarlo al Spark.")
        } catch {
            alert.alertStyle = .warning
            alert.messageText = String(localized: "No se pudo preparar el USB")
            alert.informativeText = error.localizedDescription
        }
        alert.runModal()
    }
}

private extension Array where Element == String {
    func uniqued() -> [String] {
        var seen = Set<String>()
        return filter { seen.insert($0.lowercased()).inserted }
    }
}

private struct WizardProgressBar: View {
    let value: Double
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.15))
                Capsule()
                    .fill(LinearGradient(
                        colors: [nvidiaGreen.opacity(0.8), nvidiaGreen],
                        startPoint: .leading,
                        endPoint: .trailing
                    ))
                    .frame(width: max(height, geometry.size.width * min(1, max(0, value))))
            }
        }
        .frame(height: height)
        .animation(.easeOut(duration: 0.4), value: value)
        .accessibilityElement()
        .accessibilityLabel("Progreso")
        .accessibilityValue("\(Int((value * 100).rounded())) por ciento")
    }
}

private struct WizardButtonStyle: ButtonStyle {
    let prominent: Bool
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(prominent ? .semibold : .regular))
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .foregroundStyle(prominent ? Color.white : Color.primary)
            .background(
                Capsule().fill(
                    prominent
                        ? nvidiaGreen.opacity(configuration.isPressed ? 0.75 : 1)
                        : Color.secondary.opacity(configuration.isPressed ? 0.25 : 0.14)
                )
            )
            .opacity(isEnabled ? 1 : 0.45)
            .contentShape(Capsule())
    }
}

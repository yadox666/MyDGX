import AppKit
import SwiftUI

struct MenuContentView: View {
    @ObservedObject var model: AppModel
    @ObservedObject private var updater = AppUpdater.shared

    var body: some View {
        if model.needsSetup {
            setupMenu
        } else {
            fullMenu
        }
    }

    @ViewBuilder
    private var setupMenu: some View {
        Text("MyDGX · ningún Spark configurado")
        Button {
            model.openSetupWizard()
        } label: {
            Label("Asistente de instalación Spark…", systemImage: "wand.and.stars")
        }
        Divider()
        Button {
            NSApp.terminate(nil)
        } label: {
            Label("Salir de MyDGX", systemImage: "xmark.circle")
        }
        .keyboardShortcut("q")
    }

    @ViewBuilder
    private var fullMenu: some View {
        Text(
            "\(model.configuration.activeConnection.alias) · "
                + (
                    model.overview == nil
                        ? "(\(model.statusMessage))"
                        : model.statusMessage
                )
        )

        Text(
            model.overview.map {
                "RAM libre: \(formatBytes($0.metrics.freeMemory)) / "
                    + "\(formatBytes($0.metrics.memoryTotal))"
            } ?? "RAM libre: —"
        )

        if let suite = model.benchmarkSuite {
            Divider()
            Label(
                suite.status == "restoring"
                    ? "Restaurando estado anterior"
                    : "Ejecutando benchmarks",
                systemImage: suite.status == "restoring"
                    ? "arrow.counterclockwise.circle.fill"
                    : "gauge.with.dots.needle.67percent"
            )
            .foregroundStyle(.green)

            ProgressView(value: max(0, min(100, suite.progress)), total: 100)

            Text(
                "\(suite.completedModels)/\(suite.totalModels) modelos"
                    + " · \(Int(suite.progress.rounded()))%"
            )
            if !suite.message.isEmpty {
                Text(suite.message)
            }
            Text("Los modelos y perfiles anteriores se restaurarán al terminar.")
                .foregroundStyle(.secondary)
            Divider()
        }

        if model.configuration.connections.count > 1 {
            Menu {
                ForEach(model.configuration.connections) { connection in
                    let availability = model.connectionAvailability[connection.id]
                    let active = connection.id == model.configuration.activeConnectionID
                    let state = availability == nil
                        ? "Comprobando"
                        : (availability == true ? "Online" : "Offline")
                    Button {
                        model.activateConnection(id: connection.id)
                    } label: {
                        Label(
                            "\(active ? "✓ " : "")\(connection.alias) · \(state)",
                            systemImage: availability == nil
                                ? "clock"
                                : (availability == true
                                    ? "checkmark.circle.fill"
                                    : "xmark.circle")
                        )
                    }
                }
            } label: {
                Label("Cambiar equipo", systemImage: "server.rack")
            }
            .disabled(model.operationInProgress)
        }

        Button {
            if model.tunnelRunning {
                model.stopManagedTunnel()
            } else {
                model.startConnection()
            }
        } label: {
            Label(
                model.tunnelRunning
                    ? "Detener conexión y túnel"
                    : (
                        model.configuration.activeConnection.tunnel.enabled
                            ? "Iniciar conexión y túnel"
                            : "Conectar"
                    ),
                systemImage: model.tunnelRunning ? "network.slash" : "network"
            )
        }
        .disabled(!model.canToggleConnection)

        Button {
            confirmShutdown()
        } label: {
            Label("Apagar equipo…", systemImage: "power")
        }
        .disabled(!model.canShutdown)

        Divider()

        Text(
            "Perfiles cargados: \(model.runningUserProfileCount)/2 · "
                + "\(model.runtime?.runningModels ?? 0) modelo(s)"
        )

        ForEach(model.runningProfiles.filter { $0.id == "mydgx-quick" }) { profile in
            ForEach(profile.models ?? []) { quickModel in
                Text("\(quickModel.label) · encendido desde Modelos")
                Button {
                    confirmStopQuickModel(quickModel)
                } label: {
                    Label("Apagar \(quickModel.label)", systemImage: "power")
                }
                .disabled(!model.canManageProfiles)
            }
        }

        ForEach(model.runningProfiles.filter { $0.id != "mydgx-quick" }) { profile in
            Text(
                "\(profile.name)"
                    + (profile.active == 1 ? " · predeterminado" : "")
                    + " · \(profileSize(profile))"
            )
            if profile.isReadOnly, let labels = profile.modelLabels, !labels.isEmpty {
                Text("   " + labels.joined(separator: " · "))
                    .font(.caption)
            }
            Button {
                confirmStopProfile(profile)
            } label: {
                Label("Detener \(profile.name)", systemImage: "stop.circle")
            }
            .disabled(!model.canManageProfiles)
        }

        if let pending = model.pendingProfileName {
            Text(
                "\(pending) · "
                    + (model.machineActivity ?? "Preparando perfil…")
            )
        } else if let activity = model.machineActivity,
                  activity.hasPrefix("Error") {
            Text(activity)
        } else if model.runningProfiles.isEmpty {
            Text(model.machineActivity ?? "Ningún perfil cargado")
        }

        Menu {
            ForEach(model.profiles.filter { $0.id != "mydgx-quick" }) { profile in
                Button {
                    Task { await preflightAndConfirmProfile(profile) }
                } label: {
                    if model.isProfileRunning(profile) {
                        Label(
                            "\(profile.name) · cargado · \(profileSize(profile))"
                                + profileAvailabilitySuffix(profile),
                            systemImage: profile.active == 1
                                ? "checkmark.circle.fill"
                                : "circle.fill"
                        )
                    } else if profile.active == 1 {
                        Label(
                            "\(profile.name) · predeterminado · \(profileSize(profile))"
                                + profileAvailabilitySuffix(profile),
                            systemImage: "checkmark"
                        )
                    } else {
                        Text(
                            "\(profile.name) · \(profileSize(profile))"
                                + profileAvailabilitySuffix(profile)
                        )
                    }
                }
                .disabled(
                    !model.canManageProfiles
                        || model.isProfileRunning(profile)
                        || (!profile.isReadOnly && model.runningUserProfileCount >= 2)
                        || profile.runtimePlan?.fits == false
                )
            }
        } label: {
            Label("Arrancar otro perfil", systemImage: "slider.horizontal.3")
        }
        .disabled(model.profiles.isEmpty || !model.canManageProfiles)

        Divider()

        Button {
            model.openDashboard()
        } label: {
            Label("Abrir Dashboard", systemImage: "safari")
        }
        .disabled(!model.canOpenDashboard)

        Button {
            model.openOpenWebUI()
        } label: {
            Label("Abrir Open WebUI", systemImage: "message")
        }
        .disabled(!model.canUseAPI)

        Button {
            model.openComfyUI()
        } label: {
            Label("Abrir ComfyUI", systemImage: "wand.and.stars")
        }
        .disabled(!model.canUseAPI)

        ForEach(model.webApps) { app in
            Button {
                model.openWebApp(app)
            } label: {
                Label("Abrir \(app.alias)", systemImage: "globe")
            }
            .disabled(!model.canUseAPI || app.state != "running" || !app.isValidPort)
        }

        Button {
            model.openSSH()
        } label: {
            Label("Abrir Terminal SSH", systemImage: "terminal")
        }
        .disabled(!model.canUseSSH)

        Menu {
            if let reason = model.codingAgentBlockReason {
                Text(reason)
                Divider()
            }
            ForEach(AppModel.CodingAgent.allCases) { agent in
                Button {
                    model.openCodingAgent(agent, active: false)
                } label: {
                    Text("\(agent.title) · plan, solo lectura")
                }
                .disabled(model.codingAgentBlockReason != nil)
                Button {
                    model.openCodingAgent(agent, active: true)
                } label: {
                    Text("\(agent.title) · edición (--active)")
                }
                .disabled(model.codingAgentBlockReason != nil)
            }
        } label: {
            Label(
                model.codingAgentBlockReason == nil
                    ? "Agentes de código"
                    : "Agentes de código · sin modelo adecuado",
                systemImage: "chevron.left.forwardslash.chevron.right"
            )
        }
        .disabled(!model.canUseAPI || !model.canDeploy(model.configuration.activeConnection))

        Divider()

        Button {
            model.openSettings()
        } label: {
            Label("Preferencias…", systemImage: "gearshape")
        }

        if let release = updater.availableRelease {
            Button {
                model.openSettings()
            } label: {
                Label("Actualización disponible: \(release.version)…", systemImage: "arrow.down.circle")
            }
        }

        Button {
            NSApp.terminate(nil)
        } label: {
            Label("Salir de MyDGX", systemImage: "xmark.circle")
        }
        .keyboardShortcut("q")
    }

    // The menu is rebuilt on every poll, so an item can move under the pointer while profiles reload.
    private func confirmStopProfile(_ profile: InferenceProfile) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "¿Detener \(profile.name)?"
        alert.informativeText = """
        Se descargarán sus modelos y se parará su app si tiene una. \
        No volverá a arrancar en el próximo inicio.
        """
        alert.addButton(withTitle: "Detener perfil")
        alert.addButton(withTitle: "Cancelar")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task { await model.stopProfile(profile) }
    }

    private func confirmStopQuickModel(_ quickModel: ProfileModelSummary) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "¿Apagar \(quickModel.label)?"
        alert.informativeText = "Se quitará del perfil Quick y liberará su memoria."
        alert.addButton(withTitle: "Apagar modelo")
        alert.addButton(withTitle: "Cancelar")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task { await model.stopQuickModel(quickModel) }
    }

    private func confirmShutdown() {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "¿Apagar \(model.configuration.activeConnection.alias)?"
        alert.informativeText = """
        Se detendrán los modelos y servicios del equipo. La aplicación comprobará \
        después que el apagado se haya completado. ¿Está seguro de que desea continuar?
        """
        alert.addButton(withTitle: "Apagar equipo")
        alert.addButton(withTitle: "Cancelar")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task { await model.shutdown() }
    }

    private func preflightAndConfirmProfile(_ profile: InferenceProfile) async {
        let plan: ProfileRuntimePlan
        do {
            plan = try await model.profileRuntimePlan(profile)
        } catch {
            showProfileError(error.localizedDescription)
            return
        }
        guard plan.fits else {
            showProfileError(model.profilePlanFailure(plan))
            return
        }

        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "¿Arrancar \(profile.name)?"
        let current = model.runningProfiles.count
        let currentMessage = current == 0
            ? "No hay perfiles cargados."
            : "Los \(current) perfil(es) cargados seguirán funcionando."
        alert.informativeText = """
        \(currentMessage)

        Memoria adicional: \(formatGB(plan.incrementalMB))
        Memoria total prevista: \(formatGB(plan.requiredMB)) de \(formatGB(plan.capacityMB))
        Reserva del sistema: \(formatGB(plan.reserveMB))
        Modelos compartidos: \(plan.sharedModels)

        \(profile.isReadOnly ? "" : "Este perfil será el predeterminado para el próximo arranque. ")La aplicación \
        mostrará y supervisará la descarga y la carga, que pueden tardar más de 15 minutos. \
        ¿Está seguro de que desea continuar?
        """
        alert.addButton(withTitle: "Arrancar perfil")
        alert.addButton(withTitle: "Cancelar")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        await model.activateAndStart(profile)
    }

    private func showProfileError(_ message: String) {
        model.lastError = message
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "No se puede arrancar el perfil"
        alert.informativeText = message
        alert.addButton(withTitle: "Aceptar")
        alert.runModal()
    }

    private func formatGB(_ megabytes: Int) -> String {
        String(format: "%.1f GB", Double(megabytes) / 1024)
    }

    private func profileSize(_ profile: InferenceProfile) -> String {
        guard let megabytes = profile.memoryPlan?.requiredMB else { return "—" }
        return formatGB(megabytes)
    }

    private func profileAvailabilitySuffix(_ profile: InferenceProfile) -> String {
        guard let plan = profile.runtimePlan, !plan.fits else { return "" }
        if userProfileCount(plan.profileIDs) > 2 {
            return " · límite de 2 perfiles"
        }
        if !plan.aliasConflicts.isEmpty, !plan.portConflicts.isEmpty {
            return " · alias y puerto en uso"
        }
        if !plan.aliasConflicts.isEmpty {
            return " · alias en uso"
        }
        if let port = plan.portConflicts.first {
            return " · puerto \(port) ocupado"
        }
        if plan.requiredMB > plan.capacityMB {
            return " · total \(formatGB(plan.requiredMB)) > \(formatGB(plan.capacityMB))"
        }
        if plan.incrementalMB + plan.reserveMB > plan.availableMB {
            return " · necesita \(formatGB(plan.incrementalMB)) + "
                + "\(formatGB(plan.reserveMB)) reserva"
        }
        return " · no disponible"
    }

    private func formatBytes(_ bytes: Int64) -> String {
        String(format: "%.1f GB", Double(bytes) / 1_073_741_824)
    }

}

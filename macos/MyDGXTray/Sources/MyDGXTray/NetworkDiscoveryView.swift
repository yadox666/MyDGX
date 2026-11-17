import SwiftUI

struct NetworkDiscoveryView: View {
    let configuration: MyDGXConfiguration
    let onSave: (MyDGXConfiguration) throws -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var discovery = DGXDiscovery()
    @State private var phase = Phase.searching
    @State private var progress = 0.0
    @State private var detail = "Preparando la búsqueda en la red local…"
    @State private var deviceStates: [String: DeviceState] = [:]
    @State private var running = false
    @State private var result: DGXImportResult?
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 16) {
                DiscoveryRadarView(active: running, size: 72)
                VStack(alignment: .leading, spacing: 5) {
                    Text(phase.title)
                        .font(.title2.weight(.semibold))
                    Text(detail)
                        .foregroundStyle(.secondary)
                    ProgressView(value: progress)
                        .progressViewStyle(.linear)
                        .tint(.green)
                }
            }

            phaseStrip

            GroupBox {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        if discovery.devices.isEmpty {
                            VStack(spacing: 9) {
                                Image(
                                    systemName: running
                                        ? "antenna.radiowaves.left.and.right"
                                        : "network.slash"
                                )
                                .font(.system(size: 30))
                                .foregroundStyle(.secondary)
                                Text(
                                    running
                                        ? "Escuchando anuncios Bonjour…"
                                        : "No se encontraron equipos"
                                )
                                .font(.headline)
                                Text(
                                    running
                                        ? "Los DGX aparecerán aquí a medida que respondan."
                                        : "Comprueba que el equipo y este Mac estén en la misma red."
                                )
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, minHeight: 180)
                        } else {
                            ForEach(discovery.devices) { device in
                                deviceCard(device)
                            }
                        }
                    }
                    .padding(8)
                }
                .frame(minHeight: 210, maxHeight: 300)
            } label: {
                Label(
                    "\(discovery.devices.count) equipo(s) detectado(s)",
                    systemImage: "server.rack"
                )
            }

            if let result {
                resultSummary(result)
            }
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }

            HStack {
                Button("Cerrar", role: .cancel) { dismiss() }
                    .disabled(running)
                Spacer()
                Button {
                    Task { await runDiscovery() }
                } label: {
                    Label(
                        result == nil ? "Buscar de nuevo" : "Repetir búsqueda",
                        systemImage: "arrow.clockwise"
                    )
                }
                .disabled(running)
            }
        }
        .padding(22)
        .frame(width: 620, height: 600)
        .task { await runDiscovery() }
        .onDisappear { discovery.stop() }
    }

    private var phaseStrip: some View {
        HStack(spacing: 0) {
            ForEach(Phase.allCases, id: \.self) { item in
                VStack(spacing: 4) {
                    Image(systemName: phase.position > item.position ? "checkmark.circle.fill" : item.symbol)
                        .foregroundStyle(
                            phase.position > item.position || phase == item ? Color.green : Color.secondary
                        )
                    Text(item.shortTitle)
                        .font(.caption2)
                        .foregroundStyle(phase == item ? .primary : .secondary)
                }
                .frame(maxWidth: .infinity)
                if item != Phase.allCases.last {
                    Rectangle()
                        .fill(phase.position > item.position ? Color.green : Color.secondary.opacity(0.25))
                        .frame(height: 2)
                        .frame(maxWidth: 42)
                }
            }
        }
    }

    private func deviceCard(_ device: DiscoveredDGX) -> some View {
        let state = deviceStates[device.id] ?? .found
        return HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 9)
                    .fill(state.color.opacity(0.13))
                Image(systemName: state.symbol)
                    .font(.title3)
                    .foregroundStyle(state.color)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 2) {
                Text(device.name)
                    .font(.callout.weight(.semibold))
                Text(
                    "\(device.ipAddress ?? "IP sin resolver") · "
                        + "\(device.host) · SSH \(device.port)"
                        + (device.portVerified ? " ✓" : " (sin verificar)")
                )
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                Text(state.detail)
                    .font(.caption)
                    .foregroundStyle(state.color)
            }
            Spacer()
            if state.isWorking {
                ProgressView().controlSize(.small)
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
    }

    private func resultSummary(_ result: DGXImportResult) -> some View {
        HStack(spacing: 16) {
            summaryValue(result.added.count, "Añadidos", .green)
            summaryValue(result.existing.count, "Existentes", .blue)
            summaryValue(result.unverified.count, "Sin clave", .orange)
        }
        .padding(12)
        .background(Color.green.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    private func summaryValue(_ value: Int, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.title2.bold())
                .foregroundStyle(color)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    @MainActor
    private func runDiscovery() async {
        guard !running else { return }
        running = true
        result = nil
        errorMessage = nil
        deviceStates = [:]
        phase = .searching
        progress = 0.02
        detail = "Buscando anuncios SSH de DGX, Spark o NVIDIA…"
        discovery.start()

        for tick in 1...30 {
            try? await Task.sleep(nanoseconds: 200_000_000)
            guard !Task.isCancelled else { return }
            progress = 0.02 + (Double(tick) / 30.0 * 0.36)
            for device in discovery.devices where deviceStates[device.id] == nil {
                deviceStates[device.id] = .found
            }
        }
        discovery.stop()

        guard !discovery.devices.isEmpty else {
            phase = .completed
            progress = 1
            detail = "Búsqueda finalizada sin resultados."
            running = false
            return
        }

        phase = .verifying
        detail = "Comprobando duplicados y claves SSH autorizadas…"
        let imported = await DGXAutoImporter.importDevices(
            discovery.devices,
            into: configuration
        ) { update in
            deviceStates[update.deviceID] = DeviceState(
                stage: update.stage,
                detail: update.detail
            )
            let fraction = update.total > 0
                ? Double(update.completed) / Double(update.total)
                : 1
            progress = 0.4 + (fraction * 0.48)
            detail = update.detail
        }

        phase = .saving
        progress = 0.93
        detail = imported.added.isEmpty
            ? "No hay equipos nuevos que guardar."
            : "Guardando \(imported.added.count) equipo(s) en MyDGX…"
        do {
            if imported.configuration != configuration {
                try onSave(imported.configuration)
            }
            result = imported
            phase = .completed
            progress = 1
            detail = "Detección finalizada."
        } catch {
            errorMessage = error.localizedDescription
            detail = "No se pudo guardar el resultado."
        }
        running = false
    }
}

struct DiscoveryRadarView: View {
    let active: Bool
    var size: CGFloat = 64
    @State private var pulse = false

    var body: some View {
        ZStack {
            ForEach(0..<3) { index in
                Circle()
                    .stroke(Color.green.opacity(active ? 0.35 : 0.15), lineWidth: 2)
                    .scaleEffect(
                        active && pulse
                            ? 0.45 + CGFloat(index) * 0.28
                            : 0.3 + CGFloat(index) * 0.2
                    )
                    .opacity(active && pulse ? 0.15 + Double(2 - index) * 0.2 : 0.55)
            }
            Circle()
                .fill(Color.green)
                .frame(width: size * 0.18, height: size * 0.18)
                .shadow(color: .green.opacity(0.7), radius: active ? 8 : 2)
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.system(size: size * 0.42))
                .foregroundStyle(.green)
        }
        .frame(width: size, height: size)
        .background(Color.green.opacity(0.06), in: Circle())
        .onAppear {
            withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) {
                pulse = true
            }
        }
    }
}

private extension NetworkDiscoveryView {
    enum Phase: Int, CaseIterable {
        case searching
        case verifying
        case saving
        case completed

        var position: Int { rawValue }
        var title: String {
            switch self {
            case .searching: return "Buscando equipos"
            case .verifying: return "Verificando acceso"
            case .saving: return "Guardando perfiles"
            case .completed: return "Detección completada"
            }
        }
        var shortTitle: String {
            switch self {
            case .searching: return "Buscar"
            case .verifying: return "Verificar"
            case .saving: return "Guardar"
            case .completed: return "Finalizar"
            }
        }
        var symbol: String {
            switch self {
            case .searching: return "dot.radiowaves.left.and.right"
            case .verifying: return "key.horizontal"
            case .saving: return "square.and.arrow.down"
            case .completed: return "checkmark.circle"
            }
        }
    }

    struct DeviceState {
        let stage: String
        let detail: String

        static let found = DeviceState(stage: "found", detail: "Detectado en la red")

        init(stage: String, detail: String) {
            self.stage = stage
            self.detail = detail
        }

        var symbol: String {
            switch stage {
            case "added": return "checkmark.circle.fill"
            case "existing": return "checkmark.seal"
            case "unverified": return "key.slash"
            case "verifying", "identifying": return "ellipsis"
            default: return "server.rack"
            }
        }
        var color: Color {
            switch stage {
            case "added": return .green
            case "existing": return .blue
            case "unverified": return .orange
            case "verifying", "identifying": return .green
            default: return .secondary
            }
        }
        var isWorking: Bool {
            stage == "verifying" || stage == "identifying"
        }
    }
}

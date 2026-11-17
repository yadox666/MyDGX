import SwiftUI

struct DeploymentProgressView: View {
    let status: DeploymentStatus
    let openLog: () -> Void

    private var isRunning: Bool {
        !status.completed && status.error == nil
    }

    private var accent: Color {
        status.error != nil ? .red : .green
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 16) {
                DeploymentTransferAnimation(
                    running: isRunning,
                    succeeded: status.completed,
                    failed: status.error != nil
                )
                .frame(width: 132, height: 68)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(status.phase)
                            .font(.headline)
                        Spacer()
                        Text("\(Int((status.progress * 100).rounded()))%")
                            .font(.title2.bold())
                            .monospacedDigit()
                            .foregroundStyle(accent)
                    }
                    Text(status.detail)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }

            ProgressView(value: status.progress)
                .progressViewStyle(.linear)
                .tint(accent)
                .scaleEffect(x: 1, y: 1.45, anchor: .center)

            deploymentPhases

            if let error = status.error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            } else if status.completed {
                Label(
                    "MyDGX quedó desplegado correctamente.",
                    systemImage: "checkmark.seal.fill"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(.green)
            }

            HStack {
                if isRunning {
                    Label("La operación continúa en segundo plano", systemImage: "clock")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    openLog()
                } label: {
                    Label("Abrir log", systemImage: "doc.text.magnifyingglass")
                }
                .controlSize(.small)
            }
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [accent.opacity(0.12), Color.secondary.opacity(0.04)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(accent.opacity(0.25), lineWidth: 1)
        }
    }

    private var deploymentPhases: some View {
        HStack(spacing: 0) {
            ForEach(DeployPhase.allCases, id: \.self) { phase in
                VStack(spacing: 4) {
                    Image(systemName: phaseComplete(phase) ? "checkmark.circle.fill" : phase.symbol)
                        .foregroundStyle(
                            phaseComplete(phase) || currentPhase == phase ? accent : .secondary
                        )
                    Text(phase.title)
                        .font(.caption2)
                        .foregroundStyle(currentPhase == phase ? .primary : .secondary)
                }
                .frame(maxWidth: .infinity)

                if phase != DeployPhase.allCases.last {
                    Rectangle()
                        .fill(phaseComplete(phase) ? accent : Color.secondary.opacity(0.2))
                        .frame(maxWidth: 42)
                        .frame(height: 2)
                }
            }
        }
    }

    private var currentPhase: DeployPhase {
        if status.completed || status.progress >= 0.98 { return .connect }
        if status.progress >= 0.39 { return .install }
        if status.progress >= 0.06 { return .sync }
        return .prepare
    }

    private func phaseComplete(_ phase: DeployPhase) -> Bool {
        if status.completed { return true }
        return phase.rawValue < currentPhase.rawValue
    }
}

private struct DeploymentTransferAnimation: View {
    let running: Bool
    let succeeded: Bool
    let failed: Bool
    @State private var transfer = false
    @State private var pulse = false

    var body: some View {
        ZStack {
            Capsule()
                .fill(Color.secondary.opacity(0.14))
                .frame(width: 76, height: 4)

            if running {
                Circle()
                    .fill(Color.green)
                    .frame(width: 9, height: 9)
                    .shadow(color: .green.opacity(0.7), radius: 5)
                    .offset(x: transfer ? 34 : -34)
            }

            HStack {
                endpoint("laptopcomputer", color: .blue)
                Spacer()
                endpoint(
                    failed
                        ? "xmark"
                        : (succeeded ? "checkmark" : "server.rack"),
                    color: failed ? .red : .green
                )
            }
        }
        .onAppear { startAnimation() }
        .onChange(of: running) { _ in startAnimation() }
    }

    private func endpoint(_ symbol: String, color: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: 48, height: 48)
            .background(color.opacity(pulse && running ? 0.18 : 0.1), in: Circle())
            .overlay(Circle().stroke(color.opacity(0.3), lineWidth: 1))
    }

    private func startAnimation() {
        guard running else { return }
        transfer = false
        pulse = false
        withAnimation(.linear(duration: 1.25).repeatForever(autoreverses: false)) {
            transfer = true
        }
        withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
            pulse = true
        }
    }
}

private enum DeployPhase: Int, CaseIterable {
    case prepare
    case sync
    case install
    case connect

    var title: String {
        switch self {
        case .prepare: return "Preparar"
        case .sync: return "Copiar"
        case .install: return "Instalar"
        case .connect: return "Conectar"
        }
    }

    var symbol: String {
        switch self {
        case .prepare: return "checklist"
        case .sync: return "arrow.left.arrow.right"
        case .install: return "shippingbox"
        case .connect: return "network"
        }
    }
}

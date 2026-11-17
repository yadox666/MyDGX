import AppKit
import SwiftUI

struct ProfileThumbnail: View {
    let kind: ConnectionKind
    var deviceModel: String?
    var deviceVariant: String?
    var isActive = false
    var size: CGFloat = 30

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                .fill(brand.background)
                .overlay {
                    RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                        .stroke(Color.primary.opacity(0.12), lineWidth: 1)
                }

            brandMark
                .frame(width: size, height: size)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) {
            Image(systemName: kindSymbol)
                .font(.system(size: max(7, size * 0.27), weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size * 0.42, height: size * 0.42)
                .background(isActive ? Color.green : Color.secondary)
                .clipShape(Circle())
                .overlay(Circle().stroke(Color(nsColor: .windowBackgroundColor), lineWidth: 1))
                .offset(x: size * 0.08, y: size * 0.08)
        }
        .accessibilityHidden(true)
    }

    private var kindSymbol: String {
        switch kind {
        case .local: return "desktopcomputer"
        case .lan: return "wifi"
        case .axforge: return "cloud"
        case .remote: return "network"
        }
    }

    @ViewBuilder
    private var brandMark: some View {
        switch brand {
        case .nvidia:
            Image(nsImage: TrayImages.nvidia)
                .resizable()
                .scaledToFit()
                .padding(size * 0.13)
        case .asus:
            wordmark("ASUS", weight: .black, design: .rounded, color: .black)
        case .hp:
            Text("hp")
                .font(.system(size: size * 0.46, weight: .bold, design: .rounded))
                .italic()
                .foregroundStyle(.white)
        case .lenovo:
            wordmark("Lenovo", weight: .bold, design: .default, color: .white)
        case .dell:
            wordmark("DELL", weight: .heavy, design: .default, color: .white)
        case .axforge:
            wordmark("AX", weight: .black, design: .rounded, color: .white)
        case .unknown:
            Image(systemName: "server.rack")
                .resizable()
                .scaledToFit()
                .fontWeight(.medium)
                .foregroundStyle(.secondary)
                .padding(size * 0.18)
        }
    }

    /// Brand name scaled to fill the tile width instead of a fixed point size.
    private func wordmark(_ text: String, weight: Font.Weight, design: Font.Design, color: Color) -> some View {
        Text(text)
            .font(.system(size: size * 0.4, weight: weight, design: design))
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.2)
            .frame(width: size * 0.82)
    }

    private var brand: Brand {
        let description = "\(deviceVariant ?? "") \(deviceModel ?? "")".lowercased()
        if description.contains("asus") || description.contains("gx10") {
            return .asus
        } else if description.contains("lenovo") || description.contains("pgx") {
            return .lenovo
        } else if description.contains("dell") || description.contains("pro max") || description.contains("fcm1253") {
            return .dell
        } else if description.contains("hp") || description.contains("zgx") {
            return .hp
        } else if description.contains("nvidia") || description.contains("dgx spark") {
            return .nvidia
        }
        return kind == .axforge ? .axforge : .unknown
    }

    private enum Brand {
        case nvidia
        case asus
        case hp
        case lenovo
        case dell
        case axforge
        case unknown

        var background: Color {
            switch self {
            case .nvidia, .asus: return Color.white
            case .hp: return Color(red: 0, green: 0.59, blue: 0.84)
            case .lenovo: return Color(red: 0.9, green: 0, blue: 0.07)
            case .dell: return Color(red: 0, green: 0.46, blue: 0.81)
            case .axforge: return Color(red: 0.16, green: 0.18, blue: 0.24)
            case .unknown: return Color(nsColor: .controlBackgroundColor)
            }
        }
    }
}

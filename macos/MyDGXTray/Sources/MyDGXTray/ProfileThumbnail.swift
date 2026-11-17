import AppKit
import SwiftUI

struct ProfileThumbnail: View {
    let kind: ConnectionKind
    var deviceModel: String?
    var deviceVariant: String?
    var isActive = false
    var size: CGFloat = 30

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                .fill(brand.background)
                .overlay {
                    RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                        .stroke(Color.primary.opacity(0.12), lineWidth: 1)
                }

            brandMark

            Image(systemName: kindSymbol)
                .font(.system(size: max(7, size * 0.27), weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size * 0.42, height: size * 0.42)
                .background(isActive ? Color.green : Color.secondary)
                .clipShape(Circle())
                .overlay(Circle().stroke(Color(nsColor: .windowBackgroundColor), lineWidth: 1))
                .offset(x: size * 0.08, y: size * 0.08)
        }
        .frame(width: size, height: size)
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
            Text("ASUS")
                .font(.system(size: size * 0.19, weight: .black, design: .rounded))
                .foregroundStyle(.black)
                .minimumScaleFactor(0.5)
                .padding(size * 0.1)
        case .hp:
            Text("hp")
                .font(.system(size: size * 0.32, weight: .bold, design: .rounded))
                .italic()
                .foregroundStyle(.white)
        case .lenovo:
            Text("Lenovo")
                .font(.system(size: size * 0.16, weight: .bold))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.5)
                .padding(size * 0.08)
        case .unknown:
            Image(systemName: "server.rack")
                .font(.system(size: size * 0.46, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }

    private var brand: Brand {
        let description = "\(deviceVariant ?? "") \(deviceModel ?? "")".lowercased()
        if description.contains("asus") || description.contains("gx10") {
            return .asus
        } else if description.contains("lenovo") || description.contains("pgx") {
            return .lenovo
        } else if description.contains("hp") || description.contains("zgx") {
            return .hp
        } else if description.contains("nvidia") || description.contains("dgx spark") {
            return .nvidia
        }
        return .unknown
    }

    private enum Brand {
        case nvidia
        case asus
        case hp
        case lenovo
        case unknown

        var background: Color {
            switch self {
            case .nvidia, .asus: return Color.white
            case .hp: return Color(red: 0, green: 0.59, blue: 0.84)
            case .lenovo: return Color(red: 0.9, green: 0, blue: 0.07)
            case .unknown: return Color(nsColor: .controlBackgroundColor)
            }
        }
    }
}

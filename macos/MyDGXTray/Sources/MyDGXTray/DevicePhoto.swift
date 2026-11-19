import AppKit
import SwiftUI

struct DevicePhoto: View {
    let detectedModel: String?
    let detectedVariant: String?
    var kind: ConnectionKind?

    var body: some View {
        VStack(spacing: 4) {
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 280, minHeight: 90, maxHeight: 115)

            Text(displayName)
                .font(.headline)

            if detectedModel != nil {
                Label("Equipo detectado", systemImage: "checkmark.seal.fill")
                    .font(.caption)
                    .foregroundStyle(.green)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }

    private var displayName: String {
        detectedModel?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            ?? (kind == .axforge
                ? String(localized: "Instancia AxForge")
                : String(localized: "Modelo pendiente de detectar"))
    }

    private var image: NSImage {
        if kind == .axforge, detectedModel == nil, detectedVariant == nil,
           let cloud = NSImage(systemSymbolName: "cloud", accessibilityDescription: displayName) {
            return cloud
        }
        return Self.image(model: detectedModel, variant: detectedVariant, description: displayName)
    }

    static func image(model: String?, variant: String?, description: String = "DGX Spark") -> NSImage {
        let evidence = "\(variant?.lowercased() ?? "") \(model ?? "")".lowercased()
        let resource: String
        if evidence.contains("asus") || evidence.contains("gx10") {
            resource = "ASUSAscentGX10"
        } else if evidence.contains("lenovo") || evidence.contains("pgx") {
            resource = "LenovoThinkStationPGX"
        } else if evidence.contains("dell") || evidence.contains("pro max") || evidence.contains("fcm1253") {
            resource = "DellProMaxGB10"
        } else if evidence.contains("hp") || evidence.contains("zgx") {
            resource = "HPZGXNano"
        } else if evidence.contains("nvidia") || evidence.contains("dgx spark") {
            resource = "NVIDIADGXSpark"
        } else {
            return NSImage(systemSymbolName: "server.rack", accessibilityDescription: description) ?? NSImage()
        }
        return Bundle.main.url(forResource: resource, withExtension: "png")
            .flatMap(NSImage.init(contentsOf:))
            ?? NSImage(systemSymbolName: "server.rack", accessibilityDescription: description)
            ?? NSImage()
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}

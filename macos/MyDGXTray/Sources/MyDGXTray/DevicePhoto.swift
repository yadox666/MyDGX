import AppKit
import SwiftUI

struct DevicePhoto: View {
    let detectedModel: String?
    let detectedVariant: String?

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
            ?? "Modelo pendiente de detectar"
    }

    private var image: NSImage {
        let variant = detectedVariant?.lowercased() ?? ""
        let description = "\(variant) \(detectedModel ?? "")".lowercased()
        let resource: String
        if description.contains("asus") || description.contains("gx10") {
            resource = "ASUSAscentGX10"
        } else if description.contains("lenovo") || description.contains("pgx") {
            resource = "LenovoThinkStationPGX"
        } else if description.contains("hp") || description.contains("zgx") {
            resource = "HPZGXNano"
        } else if description.contains("nvidia") || description.contains("dgx spark") {
            resource = "NVIDIADGXSpark"
        } else {
            return NSImage(
                systemSymbolName: "server.rack",
                accessibilityDescription: displayName
            ) ?? NSImage()
        }
        return Bundle.main.url(forResource: resource, withExtension: "png")
            .flatMap(NSImage.init(contentsOf:))
            ?? NSImage(
                systemSymbolName: "server.rack",
                accessibilityDescription: displayName
            )
            ?? NSImage()
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}

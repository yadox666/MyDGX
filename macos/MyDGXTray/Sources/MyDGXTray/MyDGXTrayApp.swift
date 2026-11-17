import AppKit
import SwiftUI

@main
struct MyDGXTrayApp: App {
    @StateObject private var model: AppModel

    init() {
        let model = AppModel()
        _model = StateObject(wrappedValue: model)
        let arguments = CommandLine.arguments
        if let flag = arguments.firstIndex(of: "--render-setup-screenshots"),
           arguments.indices.contains(flag + 1) {
            let directory = URL(fileURLWithPath: arguments[flag + 1], isDirectory: true)
            Task { @MainActor in
                await SetupScreenshots.render(model: model, to: directory)
                exit(0)
            }
            return
        }
        AppNotifications.requestAuthorization()
        model.startPolling(
            autoConnect: !CommandLine.arguments.contains("--deploy-active")
        )
        if model.launchedWithoutConfiguration
            || CommandLine.arguments.contains("--setup-assistant") {
            Task { @MainActor in model.openSetupWizard() }
        } else if CommandLine.arguments.contains("--open-preferences")
            || CommandLine.arguments.contains("--deploy-active") {
            Task { @MainActor in
                model.openSettings()
                if CommandLine.arguments.contains("--deploy-active") {
                    model.deployActiveConnection()
                }
            }
        }
    }

    var body: some Scene {
        MenuBarExtra {
            MenuContentView(model: model)
        } label: {
            HStack(spacing: 4) {
                Image(nsImage: TrayImages.nvidia)
                    .resizable()
                    .frame(width: 18, height: 18)
                Text(model.menuBarLabel)
            }
            .accessibilityLabel("NVIDIA MyDGX, \(model.menuBarLabel)")
        }
    }
}

enum TrayImages {
    static let nvidia: NSImage = {
        if let url = Bundle.main.url(forResource: "NVIDIAIcon", withExtension: "png"),
           let image = NSImage(contentsOf: url) {
            image.size = NSSize(width: 18, height: 18)
            return image
        }
        return NSImage(
            systemSymbolName: "cpu",
            accessibilityDescription: "NVIDIA"
        ) ?? NSImage()
    }()
}

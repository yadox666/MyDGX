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
        if arguments.contains("--check-for-updates") || arguments.contains("--install-update") {
            let install = arguments.contains("--install-update")
            Task { @MainActor in
                let updater = AppUpdater.shared
                await updater.check()
                print("versión actual: \(updater.currentVersion)")
                switch updater.state {
                case .available(let release):
                    print("disponible: \(release.version) (\(release.tag))")
                    guard install else { exit(0) }
                    await updater.install(release)
                    if case .failed(let error) = updater.state { print("error: \(error)") }
                    exit(1)
                case .upToDate:
                    print("al día")
                    exit(0)
                case .failed(let error):
                    print("error: \(error)")
                    exit(1)
                default:
                    exit(1)
                }
            }
            return
        }
        AppNotifications.requestAuthorization()
        AppUpdater.shared.startPeriodicChecks()
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
                Image(nsImage: TrayImages.menuBar)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: TrayImages.menuBar.size.width, height: TrayImages.menuBar.size.height)
                Text(model.menuBarLabel)
            }
            .accessibilityLabel("NVIDIA MyDGX, \(model.menuBarLabel)")
        }
    }
}

enum TrayImages {
    static let menuBar: NSImage = {
        if let url = Bundle.main.url(forResource: "DGXTrayIcon", withExtension: "png"),
           let image = NSImage(contentsOf: url),
           image.size.height > 0 {
            let height: CGFloat = 16
            image.size = NSSize(width: (image.size.width / image.size.height * height).rounded(), height: height)
            return image
        }
        return nvidia
    }()

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

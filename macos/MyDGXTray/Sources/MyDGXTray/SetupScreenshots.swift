import AppKit
import SwiftUI

/// Renders the setup assistant with sample data into PNGs for the documentation.
/// Usage: MyDGXTray --render-setup-screenshots <directory>
enum SetupScreenshots {
    static let scenes = ["permission", "find", "connect", "install", "done"]

    @MainActor
    static func render(model: AppModel, to directory: URL) async {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for scene in scenes {
            let wizard = SparkSetupWizard(model: model)
            wizard.loadDemo(scene)
            await snapshot(
                SparkSetupWizardView(wizard: wizard),
                size: NSSize(width: 720, height: 700),
                to: directory.appendingPathComponent("setup-\(scene).png")
            )
        }
        AppUpdater.shared.loadDemoUpdate()
        await snapshot(
            SettingsView(model: model),
            size: NSSize(width: 900, height: 560),
            to: directory.appendingPathComponent("preferences-update.png")
        )
    }

    @MainActor
    private static func snapshot<Content: View>(_ view: Content, size: NSSize, to file: URL) async {
        let hosting = NSHostingView(rootView: view.environment(\.colorScheme, .light))
        hosting.frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(
            contentRect: hosting.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = hosting
        window.setFrameOrigin(NSPoint(x: -10_000, y: -10_000))
        window.orderFrontRegardless()
        try? await Task.sleep(nanoseconds: 700_000_000)
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { return }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        if let data = bitmap.representation(using: .png, properties: [:]) {
            try? data.write(to: file)
        }
        window.orderOut(nil)
    }
}

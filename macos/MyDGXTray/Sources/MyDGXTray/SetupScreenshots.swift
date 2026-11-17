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
            let view = SparkSetupWizardView(wizard: wizard)
                .environment(\.colorScheme, .light)
            let hosting = NSHostingView(rootView: view)
            hosting.frame = NSRect(x: 0, y: 0, width: 720, height: 700)
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
            guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { continue }
            hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
            if let data = bitmap.representation(using: .png, properties: [:]) {
                try? data.write(to: directory.appendingPathComponent("setup-\(scene).png"))
            }
            window.orderOut(nil)
        }
    }
}

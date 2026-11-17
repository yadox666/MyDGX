// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MyDGXTray",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "MyDGXTray", targets: ["MyDGXTray"])
    ],
    targets: [
        .executableTarget(
            name: "MyDGXTray",
            path: "Sources/MyDGXTray"
        )
    ],
    swiftLanguageModes: [.v5]
)

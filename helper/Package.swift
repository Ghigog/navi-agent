// swift-tools-version:5.10
import PackageDescription

/// NAV-90's native helper. Two targets: a library holding every decision (window listing, tree
/// pruning, input synthesis) and a thin executable that reads/writes the stdio protocol and
/// dispatches into it — split so the XCTest target can exercise the real logic directly, without
/// going through a child process and a pipe.
let package = Package(
  name: "navi-helper",
  platforms: [.macOS(.v12)],
  targets: [
    .target(name: "NaviHelperCore"),
    .executableTarget(name: "navi-helper", dependencies: ["NaviHelperCore"]),
    .testTarget(name: "NaviHelperCoreTests", dependencies: ["NaviHelperCore"]),
  ]
)

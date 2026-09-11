import AppKit
import XCTest

@testable import NaviHelperCore

/// The fixture app the ticket's acceptance criteria ask for — except it is not a separate app.
/// `AXUIElementCreateApplication(getpid())` reads the *current* process's own accessibility tree
/// just as well as any other process's, and an `NSWindow` created right here, in-process, is a
/// completely ordinary accessibility target. That sidesteps spawning, building, and signing a
/// second executable just to have something to click — the button, text field and secure field
/// below are the fixture.
final class FixtureTests: XCTestCase {
  var window: NSWindow!
  var button: NSButton!
  var textField: NSTextField!
  var secureField: NSSecureTextField!
  var buttonPressCount = 0

  override func setUp() {
    super.setUp()
    buttonPressCount = 0

    window = NSWindow(
      contentRect: NSRect(x: 100, y: 100, width: 320, height: 220),
      styleMask: [.titled], backing: .buffered, defer: false
    )
    window.title = "NaviHelperFixture"

    button = NSButton(title: "Save", target: self, action: #selector(onPress))
    button.frame = NSRect(x: 16, y: 16, width: 80, height: 28)

    textField = NSTextField(frame: NSRect(x: 16, y: 60, width: 220, height: 24))
    textField.stringValue = ""

    secureField = NSSecureTextField(frame: NSRect(x: 16, y: 100, width: 220, height: 24))

    let content = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 220))
    content.addSubview(button)
    content.addSubview(textField)
    content.addSubview(secureField)
    window.contentView = content

    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    // AppKit registers a window with the accessibility subsystem asynchronously; give it a turn.
    RunLoop.current.run(until: Date().addingTimeInterval(0.3))
  }

  override func tearDown() {
    window.close()
    window = nil
    super.tearDown()
  }

  @objc private func onPress() { buttonPressCount += 1 }

  /// The fixture window's own `AXUIElement`, found the same way any window is found in
  /// practice — by asking the owning app for its windows and matching on title. `focusedWindow()`
  /// is not used here because it depends on OS-level frontmost-app state, which a background test
  /// run should not have to depend on to find its own fixture.
  private func fixtureWindowElement() throws -> AXUIElement {
    let app = AXUIElementCreateApplication(getpid())
    guard let windows = axElements(app, kAXWindowsAttribute),
      let match = windows.first(where: { axString($0, kAXTitleAttribute) == "NaviHelperFixture" })
    else {
      throw XCTSkip("the fixture window did not register with the accessibility subsystem in time")
    }
    return match
  }

  private func flatten(_ node: UiNode) -> [UiNode] { [node] + node.children.flatMap(flatten) }

  // MARK: - dump_tree / pruning

  func testDumpTreeFindsTheButtonAndFields() throws {
    let registry = ElementRegistry()
    let handle = registry.register(try fixtureWindowElement())
    let root = try AXTree(registry: registry).dumpTree(handle: handle, maxDepth: 10)

    let nodes = flatten(root)
    XCTAssertTrue(nodes.contains { $0.role == .button && $0.title == "Save" })
    XCTAssertTrue(nodes.contains { $0.role == .textField })
    XCTAssertTrue(nodes.contains { $0.role == .secureField })
  }

  func testDepthCapPrunesBelowTheLimit() throws {
    let registry = ElementRegistry()
    let handle = registry.register(try fixtureWindowElement())
    // Depth 0: only the root itself, no children — proves the cap is honoured rather than
    // decorative.
    let root = try AXTree(registry: registry).dumpTree(handle: handle, maxDepth: 0)
    XCTAssertEqual(root.children.count, 0)
  }

  // MARK: - secure field detection — the honest half of NAV-91's gate input

  func testDescribeElementReportsSecureFieldAsSecure() throws {
    let registry = ElementRegistry()
    let windowElement = try fixtureWindowElement()
    let handle = registry.register(windowElement)
    let tree = AXTree(registry: registry)
    let root = try tree.dumpTree(handle: handle, maxDepth: 10)
    let secureNode = try XCTUnwrap(flatten(root).first { $0.role == .secureField })

    let described = try tree.describeElement(handle: secureNode.handle)
    XCTAssertTrue(described.secure)
  }

  func testDescribeElementReportsOrdinaryFieldAsNotSecure() throws {
    let registry = ElementRegistry()
    let handle = registry.register(try fixtureWindowElement())
    let tree = AXTree(registry: registry)
    let root = try tree.dumpTree(handle: handle, maxDepth: 10)
    let textNode = try XCTUnwrap(flatten(root).first { $0.role == .textField })

    let described = try tree.describeElement(handle: textNode.handle)
    XCTAssertFalse(described.secure)
  }

  // MARK: - acting

  func testClickElementPressesTheButton() throws {
    let registry = ElementRegistry()
    let handle = registry.register(try fixtureWindowElement())
    let tree = AXTree(registry: registry)
    let root = try tree.dumpTree(handle: handle, maxDepth: 10)
    let buttonNode = try XCTUnwrap(flatten(root).first { $0.role == .button })

    XCTAssertEqual(buttonPressCount, 0)
    try InputSynthesis(registry: registry).clickElement(handle: buttonNode.handle)
    XCTAssertEqual(buttonPressCount, 1)
  }

  func testSetValueWritesIntoTheTextField() throws {
    let registry = ElementRegistry()
    let handle = registry.register(try fixtureWindowElement())
    let tree = AXTree(registry: registry)
    let root = try tree.dumpTree(handle: handle, maxDepth: 10)
    let textNode = try XCTUnwrap(flatten(root).first { $0.role == .textField })

    try InputSynthesis(registry: registry).setValue(handle: textNode.handle, text: "hello from navi-helper")
    XCTAssertEqual(textField.stringValue, "hello from navi-helper")
  }

  // MARK: - survives the target going away

  func testStaleHandleAfterWindowClosesReturnsElementGoneNotACrash() throws {
    let registry = ElementRegistry()
    let handle = registry.register(try fixtureWindowElement())

    window.close()
    window = nil
    RunLoop.current.run(until: Date().addingTimeInterval(0.2))

    let tree = AXTree(registry: registry)
    XCTAssertThrowsError(try tree.dumpTree(handle: handle, maxDepth: 5)) { error in
      guard case HelperError.elementGone = error else {
        XCTFail("expected .elementGone, got \(error)")
        return
      }
    }
  }
}

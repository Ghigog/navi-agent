import ApplicationServices
import AppKit
import Foundation

/// Low-level `AXUIElement` plumbing shared by `WindowList`, `AXTree` and `InputSynthesis`. Every
/// other file in this target reads and writes accessibility attributes through here rather than
/// calling the C API directly, so there is exactly one place that knows what an `AXError` means.

public enum HelperError: Error {
  /// The handle does not resolve — the element (or the app it was in) is gone. Reached when a
  /// target application quits mid-operation; callers must get this back, not a crash.
  case elementGone
  case windowGone
  case invalidParams(String)
  case unknownOp(String)
  /// The helper itself is not accessibility-trusted. Distinct from `elementGone` because the fix
  /// is "grant Accessibility to navi-helper", not "try a different handle".
  case notTrusted
  case actionFailed(String)

  var code: String {
    switch self {
    case .elementGone: return "element_gone"
    case .windowGone: return "window_gone"
    case .invalidParams: return "invalid_params"
    case .unknownOp: return "unknown_op"
    case .notTrusted: return "ax_denied"
    case .actionFailed: return "action_failed"
    }
  }

  var message: String {
    switch self {
    case .elementGone: return "The element no longer exists — its window or application likely closed."
    case .windowGone: return "The window no longer exists."
    case .invalidParams(let detail): return "Invalid parameters: \(detail)"
    case .unknownOp(let op): return "No operation named \"\(op)\"."
    case .notTrusted: return "navi-helper is not trusted for Accessibility. Grant it in System Settings › Privacy & Security › Accessibility."
    case .actionFailed(let detail): return "The action failed: \(detail)"
    }
  }
}

/// Assigns opaque string handles to `AXUIElement`s.
///
/// Bounded rather than cleared-per-call: clearing on every `dump_tree` would invalidate a handle
/// from an *earlier* observation the moment the model looks at anything else, which is a stranger
/// failure mode than a handle that just ages out. Bounded and FIFO-evicted instead, the same
/// shape as `policy.ts`'s audit log — the record of what was *just* seen is the one that survives.
public final class ElementRegistry {
  private var handles: [String: AXUIElement] = [:]
  private var order: [String] = []
  private var counter = 0
  private let cap: Int

  public init(cap: Int = 4000) { self.cap = cap }

  public func register(_ element: AXUIElement) -> String {
    counter += 1
    let handle = "el_\(counter)"
    handles[handle] = element
    order.append(handle)
    if order.count > cap, let oldest = order.first {
      order.removeFirst()
      handles.removeValue(forKey: oldest)
    }
    return handle
  }

  public func resolve(_ handle: String) -> AXUIElement? { handles[handle] }
}

/// The one system-wide element, used for hit-testing (`app_at_point`) and for the currently
/// focused element regardless of which app or window it is in (`focused_element_secure`).
let systemWideElement: AXUIElement = AXUIElementCreateSystemWide()

func isProcessTrusted() -> Bool {
  AXIsProcessTrustedWithOptions(nil)
}

/// A registry lookup finding an entry says nothing about whether the element still exists — the
/// dictionary just holds a reference, and the app on the other end of it may have quit since.
/// `AXError.invalidUIElement` is the specific, documented signal for "this element is gone"; a
/// live element always answers a role query even if every other attribute is unsupported, so
/// anything else reaching this check is treated as alive.
func elementIsAlive(_ element: AXUIElement) -> Bool {
  var value: AnyObject?
  let err = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &value)
  return err != .invalidUIElement
}

// MARK: - Attribute reads

func axCopy(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
  var value: AnyObject?
  let err = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
  return err == .success ? value : nil
}

func axString(_ element: AXUIElement, _ attribute: String) -> String? {
  axCopy(element, attribute) as? String
}

func axBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
  (axCopy(element, attribute) as? NSNumber)?.boolValue
}

func axElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
  guard let v = axCopy(element, attribute) else { return nil }
  guard CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
  return (v as! AXUIElement)
}

func axElements(_ element: AXUIElement, _ attribute: String) -> [AXUIElement]? {
  axCopy(element, attribute) as? [AXUIElement]
}

func axFrame(_ element: AXUIElement) -> Frame {
  var origin = CGPoint.zero
  var size = CGSize.zero
  if let posValue = axCopy(element, kAXPositionAttribute), CFGetTypeID(posValue) == AXValueGetTypeID() {
    AXValueGetValue((posValue as! AXValue), .cgPoint, &origin)
  }
  if let sizeValue = axCopy(element, kAXSizeAttribute), CFGetTypeID(sizeValue) == AXValueGetTypeID() {
    AXValueGetValue((sizeValue as! AXValue), .cgSize, &size)
  }
  return Frame(x: origin.x, y: origin.y, width: size.width, height: size.height)
}

func pidOf(_ element: AXUIElement) -> pid_t? {
  var pid: pid_t = 0
  let err = AXUIElementGetPid(element, &pid)
  return err == .success ? pid : nil
}

func appInfo(forPid pid: pid_t) -> AppInfo? {
  guard let running = NSRunningApplication(processIdentifier: pid) else { return nil }
  let bundleId = running.bundleIdentifier ?? "pid:\(pid)"
  let name = running.localizedName ?? bundleId
  return AppInfo(bundleId: bundleId, name: name)
}

func appInfo(for element: AXUIElement) -> AppInfo? {
  guard let pid = pidOf(element) else { return nil }
  return appInfo(forPid: pid)
}

/// The frontmost app's focused (falling back to main) window, as a raw element. Shared by
/// `WindowList.focusedWindow()` (which summarises it) and `AXTree.dumpTree(handle: nil, …)`
/// (which walks it) so there is one definition of "the window `observe_ui` means" rather than two
/// that can drift apart.
func focusedWindowAXElement() throws -> AXUIElement {
  guard let running = NSWorkspace.shared.frontmostApplication else { throw HelperError.windowGone }
  let appElement = AXUIElementCreateApplication(running.processIdentifier)
  guard let window = axElement(appElement, kAXFocusedWindowAttribute) ?? axElement(appElement, kAXMainWindowAttribute) else {
    throw HelperError.windowGone
  }
  return window
}

/// Maps an `AXRole`/`AXSubrole` pair into the protocol's neutral role. The only place that knows
/// what an `AXRole` string looks like — see the doc comment on `UiRole` in `Protocol.swift`.
func neutralRole(role: String?, subrole: String?) -> UiRole {
  if subrole == "AXSecureTextField" { return .secureField }
  // Raw role strings throughout rather than the `kAX*Role` constants: several roles used here
  // (links, scroll areas, tables) have no predefined Swift constant in ApplicationServices, and
  // mixing "some constants, some strings" is a worse trap than just being consistent.
  switch role {
  case "AXButton": return .button
  case "AXLink": return .link
  case "AXCheckBox": return .checkbox
  case "AXRadioButton": return .radio
  case "AXMenu", "AXMenuBar", "AXMenuBarItem": return .menu
  case "AXMenuItem": return .menuItem
  case "AXTabGroup": return .tab
  case "AXStaticText": return .text
  case "AXTextField": return .textField
  case "AXTextArea": return .textField
  case "AXImage": return .image
  case "AXList", "AXOutline", "AXTable": return .list
  case "AXRow": return .row
  case "AXGroup": return .group
  case "AXWindow": return .window
  case "AXScrollArea": return .scrollArea
  case "AXSlider": return .slider
  default: return .other
  }
}

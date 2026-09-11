import ApplicationServices
import Foundation

/// Reading the accessibility tree, pruned to what a prompt can afford.
///
/// A full `AXUIElement` tree for a real application is thousands of nodes — menu bars, toolbars,
/// every layout group AppKit inserted — and almost none of it is something a model should ever
/// act on. `buildNode` keeps only elements with a role worth acting on or reading (see
/// `isInteresting`) and, for everything else, hoists their interesting descendants up a level
/// instead of emitting an empty wrapper — a `AXGroup` around a single button becomes just the
/// button, not a group containing a button.
public final class AXTree {
  private let registry: ElementRegistry
  /// A hard ceiling independent of whatever a caller asks for. Recursing an unbounded tree is
  /// how a single `dump_tree` call turns into a multi-second, multi-megabyte response; this
  /// keeps the worst case bounded even if a caller passes something silly.
  private static let hardDepthCap = 40

  public init(registry: ElementRegistry) { self.registry = registry }

  private func isInteresting(_ role: UiRole) -> Bool {
    switch role {
    case .other, .group, .scrollArea, .window: return false
    default: return true
    }
  }

  private func buildNode(_ element: AXUIElement, depth: Int, maxDepth: Int) -> UiNode? {
    guard depth <= maxDepth else { return nil }

    let role = neutralRole(role: axString(element, kAXRoleAttribute), subrole: axString(element, kAXSubroleAttribute))
    let title = axString(element, kAXTitleAttribute) ?? axString(element, kAXDescriptionAttribute)
    let value = axString(element, kAXValueAttribute)
    let secure = role == .secureField
    let enabled = axBool(element, kAXEnabledAttribute) ?? true
    let focused = axBool(element, kAXFocusedAttribute) ?? false
    let frame = axFrame(element)

    let children = buildChildren(of: element, depth: depth + 1, maxDepth: maxDepth)

    let hasText = !(title?.isEmpty ?? true) || !(value?.isEmpty ?? true)
    guard isInteresting(role) || secure || hasText else {
      return nil
    }

    let handle = registry.register(element)
    return UiNode(
      handle: handle, role: role, title: title, value: value, frame: frame,
      enabled: enabled, focused: focused, secure: secure, children: children
    )
  }

  /// Not-interesting containers are not emitted — their interesting descendants are hoisted to
  /// this level instead, which is what keeps a tree of nested `AXGroup`s from costing a node each.
  private func buildChildren(of element: AXUIElement, depth: Int, maxDepth: Int) -> [UiNode] {
    guard depth <= maxDepth else { return [] }
    guard let kids = axElements(element, kAXChildrenAttribute) else { return [] }
    var out: [UiNode] = []
    for child in kids {
      let role = neutralRole(role: axString(child, kAXRoleAttribute), subrole: axString(child, kAXSubroleAttribute))
      let title = axString(child, kAXTitleAttribute)
      let value = axString(child, kAXValueAttribute)
      let hasText = !(title?.isEmpty ?? true) || !(value?.isEmpty ?? true)
      if isInteresting(role) || role == .secureField || hasText {
        if let node = buildNode(child, depth: depth, maxDepth: maxDepth) {
          out.append(node)
        }
      } else {
        out.append(contentsOf: buildChildren(of: child, depth: depth + 1, maxDepth: maxDepth))
      }
    }
    return out
  }

  public func dumpTree(handle: String?, maxDepth: Int) throws -> UiNode {
    let cap = min(max(maxDepth, 1), Self.hardDepthCap)
    let root: AXUIElement
    if let handle {
      guard let element = registry.resolve(handle) else { throw HelperError.elementGone }
      guard elementIsAlive(element) else { throw HelperError.elementGone }
      root = element
    } else {
      root = try focusedWindowAXElement()
    }
    // The root itself is always emitted regardless of `isInteresting` — a caller asking to see a
    // window wants the window, not "nothing" because `AXWindow` is a container role.
    let role = neutralRole(role: axString(root, kAXRoleAttribute), subrole: axString(root, kAXSubroleAttribute))
    let title = axString(root, kAXTitleAttribute)
    let handleOut = registry.register(root)
    return UiNode(
      handle: handleOut, role: role == .other ? .window : role, title: title, value: nil,
      frame: axFrame(root), enabled: axBool(root, kAXEnabledAttribute) ?? true,
      focused: axBool(root, kAXFocusedAttribute) ?? false, secure: false,
      children: buildChildren(of: root, depth: 1, maxDepth: cap)
    )
  }

  /// The honest half of NAV-91's gate input for an element-addressed action: fetched fresh at
  /// act time, never trusted from a stale `dump_tree` response or from the caller.
  public func describeElement(handle: String) throws -> (app: AppInfo?, secure: Bool, role: UiRole, title: String?, enabled: Bool) {
    guard let element = registry.resolve(handle) else { throw HelperError.elementGone }
    guard elementIsAlive(element) else { throw HelperError.elementGone }
    let role = neutralRole(role: axString(element, kAXRoleAttribute), subrole: axString(element, kAXSubroleAttribute))
    return (
      app: appInfo(for: element),
      secure: role == .secureField,
      role: role,
      title: axString(element, kAXTitleAttribute),
      enabled: axBool(element, kAXEnabledAttribute) ?? true
    )
  }

  /// Whatever currently has keyboard focus, system-wide — regardless of whether focus landed
  /// there via `click_element` or a raw `click_point`. This is what makes "typing into a password
  /// field is refused" true for the coordinate-click path too, which has no element handle of its
  /// own to check.
  public func focusedElementSecure() -> (secure: Bool, app: AppInfo?) {
    guard let focused = axElement(systemWideElement, kAXFocusedUIElementAttribute) else {
      return (false, nil)
    }
    let role = neutralRole(role: axString(focused, kAXRoleAttribute), subrole: axString(focused, kAXSubroleAttribute))
    return (role == .secureField, appInfo(for: focused))
  }
}

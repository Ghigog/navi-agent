import ApplicationServices
import AppKit
import Foundation

/// Window enumeration and focus, and the two "which app is this?" queries that
/// `Action.app` (`shared/policy.ts`) is built from on the TypeScript side: `appAtPoint` for a
/// coordinate-addressed action, `frontmostApp` for one with no target at all.
public final class WindowList {
  private let registry: ElementRegistry

  public init(registry: ElementRegistry) { self.registry = registry }

  /// The AX window belonging to `pid` whose frame is nearest `bounds`.
  ///
  /// There is no public API mapping a `CGWindowID` directly to an `AXUIElement` — this is the
  /// standard workaround. Ambiguous only when an app has two windows of identical size stacked
  /// exactly on top of each other, which is not a case worth the complexity of a better match.
  private func nearestAXWindow(pid: pid_t, bounds: CGRect) -> AXUIElement? {
    let appElement = AXUIElementCreateApplication(pid)
    guard let windows = axElements(appElement, kAXWindowsAttribute) else { return nil }
    return windows.min { a, b in
      distance(axFrame(a), bounds) < distance(axFrame(b), bounds)
    }
  }

  private func distance(_ frame: Frame, _ bounds: CGRect) -> Double {
    abs(frame.x - bounds.origin.x) + abs(frame.y - bounds.origin.y)
      + abs(frame.width - bounds.width) + abs(frame.height - bounds.height)
  }

  public func listWindows() -> [WindowInfo] {
    guard
      let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: AnyObject]]
    else { return [] }

    let frontmostPid = NSWorkspace.shared.frontmostApplication?.processIdentifier

    var out: [WindowInfo] = []
    for entry in raw {
      // Layer 0 is normal application windows; anything else is a status item, a tooltip, a
      // desktop icon layer, and not something a model should be offered as a target.
      guard (entry[kCGWindowLayer as String] as? Int) == 0 else { continue }
      guard let pid = entry[kCGWindowOwnerPID as String] as? Int32 else { continue }
      guard let boundsDict = entry[kCGWindowBounds as String] as? [String: CGFloat],
        let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
      else { continue }
      // A window with no size is not something a click or a read is ever aimed at.
      guard bounds.width > 0, bounds.height > 0 else { continue }
      guard let app = appInfo(forPid: pid) else { continue }

      let title = (entry[kCGWindowName as String] as? String) ?? ""
      guard let axWindow = nearestAXWindow(pid: pid, bounds: bounds) else { continue }
      let handle = registry.register(axWindow)

      out.append(
        WindowInfo(
          id: handle,
          app: app,
          title: title,
          frame: Frame(x: bounds.origin.x, y: bounds.origin.y, width: bounds.width, height: bounds.height),
          focused: pid == frontmostPid
        )
      )
    }
    return out
  }

  /// The frontmost app's focused window — what `observe_ui` asks for when it wants "the window
  /// the user is looking at" without the model having to enumerate and choose one.
  public func focusedWindow() throws -> WindowInfo {
    let windowElement = try focusedWindowAXElement()
    guard let pid = pidOf(windowElement), let app = appInfo(forPid: pid) else {
      throw HelperError.windowGone
    }
    let handle = registry.register(windowElement)
    let title = axString(windowElement, kAXTitleAttribute) ?? ""
    return WindowInfo(id: handle, app: app, title: title, frame: axFrame(windowElement), focused: true)
  }

  /// Activates the window's app and raises that specific window.
  ///
  /// Best-effort past the app activation: `AXRaise` on a window some apps refuse (a handful of
  /// non-standard toolkits do not implement it) still leaves the *app* frontmost, which is the
  /// part users actually asked for when they said "focus my browser".
  public func focusWindow(handle: String) throws {
    guard let element = registry.resolve(handle) else { throw HelperError.windowGone }
    guard elementIsAlive(element) else { throw HelperError.windowGone }
    guard let pid = pidOf(element), let running = NSRunningApplication(processIdentifier: pid) else {
      throw HelperError.windowGone
    }
    if #available(macOS 14.0, *) {
      running.activate()
    } else {
      running.activate(options: [.activateIgnoringOtherApps])
    }
    AXUIElementSetAttributeValue(element, kAXMainAttribute as CFString, kCFBooleanTrue)
    AXUIElementPerformAction(element, kAXRaiseAction as CFString)
  }

  public func appAtPoint(x: Double, y: Double) -> AppInfo? {
    var element: AXUIElement?
    let err = AXUIElementCopyElementAtPosition(systemWideElement, Float(x), Float(y), &element)
    guard err == .success, let element, let pid = pidOf(element) else { return nil }
    return appInfo(forPid: pid)
  }

  public func frontmostApp() -> AppInfo? {
    guard let running = NSWorkspace.shared.frontmostApplication else { return nil }
    return AppInfo(bundleId: running.bundleIdentifier ?? "pid:\(running.processIdentifier)", name: running.localizedName ?? "")
  }
}

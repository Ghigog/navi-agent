import ApplicationServices
import AppKit
import CoreGraphics
import Foundation

/// Actuation. Two families:
///
///  - `clickElement`/`setValue` act on an `AXUIElement` directly — `AXPress`, value-setting —
///    which is precise and survives scrolling/resizing because it never touches a coordinate.
///  - `clickPoint`/`typeText`/`key`/`scroll` synthesize real `CGEvent`s, for the canvas-drawn UIs
///    the accessibility tree does not describe at all (the ticket's own fallback case).
///
/// Stateless, same as the rest of this target: every call is fully described by its arguments,
/// nothing here remembers what the previous call did.
public final class InputSynthesis {
  private let registry: ElementRegistry

  public init(registry: ElementRegistry) { self.registry = registry }

  public func clickElement(handle: String) throws {
    guard let element = registry.resolve(handle) else { throw HelperError.elementGone }
    guard elementIsAlive(element) else { throw HelperError.elementGone }
    let err = AXUIElementPerformAction(element, kAXPressAction as CFString)
    guard err == .success else { throw HelperError.actionFailed("AXPress returned \(err.rawValue)") }
  }

  public func setValue(handle: String, text: String) throws {
    guard let element = registry.resolve(handle) else { throw HelperError.elementGone }
    guard elementIsAlive(element) else { throw HelperError.elementGone }
    let err = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef)
    guard err == .success else { throw HelperError.actionFailed("setting the value returned \(err.rawValue)") }
  }

  public func clickPoint(x: Double, y: Double) throws {
    let point = CGPoint(x: x, y: y)
    guard
      let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
      let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
    else { throw HelperError.actionFailed("could not create a mouse event") }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
  }

  public func scroll(dx: Double, dy: Double) throws {
    guard
      let event = CGEvent(
        scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
        wheel1: Int32(dy.rounded()), wheel2: Int32(dx.rounded()), wheel3: 0
      )
    else { throw HelperError.actionFailed("could not create a scroll event") }
    event.post(tap: .cghidEventTap)
  }

  /// Types real text by handing whole characters to the OS rather than mapping each one to a
  /// virtual keycode — the keycode table is US-QWERTY-shaped and would silently mangle anything
  /// outside it (accents, CJK, emoji). `CGEventKeyboardSetUnicodeString` types exactly what was
  /// asked for regardless of keyboard layout.
  public func typeText(_ text: String) throws {
    for scalar in text.unicodeScalars {
      guard
        let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
      else { throw HelperError.actionFailed("could not create a keyboard event") }
      let utf16 = Array(String(scalar).utf16)
      down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
      up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
      down.post(tap: .cghidEventTap)
      up.post(tap: .cghidEventTap)
    }
  }

  /// Parses `"cmd+shift+a"`-style combos. Modifiers before the last `+`-separated token; the
  /// last token is the key, looked up in `KeyCodes.named` first (so `"return"`, `"escape"`,
  /// `"tab"` work) and falling back to the first character of a single-character token.
  public func key(_ combo: String) throws {
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    guard let keyName = parts.last else { throw HelperError.invalidParams("empty key combo") }
    let modifierNames = parts.dropLast()

    var flags: CGEventFlags = []
    for name in modifierNames {
      switch name {
      case "cmd", "command": flags.insert(.maskCommand)
      case "shift": flags.insert(.maskShift)
      case "alt", "option": flags.insert(.maskAlternate)
      case "ctrl", "control": flags.insert(.maskControl)
      default: throw HelperError.invalidParams("unknown modifier \"\(name)\" in \"\(combo)\"")
      }
    }

    guard let keyCode = KeyCodes.named[keyName] ?? KeyCodes.forCharacter(keyName) else {
      throw HelperError.invalidParams("unknown key \"\(keyName)\" in \"\(combo)\"")
    }

    guard
      let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
      let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
    else { throw HelperError.actionFailed("could not create a keyboard event") }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
  }
}

/// US-QWERTY virtual keycodes for the keys a `key()` combo can name. The letter/digit rows are
/// mechanical layout positions on real keyboards (true regardless of input source for a physical
/// shortcut like ⌘A), which is the right table for `key()` — as opposed to `typeText`, which
/// must not go through keycodes at all; see its doc comment.
enum KeyCodes {
  static let named: [String: CGKeyCode] = [
    "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51,
    "escape": 53, "esc": 53, "left": 123, "right": 124, "down": 125, "up": 126,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
  ]

  private static let characters: [Character: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29,
    "-": 27, "=": 24, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35,
    "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47,
  ]

  static func forCharacter(_ name: String) -> CGKeyCode? {
    guard name.count == 1, let ch = name.first else { return nil }
    return characters[ch]
  }
}

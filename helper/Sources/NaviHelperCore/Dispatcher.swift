import Foundation

/// Routes a decoded `Request` to the right piece of logic and encodes its result. The only file
/// that knows the op names on the wire — `main.swift` just feeds it lines, and the test target
/// calls `handle(_:)` directly, skipping the stdio round-trip entirely.
public final class Dispatcher {
  private let registry = ElementRegistry()
  private lazy var windows = WindowList(registry: registry)
  private lazy var tree = AXTree(registry: registry)
  private lazy var input = InputSynthesis(registry: registry)

  public init() {}

  public func handle(_ request: Request) -> Response {
    do {
      return try route(request)
    } catch let error as HelperError {
      return .failure(request.id, code: error.code, message: error.message)
    } catch {
      return .failure(request.id, code: "internal_error", message: "\(error)")
    }
  }

  private func route(_ request: Request) throws -> Response {
    switch request.op {
    case "status":
      return .success(request.id, .object(["trusted": .bool(isProcessTrusted())]))

    case "list_windows":
      return .success(request.id, .object(["windows": toJSONValue(windows.listWindows())]))

    case "focused_window":
      return .success(request.id, .object(["window": toJSONValue(try windows.focusedWindow())]))

    case "focus_window":
      try windows.focusWindow(handle: try requireString(request.params, "id"))
      return .success(request.id, .object(["ok": true]))

    case "dump_tree":
      let handle = request.params?["windowId"]?.stringValue
      let maxDepth = Int(request.params?["maxDepth"]?.doubleValue ?? 12)
      let node = try tree.dumpTree(handle: handle, maxDepth: maxDepth)
      return .success(request.id, .object(["root": toJSONValue(node)]))

    case "describe_element":
      let d = try tree.describeElement(handle: try requireString(request.params, "handle"))
      return .success(
        request.id,
        .object([
          "app": d.app.map(toJSONValue) ?? .null,
          "secure": .bool(d.secure),
          "role": .string(d.role.rawValue),
          "title": d.title.map(JSONValue.string) ?? .null,
          "enabled": .bool(d.enabled),
        ])
      )

    case "focused_element_secure":
      let f = tree.focusedElementSecure()
      return .success(request.id, .object(["secure": .bool(f.secure), "app": f.app.map(toJSONValue) ?? .null]))

    case "click_element":
      try input.clickElement(handle: try requireString(request.params, "handle"))
      return .success(request.id, .object(["ok": true]))

    case "set_value":
      try input.setValue(handle: try requireString(request.params, "handle"), text: try requireString(request.params, "text"))
      return .success(request.id, .object(["ok": true]))

    case "click_point":
      try input.clickPoint(x: try requireDouble(request.params, "x"), y: try requireDouble(request.params, "y"))
      return .success(request.id, .object(["ok": true]))

    case "type_text":
      try input.typeText(try requireString(request.params, "text"))
      return .success(request.id, .object(["ok": true]))

    case "key":
      try input.key(try requireString(request.params, "combo"))
      return .success(request.id, .object(["ok": true]))

    case "scroll":
      try input.scroll(dx: try requireDouble(request.params, "dx"), dy: try requireDouble(request.params, "dy"))
      return .success(request.id, .object(["ok": true]))

    case "app_at_point":
      let app = windows.appAtPoint(x: try requireDouble(request.params, "x"), y: try requireDouble(request.params, "y"))
      return .success(request.id, .object(["app": app.map(toJSONValue) ?? .null]))

    case "frontmost_app":
      return .success(request.id, .object(["app": windows.frontmostApp().map(toJSONValue) ?? .null]))

    default:
      throw HelperError.unknownOp(request.op)
    }
  }
}

private func requireString(_ params: JSONValue?, _ key: String) throws -> String {
  guard let value = params?[key]?.stringValue else { throw HelperError.invalidParams("\"\(key)\" must be a string") }
  return value
}

private func requireDouble(_ params: JSONValue?, _ key: String) throws -> Double {
  guard let value = params?[key]?.doubleValue else { throw HelperError.invalidParams("\"\(key)\" must be a number") }
  return value
}

/// Round-trips any `Encodable` through `JSONValue` so `Response.result` never needs a
/// hand-written encoder per domain type — `UiNode`'s recursive `children` in particular would be
/// tedious and error-prone to encode by hand.
func toJSONValue<T: Encodable>(_ value: T) -> JSONValue {
  guard let data = try? JSONEncoder().encode(value), let decoded = try? JSONDecoder().decode(JSONValue.self, from: data) else {
    return .null
  }
  return decoded
}

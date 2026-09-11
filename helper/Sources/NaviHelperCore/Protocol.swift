import Foundation

/// The wire protocol (NAV-90).
///
/// Newline-delimited JSON over the helper's own stdin/stdout — no socket, so there is nothing
/// for a stray local process to connect to and nothing to authenticate. One request per line in,
/// one response per line out, correlated by `id`.
///
/// Every shape here is platform-neutral on purpose: `UiRole` is a small closed set the Swift side
/// maps `AXUIElement` roles into, never a raw `AXRole` string, so a Windows (UI Automation) or
/// Linux (AT-SPI) implementation later can speak the same protocol without this file changing.
/// Getting this wrong now means rewriting every call site later — see the ticket.

// MARK: - A generic JSON value, for request params and result payloads

/// Request `params` and response `result` are shaped differently per `op`, and hand-writing a
/// `Decodable` struct per op for a protocol this small is more ceremony than it is worth. This
/// carries any JSON value through untyped; each handler pulls the fields it expects out of it.
public indirect enum JSONValue: Codable, Equatable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null

  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let v = try? c.decode(String.self) { self = .string(v); return }
    if let v = try? c.decode(Double.self) { self = .number(v); return }
    if let v = try? c.decode(Bool.self) { self = .bool(v); return }
    if let v = try? c.decode([String: JSONValue].self) { self = .object(v); return }
    if let v = try? c.decode([JSONValue].self) { self = .array(v); return }
    if c.decodeNil() { self = .null; return }
    throw DecodingError.dataCorruptedError(in: c, debugDescription: "unrecognised JSON value")
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .object(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .null: try c.encodeNil()
    }
  }

  public var stringValue: String? { if case .string(let v) = self { return v }; return nil }
  public var doubleValue: Double? { if case .number(let v) = self { return v }; return nil }
  public var boolValue: Bool? { if case .bool(let v) = self { return v }; return nil }
  public var objectValue: [String: JSONValue]? { if case .object(let v) = self { return v }; return nil }
  public var arrayValue: [JSONValue]? { if case .array(let v) = self { return v }; return nil }

  public subscript(key: String) -> JSONValue? { objectValue?[key] }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
  ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral
{
  public init(stringLiteral value: String) { self = .string(value) }
  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
  public init(dictionaryLiteral elements: (String, JSONValue)...) { self = .object(Dictionary(uniqueKeysWithValues: elements)) }
}

extension JSONValue {
  /// Builds an object payload from typed pieces without every call site writing `.object([...])`.
  public static func object(_ pairs: [String: JSONValue?]) -> JSONValue {
    var out: [String: JSONValue] = [:]
    for (k, v) in pairs { out[k] = v ?? .null }
    return .object(out)
  }
}

// MARK: - The envelope

public struct Request: Decodable {
  public let id: Int
  public let op: String
  public let params: JSONValue?
}

/// `code` is present on a failure and is the part call sites branch on (`"element_gone"`,
/// `"window_gone"`, `"invalid_params"`, `"unknown_op"`, `"ax_denied"`); `error` is the sentence a
/// log or a person reads. A response never carries both `result` and an error.
public struct Response: Encodable {
  public let id: Int
  public let ok: Bool
  public let result: JSONValue?
  public let error: String?
  public let code: String?

  public static func success(_ id: Int, _ result: JSONValue) -> Response {
    Response(id: id, ok: true, result: result, error: nil, code: nil)
  }

  public static func failure(_ id: Int, code: String, message: String) -> Response {
    Response(id: id, ok: false, result: nil, error: message, code: code)
  }
}

// MARK: - Domain shapes

/// A neutral role. `AXTree.swift` owns the only mapping from `AXRole`/`AXSubrole` into this.
public enum UiRole: String, Codable {
  case button, link, checkbox, radio, menu, menuItem, tab
  case text, textField, secureField, image, list, row, group, window, scrollArea, slider
  case other
}

public struct Frame: Codable, Equatable {
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double
  public init(x: Double, y: Double, width: Double, height: Double) {
    self.x = x; self.y = y; self.width = width; self.height = height
  }
}

public struct AppInfo: Codable, Equatable {
  /// OS-reported, always — this is the value `shared/policy.ts`'s `Action.app` is built from on
  /// the TypeScript side, and the entire point of this ticket is that it never comes from
  /// anywhere else.
  public var bundleId: String
  public var name: String
  public init(bundleId: String, name: String) { self.bundleId = bundleId; self.name = name }
}

public struct WindowInfo: Codable, Equatable {
  public var id: String
  public var app: AppInfo
  public var title: String
  public var frame: Frame
  public var focused: Bool
}

public struct UiNode: Codable, Equatable {
  /// Opaque, and only stable for the lifetime of the `dump_tree` response it came from — see
  /// `AXTree.handleTable`. A caller that holds one across a target app quitting gets
  /// `element_gone` back, not a crash.
  public var handle: String
  public var role: UiRole
  public var title: String?
  public var value: String?
  public var frame: Frame
  public var enabled: Bool
  public var focused: Bool
  /// True when the accessibility API reports this element as `AXSecureTextField`. This is the
  /// honest half of NAV-91's gate input — see `describeElement` and `focusedElementSecure`.
  public var secure: Bool
  public var children: [UiNode]
}

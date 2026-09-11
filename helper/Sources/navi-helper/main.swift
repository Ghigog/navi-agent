import Foundation
import NaviHelperCore

/// The stdio loop (NAV-90). One line in, one line out, correlated by `id`; see `Protocol.swift`
/// for why this is the whole transport. All decision-making lives in `NaviHelperCore.Dispatcher` —
/// this file only owns turning bytes into a `Request` and a `Response` back into bytes.

setbuf(stdout, nil) // Unbuffered: a request is answered the moment it is decided, not when a libc buffer fills.

let dispatcher = Dispatcher()
let encoder = JSONEncoder()
let decoder = JSONDecoder()

func writeLine(_ data: Data) {
  var out = data
  out.append(0x0A) // '\n'
  FileHandle.standardOutput.write(out)
}

/// Best-effort `id` recovery from a line that failed to decode as a `Request` at all, so the
/// caller's pending promise for that line still resolves to *something* rather than hanging
/// forever. Malformed input should only ever mean a bug on the TypeScript side of this protocol,
/// since both ends are this repo's own code — but "hang forever" is a worse failure than
/// "resolve with an error" even so.
func recoverId(from line: String) -> Int {
  guard
    let data = line.data(using: .utf8),
    let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
    let id = object["id"] as? Int
  else { return -1 }
  return id
}

while let line = readLine(strippingNewline: true) {
  if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }

  guard let data = line.data(using: .utf8), let request = try? decoder.decode(Request.self, from: data) else {
    let response = Response.failure(recoverId(from: line), code: "invalid_request", message: "Could not decode this line as a request.")
    if let encoded = try? encoder.encode(response) { writeLine(encoded) }
    continue
  }

  let response = dispatcher.handle(request)
  if let encoded = try? encoder.encode(response) { writeLine(encoded) }
}

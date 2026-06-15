import Cocoa
import Carbon
import Network

// Core function to send UDP messages to Godot on port 9999
func sendUDP(message: String, port: UInt16) {
    let connection = NWConnection(
        host: "127.0.0.1",
        port: NWEndpoint.Port(rawValue: port)!,
        using: .udp
    )
    connection.start(queue: .global())
    connection.send(content: message.data(using: .utf8),
                    completion: .contentProcessed({ _ in connection.cancel() }))
}

// ---------------------------------------------------------------------------
// Hotkey registration
//
// Combo:     Control + Shift + Option + Space
// Keycode:   49  (Space bar — universal, layout-independent)
// Modifiers: controlKey = 0x1000 = 4096
//            shiftKey   = 0x0200 =  512
//            optionKey  = 0x0800 = 2048
//            Total                = 6656
//
// This combination is safe: no standard macOS or common app shortcut uses it.
// ---------------------------------------------------------------------------

var keyCode: UInt32 = 49
var modifiers: UInt32 = 6656

if CommandLine.arguments.count >= 3 {
    if let argKey = UInt32(CommandLine.arguments[1]),
       let argMod = UInt32(CommandLine.arguments[2]) {
        keyCode = argKey
        modifiers = argMod
    }
}

var hotKeyID = EventHotKeyID()
hotKeyID.signature = OSType(bitPattern: 0x4E415649) // 'NAVI'
hotKeyID.id = 1

var hotKeyRef: EventHotKeyRef?
let status = RegisterEventHotKey(
    keyCode,
    modifiers,
    hotKeyID,
    GetApplicationEventTarget(),
    0,
    &hotKeyRef
)

if status != noErr {
    print("[HotkeyDaemon] ERROR: Failed to register hotkey (Carbon status \(status)).")
    print("[HotkeyDaemon] If status is -9878, grant Accessibility access in:")
    print("[HotkeyDaemon]   System Settings → Privacy & Security → Accessibility")
    exit(1)
} else {
    print("[HotkeyDaemon] Registered hotkey successfully (keycode \(keyCode), modifiers \(modifiers)).")
}

let handler: @convention(c) (EventHandlerCallRef?, EventRef?, UnsafeMutableRawPointer?) -> OSStatus = { (_, event, _) -> OSStatus in
    if let event = event {
        let kind = GetEventKind(event)
        if kind == UInt32(kEventHotKeyPressed) {
            print("[HotkeyDaemon] HOTKEY DOWN — sending UDP packet to Godot.")
            sendUDP(message: "hotkey_down", port: 9999)
        } else if kind == UInt32(kEventHotKeyReleased) {
            print("[HotkeyDaemon] HOTKEY UP — sending UDP packet to Godot.")
            sendUDP(message: "hotkey_up", port: 9999)
        }
    }
    return noErr
}

var eventPress = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
var eventRelease = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased))

InstallEventHandler(GetApplicationEventTarget(), handler, 1, &eventPress, nil, nil)
InstallEventHandler(GetApplicationEventTarget(), handler, 1, &eventRelease, nil, nil)

print("[HotkeyDaemon] Event loop running.")
NSApplication.shared.run()

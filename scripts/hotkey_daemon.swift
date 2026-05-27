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

var hotKeyID = EventHotKeyID()
hotKeyID.signature = OSType(bitPattern: 0x4E415649) // 'NAVI'
hotKeyID.id = 1

var hotKeyRef: EventHotKeyRef?
let status = RegisterEventHotKey(
    49,         // Space — physical keycode, layout-independent
    6656,       // Control (4096) + Shift (512) + Option (2048)
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
    print("[HotkeyDaemon] Registered Ctrl+Shift+Option+Space (keycode 49) successfully.")
    print("[HotkeyDaemon] Listening — press Ctrl+Shift+Option+Space to trigger Navi.")
}

// Event type spec — keyboard hotkey pressed
var eventType = EventTypeSpec(
    eventClass: OSType(kEventClassKeyboard),
    eventKind:  UInt32(kEventHotKeyPressed)
)

// Install the Carbon event handler
InstallEventHandler(
    GetApplicationEventTarget(),
    { (_, _, _) -> OSStatus in
        print("[HotkeyDaemon] HOTKEY FIRED — sending UDP packet to Godot.")
        sendUDP(message: "hotkey", port: 9999)
        return noErr
    },
    1, &eventType, nil, nil
)

print("[HotkeyDaemon] Event loop running.")
NSApplication.shared.run()

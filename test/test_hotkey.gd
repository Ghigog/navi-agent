extends GutTest
## Test suite for checking global hotkey UDP listening on the Autoload singleton.

var input_mgr: Node

func before_each() -> void:
	# Reference the global autoload singleton
	input_mgr = get_node("/root/InputManager")

func test_hotkey_packet_emits_signal() -> void:
	assert_not_null(input_mgr, "InputManager Autoload should exist in the scene tree.")

	# If InputManager failed to bind the port (e.g. Navi is already running),
	# there is nothing to receive the packet — skip gracefully.
	var test_peer := PacketPeerUDP.new()
	var bind_check := test_peer.bind(9999, "127.0.0.1")
	test_peer.close()
	if bind_check != OK:
		pending("Skipping: UDP port 9999 is already in use (Navi may be running). " +
				"Stop any running Navi instance and re-run.")
		return

	# Register signal tracking
	watch_signals(input_mgr)

	# Setup a loopback UDP client to transmit the mock signal
	var client := PacketPeerUDP.new()
	var err := client.connect_to_host("127.0.0.1", 9999)
	assert_eq(err, OK, "UDP client should connect to local port 9999.")

	# Send the hotkey packet
	err = client.put_packet("hotkey".to_utf8_buffer())
	assert_eq(err, OK, "UDP client should send packet to localhost successfully.")

	# Wait for InputManager._process() to poll and emit
	await get_tree().create_timer(0.15).timeout

	assert_signal_emitted(input_mgr, "hotkey_pressed",
		"InputManager should emit hotkey_pressed after receiving the UDP packet.")

	client.close()

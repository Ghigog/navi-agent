extends GutTest
## NAV-81 — credential redaction before anything derived from settings is logged.
##
## The regression these guard is concrete: a real OpenAI key reached test_run.log because
## load_settings() print()-ed the whole settings dictionary.

const NaviUtilsScript := preload("res://scripts/NaviUtils.gd")

## Shape-accurate stand-in for the key that actually leaked. Not a real credential.
const SAMPLE_KEY := "sk-proj-0000000000000000000000000000000000000000000000"


func test_masks_a_representative_key() -> void:
	var out: Variant = NaviUtilsScript.redact_secrets({"openai_api_key": SAMPLE_KEY})
	assert_eq(out["openai_api_key"], "<redacted:%d chars>" % SAMPLE_KEY.length(),
		"An api key value must be replaced by a length-only placeholder.")
	assert_false(str(out).contains(SAMPLE_KEY),
		"The key must not survive anywhere in the redacted output.")


func test_masks_every_secret_name_variant() -> void:
	var out: Variant = NaviUtilsScript.redact_secrets({
		"cloud_api_key": "abcdef",
		"auth_token": "abcdef",
		"client_secret": "abcdef",
		"db_password": "abcdef",
		"aws_credential": "abcdef",
	})
	for name in (out as Dictionary).keys():
		assert_eq(out[name], "<redacted:6 chars>", "%s should be masked by name." % name)


func test_leaves_non_secret_settings_readable() -> void:
	var out: Variant = NaviUtilsScript.redact_secrets({
		"llm_provider": "local",
		"local_url": "http://localhost:11434",
		"tts_rate": 1.4,
		"enable_thinking": true,
	})
	assert_eq(out["llm_provider"], "local", "Ordinary settings must stay legible in logs.")
	assert_eq(out["local_url"], "http://localhost:11434", "A local URL is not a credential.")
	assert_eq(out["tts_rate"], 1.4, "Non-string values pass through unchanged.")
	assert_eq(out["enable_thinking"], true, "Booleans pass through unchanged.")


func test_unset_key_stays_distinguishable_from_a_set_one() -> void:
	# "" must survive so a log line can still answer "is a key configured?" without
	# revealing anything about one that is.
	var out: Variant = NaviUtilsScript.redact_secrets({"cloud_api_key": "", "openai_api_key": "x"})
	assert_eq(out["cloud_api_key"], "", "An unset key should render as empty, not as a mask.")
	assert_eq(out["openai_api_key"], "<redacted:1 chars>", "A set key should render as a mask.")


func test_masks_a_credential_hiding_under_an_innocuous_name() -> void:
	# The name-based rule is the primary defence; this is the backstop for the case that
	# caused NAV-81 in the first place — a secret somewhere nobody thought to look.
	var out: Variant = NaviUtilsScript.redact_secrets({"notes": SAMPLE_KEY})
	assert_false(str(out).contains(SAMPLE_KEY),
		"A value that looks like a credential must be masked whatever it is called.")


func test_recurses_into_nested_structures() -> void:
	var out: Variant = NaviUtilsScript.redact_secrets({
		"providers": [
			{"name": "openai", "api_key": SAMPLE_KEY},
			{"name": "ollama", "api_key": ""},
		]
	})
	assert_false(str(out).contains(SAMPLE_KEY),
		"Redaction must reach keys nested inside arrays and sub-dictionaries.")
	assert_eq(out["providers"][0]["name"], "openai", "Nested non-secret fields stay intact.")


func test_does_not_mutate_the_dictionary_it_was_given() -> void:
	# Redaction is for display only. If it edited settings in place it would write the
	# placeholder back to disk on the next save and destroy the user's key.
	var original: Dictionary = {"openai_api_key": SAMPLE_KEY}
	NaviUtilsScript.redact_secrets(original)
	assert_eq(original["openai_api_key"], SAMPLE_KEY,
		"redact_secrets must return a copy and leave the live settings untouched.")

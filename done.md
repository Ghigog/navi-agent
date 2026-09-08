# Navi Completed Tickets

Historical index of completed, cancelled, and reverted work.

Full ticket bodies were removed on 2026-09-06. The audit below found that a significant share of
those descriptions no longer matched the code — superseded by later tickets that were never amended,
or in one case simply wrong. Rather than leave misleading detail in the repository, this file now
records only **what was done**. The bodies remain in git history at `81a2e83` if ever needed.

Active work lives in [backlog.md](backlog.md), which starts at NAV-81.

---

## Accuracy Audit (2026-09-06)

The completed-ticket log below was audited against the code at commit `bb51774`. Historical entries
are **left unedited** — they record what was believed at the time — but the following corrections
apply. Where a ticket describes behaviour that no longer exists, the cause is almost always a later
ticket that superseded it without amending the earlier entry.

### Superseded, not wrong when written

- **NAV-BUG-02** documents three-layer routing (Layer 0 classifier, Layer 1 fast model, Layer 2 heavy
  model). **NAV-59** later collapsed this to a single tier. Only Layer 0 (`PROMPT_SKILL_RULES`) still
  exists. Layers 1 and 2, and the `[ESCALATE]` protocol they used, are gone.
- **NAV-BUG-05** documents a visual-refusal self-correction pipeline. **NAV-59** removed it. The
  constant `_VISUAL_REFUSAL_PATTERNS` (`AIService.gd:153`) and the helper `_get_retraction_message()`
  (`AIService.gd:1908`) remain with **zero callers** — dead code, not live behaviour.
- **NAV-20** describes routing visual queries to a separate "heavy" model. After NAV-59 there is only
  one model. Its test `test_visual_queries_escalate_to_heavy_model` still exists and passes, but its
  name describes an architecture that no longer exists.
- **NAV-BUG-10** added VAD; **NAV-69** deprecated it. The deprecation works, but via a hardcoded
  special case in `SettingsManager.get_setting()` (`:230`) that always returns `true` for
  `enable_push_to_talk` regardless of the stored value. Four call sites still read that key, and
  `ChatUI._silence_duration` (`:34`) survives as an unused variable.

### Inaccurate as written

- **NAV-68**, description item 3, claims `_apply_personality_voice()` was "bypassed ... to return raw
  cleaned thoughts". It was **not**. The function is still defined at `AIService.gd:1926` and still
  applied to every `<think>` line at `AIService.gd:1817` and `:1826`. Thought lines are still wrapped
  in hardcoded templates ("Ugh, ...", "Okay so, ..."). Superseded by **NAV-86**.
- **NAV-59** claims model settings were consolidated to a single field. Partially true: the UI shows
  one field, but `local_thinking_model` and `cloud_thinking_model` remain as separate stored keys and
  are still read at `AIService.gd:312`. `_deliver_final_response()` also still carries an unused
  `fast_model` parameter (`:479`) from the removed two-tier design, and the README still documents
  two tiers.

### Test claims that do not resolve

Seven test functions named in acceptance criteria do not exist in `test/`. Some were presumably
removed alongside the features they covered, but the criteria were never amended:

| Claimed test | Ticket |
|---|---|
| `test_apply_personality_voice_annoying` | NAV-21 |
| `test_apply_personality_voice_fallback` | NAV-21 |
| `test_thought_trail_accumulates` | NAV-21 |
| `test_thought_trail_committed_on_response_received` | NAV-21 |
| `test_scroll_following_enabled` | NAV-17 |
| `test_visual_history_retains_multiple_turns` | NAV-17 |
| `test_escalation_rules_with_conversational_escalate_text` | NAV-BUG-07 |

### Ticket ID collisions

Seventeen IDs are reused (NAV-67 three times), because numbering restarted at some point rather than
continuing: NAV-59, 67, 68, 69, 70, 71, 73, 74, 75, 76, 77, 78, 79, 80, NAV-BUG-06, NAV-BUG-07, and
the untracked NAV-UI label.
IDs are **not** being renumbered, since inbound references would break — but every ID at or below
NAV-80 is ambiguous and must be cited together with its title. New tickets start at NAV-81 and
continue monotonically.

### Verified accurate

NAV-33 (correctly REVERTED — `bin/piper` is a Python wrapper script, with no platform subfolders and
no `OS.get_name()` dispatch in `TTSService.gd`), NAV-49 (`NaviUtils` autoload), NAV-53 (native tool
calling), NAV-54 (modular skill classes), NAV-55 (confirmation flow wired end to end, though it gates
only `point_to`), NAV-60 through NAV-65 (emotion system), NAV-77 (`ErrorBus`), and the NAV-69 /
NAV-71 scratchpad and continuation tests.

---

## Index

114 entries, in original file order. IDs marked ⚠ are ambiguous — reused across two or more
tickets — so cite them together with the title.

| # | ID | Title | Status |
|---:|---|---|---|
| 1 | `NAV-UI` ⚠ | Full UI Refactor | DONE |
| 2 | `NAV-78` ⚠ | Install Piper TTS Dependency UI and Script | DONE |
| 3 | `NAV-80` ⚠ | Prevent Duplicate Hotkey Daemon Instances | DONE |
| 4 | `NAV-UI` ⚠ | Display Order Adjustment | DONE |
| 5 | `NAV-79` ⚠ | Visual Analysis Capability Error Handling | DONE |
| 6 | `NAV-69` ⚠ | Short-Term Memory Scratchpad System | DONE |
| 7 | `NAV-70` ⚠ | Multi-Step Response Continuation Loop | DONE |
| 8 | `NAV-71` ⚠ | Unit & Integration Testing for Multi-Step System | DONE |
| 9 | `NAV-77` ⚠ | Speech-to-Text (STT) User Instructions in Settings UI | DONE |
| 10 | `NAV-74` ⚠ | Portable Local Neural TTS (Piper) Setup | DONE |
| 11 | `NAV-75` ⚠ | Model Bootstrapping & Setup Script / In-App Downloader | DONE |
| 12 | `NAV-76` ⚠ | Export Packaging & Global Hotkey Distribution | DONE |
| 13 | `NAV-73` ⚠ | Multi-Pass Agentic Tool Calling Loop | DONE |
| 14 | `NAV-68` ⚠ | Voice-Text Streaming Sync, Emotion State Preservation & In-Character Responses | DONE |
| 15 | `NAV-67` ⚠ | Unify Visual Features (Two-Color Theme) | DONE |
| 16 | `NAV-01` | Transparent Borderless Window Setup | DONE |
| 17 | `NAV-02` | Fairy Visuals - Glowing Particles & Animated Wings | DONE |
| 18 | `NAV-03` | Mouse-Following Behavior | DONE |
| 19 | `NAV-04` | Global Hotkey Listener & Window Focus Toggle | DONE |
| 20 | `NAV-05` | Viewport Hide & Screen Capture Utility | DONE |
| 21 | `NAV-06` | Local & Cloud AI Connection Service | DONE |
| 22 | `NAV-07` | Hextech Chat UI Popup | DONE |
| 23 | `NAV-08` | Configuration & Settings UI | DONE |
| 24 | `NAV-BUG-07` ⚠ | Deprecate Llama Model References in Settings UI | DONE |
| 25 | `NAV-BUG-06` ⚠ | Local Model Startup Preload Discrepancy & TTSService Execution Logging | DONE |
| 26 | `NAV-BUG-01` | HTTPClient Streaming Hang — Missing `client.poll()` Calls | DONE |
| 27 | `NAV-BUG-02` | Deterministic Prompt Classifier — `PROMPT_SKILL_RULES` Library | DONE |
| 28 | `NAV-BUG-03` | Deferred Thought Rephrasing Overwriting Streaming Response | DONE |
| 29 | `NAV-BUG-04` | Session Memory Not Saved When Switching Chat → Settings | DONE |
| 30 | `NAV-BUG-05` | Fast Model Refuses Visual Tasks Instead of Escalating | DONE |
| 31 | `NAV-09` | Speech-to-Text (STT) Voice Inputs | COMPLETED |
| 32 | `NAV-10` | Text-to-Speech (TTS) Voice Responses | COMPLETED |
| 33 | `NAV-11` | Screen Navigation and Pointer Guidance | DONE |
| 34 | `NAV-12` | Redesigned Interactive Fairy UI & Screen-Aware Chat | DONE |
| 35 | `NAV-13` | Full Skill-Agent Workflow | DONE |
| 36 | `NAV-14` | Asynchronous Streaming & Direct Conversational Routing | DONE |
| 37 | `NAV-15` | Global Font Size Adjustment & Response Box Resizing | DONE |
| 38 | `NAV-16` | Conversation Context Memory in AIService | DONE |
| 39 | `NAV-17` | Visual Chat History Thread in ChatUI | DONE |
| 40 | `NAV-18` | Background Chat Session Summarization Skill | DONE |
| 41 | `NAV-19` | Honesty Prompt Reinforcements | DONE |
| 42 | `NAV-20` | Route Visual Queries to Heavy Reasoning Model | OPTIMIZED |
| 43 | `NAV-21` | Live Thought Trail with Personality Transform | DONE |
| 44 | `NAV-22` | Redesigned Circular Core (Heart) and Orbiting Status Lights | CANCELLED |
| 45 | `NAV-23` | Dynamic Flight Wings and Sparkle Motion Trail | CANCELLED |
| 46 | `NAV-24` | Mouse Cursor Capture in Screen Capture | COMPLETED |
| 47 | `NAV-25` | Application Startup & Screen Capture Efficiency Optimization | COMPLETED |
| 48 | `NAV-26` | Fix Hotkey Window Activation & Spurious Collapse | COMPLETED |
| 49 | `NAV-27` | Fixed Window Positioning and Enabled Dragging during Chat Overlay | COMPLETED |
| 50 | `NAV-28` | STT Toggle Mode and Whisper Output Cleanups | COMPLETED |
| 51 | `NAV-29` | TTS Voice Option Dropdown and Custom Mutter Management | COMPLETED |
| 52 | `NAV-30` | Real-time Asynchronous Stream-based TTS Vocalization | COMPLETED |
| 53 | `NAV-31` | Deterministic Visual Router & Fast Prompt Tool Awareness | COMPLETED |
| 54 | `NAV-32` | Hybrid Local & Cloud TTS Voice Integration with Toggle Filtering | COMPLETED |
| 55 | `NAV-33` | Standalone C++ Piper Compilation and Multi-Platform Bundling | REVERTED |
| 56 | `NAV-34` | Prompt Classifier Expansion for Visual Pointers | COMPLETED |
| 57 | `NAV-35` | Interactive Step-by-Step Response Parser | COMPLETED |
| 58 | `NAV-36` | Dynamic 'Next' Button & User Confirmation Flow | COMPLETED |
| 59 | `NAV-37` | Coordinated Navigation and Status Colors | COMPLETED |
| 60 | `NAV-38` | Heavy LLM Prompt Update for Sequence Planning | COMPLETED |
| 61 | `NAV-39` | GUT Integration Tests for Multi-Turn Step Guidance | COMPLETED |
| 62 | `NAV-40` | Step-by-Step Movement Log and Prompt Robustness | COMPLETED |
| 63 | `NAV-41` | Full-Screen Interactive Movement and Thought Reformatting | COMPLETED |
| 64 | `NAV-42` | Raw Response Streaming Transmission and Thought Leak Suppression | COMPLETED |
| 65 | `NAV-43` | Conversational Tag Stripping and Auto-Advancement in Guidance Steps | COMPLETED |
| 66 | `NAV-44` | Normalized Coordinates Mapping for Visual Pointing | COMPLETED |
| 67 | `NAV-45` | Settings Options for Hotkey and TTS Voice Speed/Pitch | COMPLETED |
| 68 | `NAV-46` | Center Status Notification Light inside Fairy Core | COMPLETED |
| 69 | `NAV-47` | Asynchronous Model Pre-Warming & VRAM Keep-Alive | COMPLETED |
| 70 | `NAV-48` | Full Screen Coordinate Mapping for Visual Pointing | COMPLETED |
| 71 | `NAV-BUG-06` ⚠ | Automatic Guidance Sequence and Speech Sync | COMPLETED |
| 72 | `NAV-BUG-07` ⚠ | Fix Duplicate Text Appending on Handoff and False Escalation Trigger | COMPLETED |
| 73 | `NAV-BUG-08` | Real-Time Interactive Step Streaming Playback | COMPLETED |
| 74 | `NAV-BUG-09` | Fix Offscreen Window Resizing and Mouse Following in Active Mode | COMPLETED |
| 75 | `NAV-49` | Extract Coordinated Utilities to Dedicated Autoload | COMPLETED |
| 76 | `NAV-50` | Decouple Step-by-Step Presentation State from ChatUI | DONE |
| 77 | `NAV-51` | Vision Pipeline & Startup Optimization | DONE |
| 78 | `NAV-52` | Real-time Guidance Step Streaming and Vision Model Thinking Bypass | COMPLETED |
| 79 | `NAV-59` ⚠ | Consolidate Local Model Architecture and Bypass Thinking | DONE |
| 80 | `NAV-60` | Emotion State Data Model & Persistence | DONE |
| 81 | `NAV-61` | Emotion Scoring Engine | DONE |
| 82 | `NAV-62` | Emotion-Aware Prompt Injection | DONE |
| 83 | `NAV-63` | Tricolor Emotion Body Color | DONE |
| 84 | `NAV-64` | Floating Emoji Emotion Notifications | DONE |
| 85 | `NAV-65` | Live Navi Mode Toggle | DONE |
| 86 | `NAV-53` | Migrate to Native LLM Tool Calling (Function Calling) | DONE |
| 87 | `NAV-54` | Decouple Skills into Standalone Modular Classes | DONE |
| 88 | `NAV-59` ⚠ | Fix TTS Stream State Issue and Disable Startup Greeting | DONE |
| 89 | `NAV-56` | Consolidated Single-Window UI Overlay | DONE |
| 90 | `NAV-57` | Direct-Activation STT with Live Editor Ingestion | DONE |
| 91 | `NAV-58` | Settings UI Overlay Simplification | DONE |
| 92 | `NAV-66` | Decouple Wisdom Scoring from Memory Heuristic | DONE |
| 93 | `NAV-67` ⚠ | Remove Send/Record Buttons & Use Enter for Controls | DONE |
| 94 | `NAV-55` | Interactive Skill Confirmation Overlay | DONE |
| 95 | `NAV-BUG-10` | Live STT Ingestion with Silence/VAD Detection | DONE |
| 96 | `NAV-67` ⚠ | Hold to Talk (Push-to-Talk) System | DONE |
| 97 | `NAV-68` ⚠ | Polished Push-to-Talk Tap-vs-Hold and Input Focus | COMPLETED |
| 98 | `NAV-69` ⚠ | Deprecate Voice Detection and Enforce Push-to-Talk | COMPLETED |
| 99 | `NAV-70` ⚠ | Persistent Emotional State and Startup Color | COMPLETED |
| 100 | `NAV-71` ⚠ | Thinking Status Light and Coordinated Pointing Execution | COMPLETED |
| 101 | `NAV-72` | Local Model Warm-up and Startup Greeting | COMPLETED |
| 102 | `NAV-73` ⚠ | Fix Startup Greeting NPC Follow Mode & Hotkey Lock | COMPLETED |
| 103 | `NAV-74` ⚠ | Unified Startup Greeting & Preload with Loader Sync | COMPLETED |
| 104 | `NAV-75` ⚠ | Fix Voice Push-to-Talk Hotkey Release Event | COMPLETED |
| 105 | `NAV-76` ⚠ | Fix Push-to-Talk Daemon Never Launching | COMPLETED |
| 106 | `NAV-77` ⚠ | Global Error Surface via ErrorBus + ⚠️ Emoji Notification | COMPLETED |
| 107 | `NAV-78` ⚠ | Fix whisper-cli SIGABRT + Settings Download Button State | COMPLETED |
| 108 | `NAV-79` ⚠ | UI Streaming and Auto-Trigger Bug Fixes | COMPLETED |
| 109 | `NAV-80` ⚠ | Continuation Tag Scratchpad/Think Suppression | COMPLETED |
| 110 | `NAV-BUG-12` | HighDPI Coordinate Calibration and Step-by-Step Guidance Restore | COMPLETED |
| 111 | `NAV-BUG-13` | Guidance Sequence Scratchpad Suppression | COMPLETED |
| 112 | `NAV-94` | Platform decision — migrate to Electron (ADR 0001) | DONE |
| 113 | `NAV-99` | Cursor-anchored "what's this?" — crop follows the cursor, not the fairy | DONE |
| 114 | `NAV-81` | Purge committed secret and repository bloat — key revoked, settings redacted, test_run.log/scratch/voice models purged from all history via `git filter-repo` | DONE |

---

## Status legend

- **DONE** / **COMPLETED** — shipped.
- **OPTIMIZED** — shipped as a refinement of earlier work.
- **CANCELLED** — deliberately abandoned before implementation.
- **REVERTED** — implemented, then rolled back. NAV-33 is the only one; `bin/piper` remains a Python
  wrapper script rather than a bundled native binary.

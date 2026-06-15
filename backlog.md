# Navi Backlog Tickets

This document contains outstanding tasks and features in the backlog.

## Template & Guidelines

## Ticket Template

```markdown
### NAV-XX: [Ticket Title] ([Status])
**User Story:**
- **As a:** [Role]
- **I want:** [Goal]
- **So that:** [Reason/Value]

**Context:**
[Background details or architectural constraints]

**Description:**
[What features need to be built]

**Requirements:**
[How to implement the features technically in Godot 4]

**Acceptance Criteria:**
[Checklist of items that must pass verification, including GUT unit test definitions]
```

---

## Tickets

### NAV-69: Short-Term Memory Scratchpad System (TODO)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to write private planning notes in a scratchpad that persists across conversational turns
- **So that:** Navi can plan multi-step answers, formulate clarifying questions, and refer back to information later.

**Context:**
Currently, Navi has no private state memory between turns. All history is user-visible, meaning she cannot "think ahead" or structure long-term responses without dumping it all to the screen.

**Requirements:**
1. Add `_short_term_memory: String` to `AIService.gd`.
2. Extract `<scratchpad>...</scratchpad>` blocks from LLM responses using Regex in `AIService.gd` and store them in `_short_term_memory`.
3. Strip `<scratchpad>` blocks from user-visible UI and TTS readbacks by updating `NaviUtils.gd`.
4. Inject the current `_short_term_memory` into system prompts in `_build_identity()`.
5. Clear `_short_term_memory` when history is cleared or the chat session ends.

**Acceptance Criteria:**
- **GUT Test**: Verify `<scratchpad>` blocks are correctly extracted and stored in `AIService._short_term_memory`.
- **GUT Test**: Verify `<scratchpad>` blocks are cleanly stripped from user-facing text and TTS streams.
- **GUT Test**: Verify `_short_term_memory` is cleared on `clear_history()`.

---

### NAV-70: Multi-Step Response Continuation Loop (TODO)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to output responses in sequential stages by triggering background continuations (`[CONTINUE]`)
- **So that:** I can have realistic, paced conversations and intervene/interrupt between steps.

**Context:**
API Alternate Role Constraint: The Gemini API requires strictly alternating user and model roles. To support consecutive assistant messages natively without schema errors, we will inject a hidden `(Continue)` user message into the LLM history when triggering auto-continuations. This remains completely invisible in the Chat UI but guarantees API compliance.
Trace logging is required to track continuation states.

**Requirements:**
1. Update `send_prompt` signature to support `is_continuation: bool = false`.
2. Skip deterministic classification and emotion pre-evaluation on continuation requests.
3. Detect the `[CONTINUE]` tag in LLM replies and schedule a background continuation using a token-based timer.
4. The continuation sequence must:
   - Wait for `TTSService.is_speaking()` to complete.
   - Wait for a 2.0s conversational pause.
   - Cancel if the user types anything in the input box (`input_edit.text != ""`) or submits a new prompt.
   - Dispatch `send_prompt("(Continue)", ..., is_continuation = true)`.
5. Format continuation turns in history as `(Continue)` (User) -> `Cleaned Reply` (Assistant).
6. Print trace logs for all continuation execution.

**Acceptance Criteria:**
- **GUT Test**: Verify that a response containing `[CONTINUE]` schedules a background continuation request.
- **GUT Test**: Verify that sending a new prompt or typing in `ChatUI`'s text input cancels the pending continuation.
- **Manual Verification**: Verify that Navi speaks/renders in steps, pauses between steps, and pauses/stops if input is entered.

---

### NAV-71: Unit & Integration Testing for Multi-Step System (TODO)
**User Story:**
- **As a:** Developer
- **I want:** Comprehensive GUT tests for the scratchpad and continuation systems
- **So that:** I can verify correct tag stripping, prompt injection, continuation scheduling, and interruption behavior.

**Requirements:**
1. Create unit tests verifying `<scratchpad>` and `[CONTINUE]` stripping in `NaviUtils.gd`.
2. Mock HTTPClient responses in `test_ai_service.gd` to test scratchpad updates and continuation triggering.
3. Verify that typing in `ChatUI`'s LineEdit successfully cancels scheduled continuations.

**Acceptance Criteria:**
- **GUT Test**: All tests run and pass successfully in the headless GUT test suite.

---

### NAV-72: Predictive User Auto-Trigger Answering (TODO)
**User Story:**
- **As a:** Navi user typing a message
- **I want:** Navi to automatically predict my complete sentence/intent when I pause typing, and start responding without me having to press Enter
- **So that:** Interactions feel completely fluid, hands-free, and natural like speaking to a human.

**Context:**
LLM inference is slow (1–3s latency), so running a full LLM call on every keystroke is impractical. However, we can use a debounced timer (e.g. 1.2s of typing inactivity) to evaluate if the input forms a complete thought. If the user stops typing and the input has a high likelihood of completion (or ends with punctuation), Navi auto-submits it.

**Requirements:**
1. Implement a debounced keypress timer in `ChatUI.gd` (e.g., 1.2 seconds of typing pause).
2. Upon timer expiration:
   - If the input text is non-empty and ends in punctuation (`?`, `.`, `!`), auto-trigger submit.
   - Alternatively, dispatch a fast local classifier request to check if the current input text constitutes a "completed idea". If so, auto-submit.
   - If the input is ambiguous or has multiple interpretation paths, Navi can inject a clarifying prompt like `"Wait, did you mean X or Y?"`.
3. Provide a settings toggle `enable_predictive_trigger` (default: false) in Settings UI to let users opt in.

**Acceptance Criteria:**
- **Manual Verification**: Typing a sentence ending with `?` and pausing for 1.2s submits the prompt automatically.

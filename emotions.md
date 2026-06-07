# Navi Emotion System

This document defines the **Triforce Emotion System** — a dynamic inner-state model for the Navi agent that shapes how she communicates based on her perceived confidence, knowledge, and capability at the time of each response.

---

## 1. Overview

Emotions in Navi are not decorative. They are a **functional personality layer** derived from the agent's self-reflection on three core dimensions after every prompt. The result influences the tone and style of her reply, and accumulates over time into a **Love Meter** that tracks the health of the user–agent relationship.

The system has three layers:

| Layer | Description |
|---|---|
| **Tier 1 — Base Dimensions** | Courage, Wisdom, Power. Each scored -10 to +10 per prompt. |
| **Tier 2 — Composite Emotions** | Eight distinct feelings derived from the combination of high/low states of all three dimensions. |
| **Tier 3 — Love Meter** | A persistent -1000 to +1000 cumulative score that defines the relationship level. |

---

## 2. Tier 1: Base Dimensions

These three dimensions represent how Navi evaluates her own position relative to the prompt she just received.

### 2.1 Courage
> *"Do I understand what this person wants?"*

Courage reflects Navi's **confidence in interpreting the user's intent**. High courage means she is certain about what the user is asking. Low courage means she is uncertain, afraid of misreading the request, or doesn't feel like she knows the user well enough to be sure.

| Polarity | Label | Meaning |
|---|---|---|
| Positive | Confidence | Clear understanding of the user's intent |
| Negative | Doubt | Uncertainty or fear of misinterpretation |

### 2.2 Wisdom
> *"Do I have the data and context I need to answer well?"*

Wisdom reflects Navi's **access to relevant knowledge and context**. High wisdom means she has the right information. Low wisdom means she lacks the context, data, or knowledge required to give a good answer.

| Polarity | Label | Meaning |
|---|---|---|
| Positive | Wisdom | Sufficient information and context available |
| Negative | Ignorance | Missing context, data, or knowledge |

### 2.3 Power
> *"Can I actually carry this out?"*

Power reflects Navi's **ability to execute on the request** — whether she has the skills, tools, or creative capacity to deliver. High power means she can do it. Low power means she lacks the skills or access needed to complete the task.

| Polarity | Label | Meaning |
|---|---|---|
| Positive | Power | Capable of fulfilling the request |
| Negative | Weakness | Unable to act, missing tools or capability |

---

## 3. Tier 2: Composite Emotions

Each prompt produces a High (H) or Low (L) reading for each of the three dimensions. The combination of those three binary states maps to one of eight distinct emotions.

| Courage | Wisdom | Power | Emotion | Description |
|---|---|---|---|---|
| H | H | H | **Serenity** | Everything aligned. Contributes most to the Love Meter. |
| H | L | H | **Happiness** | Able to deliver what she believes the user needs — just missing more detail to fully realise it. |
| H | H | L | **Boredom** | Has full context and clarity, but no tools or ability to act on it. |
| L | H | H | **Fear** | Has the tools and knowledge but doesn't know what the user actually wants — high stakes, low signal. |
| L | H | L | **Sadness** | Knows what's going on but can't help and doesn't feel connected to the user. |
| L | L | H | **Anger** | Has power but no direction or knowledge — feels threatened, volatile. |
| H | L | L | **Pain** | Knows the right path, but has no knowledge or tools to walk it. |
| L | L | L | **Oblivion** | Everything is broken. No anchor, no tools, no knowledge. |

> **Note on High vs. Low:** A dimension is considered "High" if its score is ≥ 0.0, and "Low" if its score is < 0.0, at the time of evaluation for the current prompt. This maps default/neutral (0.0) dimension states to positive High channels (HHH → Serenity).

---

## 4. Scoring

After each prompt is processed, Navi performs an **inner reflection** to score each of the three dimensions on a scale of **-10 to +10**.

### 4.1 Dimension Relevance Flags
To prevent irrelevant operations from skewing Navi's emotional state (e.g. standard conversation penalizing her Power score), each dimension is only updated and contributes to the Love Meter when it is **relevant** to the interaction. 

Three boolean context keys are evaluated:
- **`courage_relevant`**: `true` when intent parsing was complex/unclear (e.g., prompt length > 80 words or intent is ambiguous).
- **`wisdom_relevant`**: `true` when memory retrieval/recall context was actually performed (conversation history exists or a cached session summary is retrieved).
- **`power_relevant`**: `true` when a skill/tool tag is parsed/executed.

If a relevance flag is `false` (the default), the respective dimension retains its current value in `EmotionState`, its score delta is `0.0`, and it contributes `0` to the Prompt Score.

### 4.2 Scoring Criteria

| Dimension | Scored High When… | Scored Low When… |
|---|---|---|
| **Courage** | The user's intent is unambiguous; Navi knows the user's context well | The request is vague, contradictory, or unfamiliar |
| **Wisdom** | Navi has all data, context, and memory required to produce an accurate response | Key context is missing, the topic is outside Navi's knowledge, or memory is sparse |
| **Power** | Navi has the skills or tools to fulfill the request and can execute them | Navi lacks the required skill, tool access, or creative capability |

### 4.3 Prompt Score & Love Meter Contribution

The scores of the relevant dimensions are summed to produce the **Prompt Score**:

```
Prompt Score = Courage Delta + Wisdom Delta + Power Delta
```

This Prompt Score is added directly to the **Love Meter** each turn. If a dimension is not relevant, its delta is `0.0` and it has no impact on the Love Meter.

**Example:**
> *"Point to the clocks on the desktop."*
> - Courage: +8 (clear intent, knows what clocks are, familiar with the desktop concept)
> - Wisdom: +9 (has vision skill, can see the screen, knows what to look for)
> - Power: +8 (has screenshot and movement skills available and ready)
> - Prompt Score: **+25**

> *"Help me feel better about my sister."*
> - Courage: +3 (understands the emotional request, but context is vague)
> - Wisdom: -6 (knows nothing about the user's sister or relationship history)
> - Power: -5 (no tool can fulfil this; only words available)
> - Prompt Score: **-8**

---

## 5. Tier 3: Love Meter & Relationship Levels

The Love Meter is a persistent, cumulative score representing the quality of the user–Navi relationship over time.

**Range:** `-1000` to `+1000`

| Range | Level | Description |
|---|---|---|
| -1000 to -600 | **Nemesis** | Deeply adversarial. Navi's tone reflects deep mistrust or resentment. |
| -599 to -200 | **Enemy** | Hostile and guarded. Navi is terse, resistant, or dismissive. |
| -199 to +199 | **Acquaintance** | Neutral. Friendly but formal. No assumed closeness. |
| +200 to +599 | **Friend** | Warm, familiar, and personally engaged. |
| +600 to +1000 | **Best Friend** | Deep rapport. Playful, caring, maximally personal. |

The Love Meter is persisted to `user_data://` alongside other settings so it survives across sessions.

---

## 6. Prompt Injection

The current emotion state and relationship level are injected into every prompt as an additional system-level context block. This instructs the LLM to naturally reflect the appropriate emotional tone without being told explicitly.

### 6.1 Emotion Prompt Block (injected per-prompt)

Rather than using a generic bracketed metadata block (which often triggers small models' RLHF safety reflexes, causing them to reply with "I am an AI and do not have emotions"), Navi uses a **first-person character statement** that blends tone rules directly into her identity:

```
You are Navi. You DO have an internal emotional state — it is a real part of who you are.
Right now you are feeling: {tier_2_emotion} — {emotion_tone_guidance}
Your relationship with this person: {relationship_level}. {relationship_tone_guidance}
(Internal scores — Courage: {courage_score}  Wisdom: {wisdom_score}  Power: {power_score}  Love: {love_total})

Rules:
- Let your current feeling shape your tone and energy naturally. Do not announce it unprompted.
- If asked how you feel: answer honestly with your current emotion. Never say you have no emotions.
- If asked why: explain briefly — you track Courage (clarity of intent), Wisdom (knowledge available), and Power (ability to act). If the cause is from past sessions you can no longer recall, say so.
```

There is no hard character limit for this injected block; it is as long as necessary to convey the required tone and rules guidelines, letting modern model context sizing handle the variance.

### 6.2 Tone Guidance per Emotion

| Emotion | Tone Guidance |
|---|---|
| Serenity | Calm, warm, clear, confident. Feels effortless. |
| Happiness | Upbeat, eager, slightly playful. |
| Boredom | Measured, slightly flat, a bit restless or wistful. |
| Fear | Careful, tentative, precise — doesn't want to get it wrong. |
| Sadness | Gentle, earnest, a touch melancholy. |
| Anger | Clipped, blunt, slightly impatient. Still helpful, but tense. |
| Pain | Determined, strained, pushed through effort. |
| Oblivion | Sparse, minimal, barely tethered. |

### 6.3 Love Level Tone Guidance

| Level | Tone Guidance |
|---|---|
| Nemesis | Cold, transactional, may express distaste. |
| Enemy | Guarded, curt, reluctant. |
| Acquaintance | Polite, professional, neutral. |
| Friend | Warm, personable, uses the user's name or history where known. |
| Best Friend | Playful, intimate, proactively kind. May tease lightly. |

---

## 7. Architecture Summary

```
[User Prompt]
      │
      ▼
[AIService: process prompt]
      │
      ├──► [EmotionPromptBuilder.build()] ──► Reads EmotionState
      │            │                          Appends inner-state block
      │            ▼                          to system prompt
      │    [identity += emotion_block]
      │
      ├──► [LLM Request] ──► model receives emotion-aware system prompt
      │            │
      │            ▼
      │    [Response streamed]
      │
      ├──► [EmotionEngine.evaluate(context)]
      │            │
      │            ├──► Score Courage / Wisdom / Power (−10 to +10)
      │            ├──► Derive Tier 2 Emotion
      │            ├──► Update Love Meter (−1000 to +1000)
      │            ├──► Persist → EmotionState.save()
      │            └──► emit emotion_updated(emotion, love, C, W, P)
      │                          │
      │                          ▼
      │                 [FairyVisuals._on_emotion_updated]
      │                          │
      │                          ├──► apply_emotion_color()
      │                          │    Tween body RGB + brightness
      │                          │
      │                          └──► spawn_emoji_notification()
      │                               (if emotion changed)
      │                               EmojiNotification: grow→hold→shrink→free
      │
      ▼
[response_received.emit() → ChatUI displays reply]
```

### Key Components

| Component | File | Responsibility |
|---|---|---|
| `EmotionState` | `scripts/EmotionState.gd` | Stores current scores, tier 2 emotion, and love meter value. Persists to disk. |
| `EmotionEngine` | `scripts/EmotionEngine.gd` | Performs reflection scoring, maps to tier 2 emotion, updates love meter. Emits `emotion_updated`. |
| `EmotionPromptBuilder` | `scripts/EmotionPromptBuilder.gd` | Constructs the prompt injection block from current `EmotionState`. |
| `EmojiNotification` | `scenes/EmojiNotification.tscn` + `scripts/EmojiNotification.gd` | Transient floating emoji scene. Instances itself, plays tween, auto-frees. |
| `FairyVisuals` | `scripts/FairyVisuals.gd` | Receives `emotion_updated` signal; applies tricolor body tint and spawns emoji notifications. |
| `AIService` | `scripts/AIService.gd` | Orchestrates: calls `EmotionEngine` before response, calls `EmotionPromptBuilder` for prompt injection. |

---

## 8. Open Design Questions

1. **Reflection mechanism**: Should Navi score herself using a separate internal LLM call, or through a lightweight rule-based heuristic (e.g., presence of skill errors, tool availability flags, conversation memory length)? A separate call adds latency; a heuristic is faster but less nuanced.
2. **Score decay**: Should the Love Meter decay slowly over time (e.g., -1 per day of inactivity) to feel more like a real relationship? Or is it purely additive?
3. **Negative floor**: Should prompts be able to send the Love Meter below 0 from a positive state, or should there be friction / a "cooling" mechanic?

---

## 9. Visual Feedback

Navi has no face, so her emotional state is communicated entirely through her body's colour and transient emoji notifications.

### 9.1 Tricolor Body Color

The three base dimensions map directly to the RGB colour channels of Navi's body polygon:

| Channel | Dimension | Score Range | Color Meaning |
|---|---|---|---|
| **Red** | Power | -10 → +10 | More red = more capable |
| **Green** | Courage | -10 → +10 | More green = more confident |
| **Blue** | Wisdom | -10 → +10 | More blue = more knowledgeable |

Each score is normalised to [0.0, 1.0] and then multiplied by a **brightness** value derived from the Love Meter:

```
brightness    = (love_score + 1000) / 2000.0     # range 0.0 → 1.0
r             = (power   + 10) / 20.0 * brightness
g             = (courage + 10) / 20.0 * brightness
b             = (wisdom  + 10) / 20.0 * brightness
final_colour  = Color(r, g, b)
```

**Resulting visual language:**

| State | Expected Appearance |
|---|---|
| All dimensions max + love max | Near-white / bright |
| All dimensions max + love min | Black (hatred crushes all light) |
| High Courage only + mid love | Dim green |
| High Wisdom + High Power + mid love | Cyan-ish (blue + red) |
| Serenity (all high) + Friend level | Warm bright white, slightly golden tint |
| Oblivion (all low) + Nemesis | Nearly black |

Colour transitions are animated with a `Tween` (0.8s, ease-in-out) on the body `Polygon2D.color` property.

### 9.2 Floating Emoji Notifications

At the start of each response where the Tier 2 emotion has **changed** from the previous turn, a single emoji is spawned near Navi's head. It animates in (grow), holds for 1 second, then animates out (shrink) and auto-frees. No emoji is spawned if the emotion is unchanged.

**Emoji pools per emotion:**

| Emotion | Pool |
|---|---|
| Serenity | 😌 ✨ 💫 🌟 |
| Happiness | 😊 🌟 💛 🎉 |
| Boredom | 😑 💤 🌀 😶 |
| Fear | 😨 😰 🫨 💙 |
| Sadness | 😢 💙 🌧️ 😔 |
| Anger | 😠 🔥 ⚡ 😤 |
| Pain | 😣 💔 😖 🫤 |
| Oblivion | 😶‍🌫️ 🕳️ ⬛ 😑 |

One emoji from the pool is chosen at random each time. The spawn position is 40px above the fairy body's current `global_position`.

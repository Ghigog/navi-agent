# Navi Active Tickets

This document contains active tickets currently in development.

## NAV-UI: Full UI Refactor

**Status:** In Progress

### Changes
- **Text Legibility**: All text uses white with proportional black outlines (2-4px based on font size). Coverage extended to CheckBox, CheckButton, OptionButton, SpinBox, and programmatically-created nodes.
- **Accent Color System**: Panel backgrounds are now a fixed dark neutral (`Color(0.06, 0.06, 0.08, 0.88)`). Navi's mood color is used only as a subtle accent on borders, the Save button, and the chat pointer triangle. Text is always readable regardless of mood state.
- **Settings UX Overhaul**: All 25+ settings now have plain-English hover tooltips. Settings are organized into 5 collapsible sections: Behavior, Appearance, AI & Model, Voice, and Advanced. Developer-facing labels replaced with user-friendly descriptions.
- **Code Cleanup**: Removed deprecated Push-to-Talk dead code. Cleaned up scattered visibility logic.

## NAV-78: Install Piper TTS Dependency UI and Script

**Status:** In Progress

**User Story:**
- **As a:** User running local offline voice output
- **I want:** A script to install the Piper TTS python package and an easy way to verify/install it within the settings panel
- **So that:** I can resolve missing local Piper issues directly or using a simple script, and see when it is correctly set up.

**Description:**
- Create `install_piper.sh` in the project root to install `piper-tts` using the local python environment.
- Add checking logic to the settings page to verify if `piper` is installed (by executing the wrapper and checking the exit code).
- Add a button in the settings UI (reparented under Voice) to trigger the background installation of `piper-tts`.

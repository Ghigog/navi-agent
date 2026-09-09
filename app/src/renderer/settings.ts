/**
 * Settings, and the prompt inspector.
 *
 * Two things in one window because they answer each other: almost every setting here ends up
 * as text in the prompt, and the Prompt tab is where you check that it did. NAV-85 built the
 * inspector for exactly this — the Godot build had no way to see its assembled prompt, which
 * is how two contradictory pointing instructions coexisted for months.
 *
 * There is no Save button. Fields commit on change, the way a preferences window does, and the
 * main process is what validates them — `shared/settings.ts` is the authority on what a frame
 * rate or a provider name may be, not this file.
 *
 * The API key is the one field that does not round-trip. The window is told whether a key is
 * set and never what it is (NAV-81), so it sends a key only when the user types a new one, and
 * a save from here cannot erase one it could not see.
 */

import type { PromptRecord } from '../prompt/inspector.js';
import type { SettingsView } from '../shared/settings.js';

declare global {
  interface Window {
    naviSettings?: {
      get(): Promise<SettingsView>;
      save(patch: Record<string, unknown>): Promise<{ view: SettingsView; hotkeyRegistered: boolean }>;
      lastPrompt(): Promise<PromptRecord | null>;
      emotion(): Promise<string>;
      resetEmotion(): Promise<string>;
      copy(text: string): Promise<void>;
      close(): void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const panels = { settings: $('panel-settings'), prompt: $('panel-prompt') };
const tabs = { settings: $<HTMLButtonElement>('tab-settings'), prompt: $<HTMLButtonElement>('tab-prompt') };
const saved = $('saved');
const warning = $('warning');
const relationship = $('relationship');
const keyInput = $<HTMLInputElement>('openaiApiKey');
const keyNote = $('key-note');
const providerNote = $('provider-note');

/** Every input that maps straight onto a settings key. The key field is handled on its own. */
const bound = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-setting]')];

let current: SettingsView | null = null;

function showTab(name: 'settings' | 'prompt'): void {
  panels.settings.hidden = name !== 'settings';
  panels.prompt.hidden = name !== 'prompt';
  tabs.settings.setAttribute('aria-selected', String(name === 'settings'));
  tabs.prompt.setAttribute('aria-selected', String(name === 'prompt'));
  if (name === 'prompt') void loadPrompt();
}

function flashSaved(): void {
  saved.classList.add('on');
  setTimeout(() => saved.classList.remove('on'), 1100);
}

function render(view: SettingsView): void {
  current = view;
  const s = view.settings;

  for (const el of bound) {
    const key = el.dataset['setting'] as keyof typeof s;
    el.value = String(s[key]);
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('#provider button')) {
    button.setAttribute('aria-pressed', String(button.dataset['provider'] === s.provider));
  }
  for (const field of document.querySelectorAll<HTMLElement>('[data-provider-only]')) {
    field.hidden = field.dataset['providerOnly'] !== s.provider;
  }

  providerNote.textContent =
    s.provider === 'ollama'
      ? 'Everything you say stays on this machine.'
      : 'What you say is sent to OpenAI. Ollama is the offline path.';

  keyInput.value = '';
  keyInput.placeholder = view.hasOpenaiApiKey ? '•••••••••••••• saved' : 'sk-…';
  keyNote.textContent = view.hasOpenaiApiKey
    ? 'A key is saved. Type a new one to replace it; leaving this empty keeps it.'
    : 'Stored on this machine, and never shown again once saved.';
}

async function save(patch: Record<string, unknown>): Promise<void> {
  const result = await window.naviSettings?.save(patch);
  if (!result) return;
  render(result.view);
  // The hotkey is the one setting that can be rejected by something outside Navi.
  warning.textContent = result.hotkeyRegistered
    ? ''
    : `Another app owns ${result.view.settings.hotkey}. Clicking her still opens the chat.`;
  flashSaved();
}

for (const el of bound) {
  el.addEventListener('change', () => {
    const key = el.dataset['setting'] as string;
    const value = el instanceof HTMLInputElement && el.type === 'number' ? Number(el.value) : el.value;
    void save({ [key]: value });
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>('#provider button')) {
  button.addEventListener('click', () => void save({ provider: button.dataset['provider'] }));
}

keyInput.addEventListener('change', () => {
  // Empty means "leave whatever is stored alone", which is why it is not sent. Clearing a key
  // is the button next to it, so that it takes an action rather than an absence.
  if (keyInput.value.trim() === '') return;
  void save({ openaiApiKey: keyInput.value.trim() });
});

$('clear-key').addEventListener('click', () => void save({ openaiApiKey: '' }));

// Two-step rather than a dialog: the second click is the confirmation, and clicking anywhere
// else disarms it. Wiping a relationship someone has been building deserves the pause.
const resetButton = $<HTMLButtonElement>('reset-emotion');
const disarm = (): void => {
  resetButton.dataset['armed'] = 'false';
  resetButton.textContent = 'Start over';
};
resetButton.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (resetButton.dataset['armed'] !== 'true') {
    resetButton.dataset['armed'] = 'true';
    resetButton.textContent = 'Really start over?';
    return;
  }
  relationship.textContent = (await window.naviSettings?.resetEmotion()) ?? '';
  disarm();
  flashSaved();
});
document.addEventListener('click', disarm);

async function loadPrompt(): Promise<void> {
  const record = await window.naviSettings?.lastPrompt();
  const body = $('prompt-body');
  const when = $('prompt-when');
  body.textContent = '';

  if (!record) {
    when.textContent = 'No prompt yet.';
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Say something to her, then come back. This shows the exact prompt she was sent.';
    body.append(empty);
    return;
  }

  when.textContent = `${new Date(record.at).toLocaleTimeString()} · ~${record.estimatedTokens} tokens (estimated)`;

  for (const section of record.sections) {
    const wrapper = document.createElement('div');
    wrapper.className = 'layer';

    const heading = document.createElement('h3');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `LAYER ${section.layer}`;
    heading.append(n, document.createTextNode(section.title));

    const pre = document.createElement('pre');
    pre.textContent = section.body;

    wrapper.append(heading, pre);
    body.append(wrapper);
  }
}

$('refresh-prompt').addEventListener('click', () => void loadPrompt());
$('copy-prompt').addEventListener('click', async () => {
  const record = await window.naviSettings?.lastPrompt();
  if (!record) return;
  await window.naviSettings?.copy(record.prompt);
  flashSaved();
});

tabs.settings.addEventListener('click', () => showTab('settings'));
tabs.prompt.addEventListener('click', () => showTab('prompt'));

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Fields commit on blur, so closing straight from a focused one would throw away what was
  // just typed. The first Escape leaves the field, which saves it; the second closes.
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    active.blur();
    return;
  }
  window.naviSettings?.close();
});

void (async () => {
  const view = await window.naviSettings?.get();
  if (view) render(view);
  relationship.textContent = (await window.naviSettings?.emotion()) ?? '';
})();

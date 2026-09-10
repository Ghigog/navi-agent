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

import { factTokens, FACT_BUDGET, MAX_EPISODES, type Memory } from '../shared/memory.js';

import type { PromptRecord } from '../prompt/inspector.js';
import type { SettingsView } from '../shared/settings.js';

declare global {
  interface Window {
    naviSettings?: {
      get(): Promise<SettingsView>;
      save(patch: Record<string, unknown>): Promise<{
        view: SettingsView;
        hotkeyRegistered: boolean;
        voiceHotkeyRegistered: boolean;
      }>;
      lastPrompt(): Promise<PromptRecord | null>;
      memory(): Promise<Memory>;
      memoryForget(id: string): Promise<Memory>;
      memoryRemember(text: string): Promise<Memory>;
      memoryReset(): Promise<Memory>;
      emotion(): Promise<string>;
      resetEmotion(): Promise<string>;
      copy(text: string): Promise<void>;
      openOnboarding(): void;
      close(): void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const panels = { settings: $('panel-settings'), prompt: $('panel-prompt'), memory: $('panel-memory') };
const tabs = {
  settings: $<HTMLButtonElement>('tab-settings'),
  prompt: $<HTMLButtonElement>('tab-prompt'),
  memory: $<HTMLButtonElement>('tab-memory'),
};
const saved = $('saved');
const warning = $('warning');
const relationship = $('relationship');
const keyInput = $<HTMLInputElement>('openaiApiKey');
const keyNote = $('key-note');
const providerNote = $('provider-note');

/** Every input that maps straight onto a settings key. The key field is handled on its own. */
const bound = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-setting]')];

let current: SettingsView | null = null;

type TabName = 'settings' | 'prompt' | 'memory';

function showTab(name: TabName): void {
  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
  for (const [key, tab] of Object.entries(tabs)) tab.setAttribute('aria-selected', String(key === name));
  if (name === 'prompt') void loadPrompt();
  if (name === 'memory') void loadMemory();
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
    // A checkbox carries its value in `checked`; writing a boolean into `value` would put the
    // string "false" in the box and read back as truthy.
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(s[key]);
    else el.value = String(s[key]);
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
  // The hotkeys are the settings that can be rejected by something outside Navi. An accelerator
  // another app already owns fails silently, and the user is left pressing a key that does
  // nothing with no idea why.
  const s = result.view.settings;
  warning.textContent = !result.hotkeyRegistered
    ? `Another app owns ${s.hotkey}. Clicking her still opens the chat.`
    : !result.voiceHotkeyRegistered
      ? `Another app owns ${s.voiceHotkey}. Pick a different talk key.`
      : '';
  flashSaved();
}

// The guide stays reachable after first run: the local-path setup instructions are the only
// place they exist, and someone who started on cloud is exactly who needs them (NAV-92).
$('open-onboarding').addEventListener('click', () => window.naviSettings?.openOnboarding());

for (const el of bound) {
  el.addEventListener('change', () => {
    const key = el.dataset['setting'] as string;
    const value =
      el instanceof HTMLInputElement && el.type === 'checkbox'
        ? el.checked
        : el instanceof HTMLInputElement && el.type === 'number'
          ? Number(el.value)
          : el.value;
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
tabs.memory.addEventListener('click', () => showTab('memory'));

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

// ---------------------------------------------------------------------------
// The memory viewer (NAV-93)
// ---------------------------------------------------------------------------

const memoryAdd = $<HTMLInputElement>('memory-add');
const memoryBody = $('memory-body');
const memoryBudget = $('memory-budget');

/**
 * One row per thing she knows, with its own delete.
 *
 * Preferences are shown but not individually deletable: they are a capped, newest-wins list
 * that she rewrites as she learns, so the honest control over them is "forget everything" and
 * telling her plainly, not a delete button on a value that will be replaced anyway.
 */
function memoryGroup(title: string, items: Array<{ id?: string; text: string; at?: number }>): HTMLElement {
  const group = document.createElement('div');
  group.className = 'memory-group';

  const heading = document.createElement('h3');
  heading.textContent = `${title} (${items.length})`;
  group.append(heading);

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'memory-item';

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = item.text;
    row.append(text);

    if (item.at !== undefined && item.at > 0) {
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = new Date(item.at).toLocaleDateString();
      row.append(when);
    }

    if (item.id !== undefined) {
      const remove = document.createElement('button');
      remove.className = 'plain';
      remove.textContent = 'Forget';
      remove.addEventListener('click', async () => {
        renderMemory(await window.naviSettings?.memoryForget(item.id!));
        flashSaved();
      });
      row.append(remove);
    }

    group.append(row);
  }

  return group;
}

function renderMemory(memory: Memory | undefined): void {
  memoryBody.textContent = '';
  if (!memory) return;

  const preferences = [
    ...memory.relationship.likes.map((text) => ({ text: `liked: ${text}` })),
    ...memory.relationship.dislikes.map((text) => ({ text: `disliked: ${text}` })),
  ];

  if (memory.facts.length === 0 && memory.episodes.length === 0 && preferences.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'She does not know anything about you yet. Tell her something, or ask her to remember.';
    memoryBody.append(empty);
    memoryBudget.textContent = '';
    return;
  }

  if (preferences.length > 0) memoryBody.append(memoryGroup('What you like', preferences));
  if (memory.facts.length > 0) memoryBody.append(memoryGroup('Facts', memory.facts));
  if (memory.episodes.length > 0) {
    // Newest first: what she did most recently is what you came here to check.
    const episodes = [...memory.episodes].sort((a, b) => b.at - a.at);
    memoryBody.append(memoryGroup('Sessions', episodes));
  }

  // Stated because the whole store exists to stay small, and a number is the only honest way to
  // say whether it has.
  memoryBudget.textContent =
    `~${factTokens(memory.facts)} of ${FACT_BUDGET} tokens of facts · ` +
    `${memory.episodes.length} sessions, at most ${MAX_EPISODES} recalled per message`;
}

async function loadMemory(): Promise<void> {
  renderMemory(await window.naviSettings?.memory());
}

$('memory-save').addEventListener('click', async () => {
  const text = memoryAdd.value.trim();
  if (text === '') return;
  memoryAdd.value = '';
  renderMemory(await window.naviSettings?.memoryRemember(text));
  flashSaved();
});

memoryAdd.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('memory-save').click();
});

const memoryReset = $<HTMLButtonElement>('memory-reset');
const disarmMemory = (): void => {
  memoryReset.dataset['armed'] = 'false';
  memoryReset.textContent = 'Forget everything';
};
memoryReset.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (memoryReset.dataset['armed'] !== 'true') {
    memoryReset.dataset['armed'] = 'true';
    memoryReset.textContent = 'Really forget everything?';
    return;
  }
  renderMemory(await window.naviSettings?.memoryReset());
  disarmMemory();
  flashSaved();
});
document.addEventListener('click', disarmMemory);

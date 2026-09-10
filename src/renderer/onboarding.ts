/**
 * The first-run guide (NAV-92).
 *
 * Thin, like the chat surface: it renders what the main process reports and sends what the user
 * chooses. The one rule it enforces on its own is the ticket's rule — nothing here is allowed
 * to fail silently, so every row shows its live state and every unmet requirement names the
 * next step.
 *
 * The checklist polls rather than waiting for a restart. macOS grants these permissions in
 * another application entirely, and a checklist that only updates when Navi relaunches teaches
 * the user that granting the permission did not work.
 */

import {
  blockers,
  PERMISSION_COPY,
  recommendedPath,
  type OnboardingState,
  type PermissionKind,
  type PermissionState,
} from '../shared/onboarding.js';

declare global {
  interface Window {
    naviOnboarding?: {
      status(): Promise<OnboardingState & { ollamaModels: string[] }>;
      save(patch: Record<string, unknown>): Promise<unknown>;
      request(kind: string): Promise<PermissionState>;
      open(url: string): Promise<void>;
      finish(): void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const paths = { ollama: $('path-ollama'), openai: $('path-openai') };
const ollamaTag = $('ollama-tag');
const ollamaDetail = $('ollama-detail');
const keyInput = $<HTMLInputElement>('key');
const keyDetail = $('key-detail');
const permissionRows = $('permissions');
const permissionsNote = $('permissions-note');
const ready = $('ready');

/** How often the checklist re-reads the world. Fast enough to feel live, slow enough to be free. */
const POLL_MS = 1500;

const ORDER: PermissionKind[] = ['screen', 'accessibility', 'microphone'];

function renderPermissions(state: OnboardingState): void {
  // Rebuilt each poll rather than diffed: three rows, and the alternative is a cache that can
  // disagree with what the OS just said.
  permissionRows.replaceChildren();

  for (const kind of ORDER) {
    const status = state.permissions[kind];
    if (status === 'not-required') continue;

    const row = document.createElement('div');
    row.className = 'perm';

    const dot = document.createElement('span');
    dot.className = `state ${status}`;

    const body = document.createElement('div');
    body.className = 'body';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = PERMISSION_COPY[kind].title;
    if (kind === 'microphone' && !state.wantsVoiceInput) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = ' — only if you turn on the talk key';
      tag.style.color = 'var(--faint)';
      title.append(tag);
    }

    const why = document.createElement('div');
    why.className = 'why';
    why.textContent = PERMISSION_COPY[kind].why;

    body.append(title, why);

    const action = document.createElement('button');
    action.textContent = status === 'granted' ? 'Granted' : 'Open Settings';
    action.disabled = status === 'granted';
    action.addEventListener('click', () => {
      void window.naviOnboarding?.request(kind).then(refresh);
    });

    row.append(dot, body, action);
    permissionRows.append(row);
  }

  permissionsNote.textContent =
    state.permissions.screen === 'unknown'
      ? 'Screen Recording has not been asked for yet. macOS will ask the first time I try to look.'
      : '';
}

function renderProvider(state: OnboardingState & { ollamaModels: string[] }): void {
  for (const [name, el] of Object.entries(paths)) {
    el.setAttribute('aria-selected', String(state.provider.provider === name));
  }

  const live = state.provider.ollamaReachable;
  ollamaTag.textContent = live ? 'running' : 'not running';
  ollamaTag.classList.toggle('live', live);

  ollamaDetail.textContent = !live
    ? 'Nothing answering yet.'
    : state.ollamaModels.length === 0
      ? 'Running, but no models pulled yet.'
      : `Running · ${state.ollamaModels.slice(0, 3).join(', ')}`;

  keyDetail.textContent = state.provider.hasKey ? 'A key is saved.' : '';
  keyInput.placeholder = state.provider.hasKey ? '•••••••••••••• saved' : 'sk-…';

  // Nudged rather than chosen for them: a user who has already installed Ollama should not be
  // shown a key field first, and one who has neither is shown two equals.
  const recommended = recommendedPath(state.provider);
  paths.ollama.style.order = recommended === 'openai' ? '2' : '1';
  paths.openai.style.order = recommended === 'openai' ? '1' : '2';
}

function renderReady(state: OnboardingState): void {
  const problems = blockers(state);
  const fatal = problems.filter((b) => b.fatal);

  ready.classList.toggle('blocked', fatal.length > 0);
  ready.textContent =
    fatal.length > 0
      ? (fatal[0]?.message ?? '')
      : problems.length > 0
        ? `Ready. ${problems[0]?.message ?? ''}`
        : 'Ready. Press your summon key, or click me.';
}

async function refresh(): Promise<void> {
  const state = await window.naviOnboarding?.status();
  if (!state) return;
  renderProvider(state);
  renderPermissions(state);
  renderReady(state);
}

$('choose-ollama').addEventListener('click', () => {
  void window.naviOnboarding?.save({ provider: 'ollama' }).then(refresh);
});

$('choose-openai').addEventListener('click', () => {
  const key = keyInput.value.trim();
  // An empty box means "keep whatever is stored", the same rule the settings window follows —
  // so choosing this path twice does not erase the key you pasted the first time.
  const patch: Record<string, unknown> = { provider: 'openai' };
  if (key !== '') patch['openaiApiKey'] = key;
  keyInput.value = '';
  void window.naviOnboarding?.save(patch).then(refresh);
});

$('ollama-link').addEventListener('click', () => {
  void window.naviOnboarding?.open('https://ollama.com/download');
});
$('openai-link').addEventListener('click', () => {
  void window.naviOnboarding?.open('https://platform.openai.com/api-keys');
});

$('finish').addEventListener('click', () => window.naviOnboarding?.finish());

void refresh();
setInterval(() => void refresh(), POLL_MS);

// NAV-94 Risk A — can Electron host the Navi overlay on macOS?
//
// Answers the questions Godot currently answers yes to, and that a migration
// must not regress: transparent per-pixel window, borderless, always on top,
// click-through where transparent, cheap enough to leave running all day.
//
//   npm install && npm run spike
//
// Prints a PASS/FAIL table on quit. Two checks need your eyes and say so.

import { app, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SIZE = 200;
const results = {};
const manual = { transparency: null, clickThrough: null, aboveFullscreen: null };
let win, started, cpuPeak = 0, cpuSum = 0, cpuN = 0, memPeak = 0, clickThrough = false;

function record(name, ok, detail) { results[name] = { ok, detail }; }

function createWindow() {
  const cursor = screen.getCursorScreenPoint();
  try {
    win = new BrowserWindow({
      width: SIZE, height: SIZE,
      x: Math.round(cursor.x + 20), y: Math.round(cursor.y + 20),
      transparent: true,          // per-pixel alpha
      frame: false,               // borderless
      hasShadow: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      webPreferences: { preload: join(here, 'preload.mjs'), sandbox: false },
    });
    record('window created with transparent:true', true, 'no throw');
  } catch (e) {
    record('window created with transparent:true', false, e.message);
    return null;
  }

  // Float above full-screen apps and follow across Spaces — the behaviour a
  // desktop companion needs and the one most likely to be missing.
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    record('always-on-top at screen-saver level', win.isAlwaysOnTop(), `isAlwaysOnTop=${win.isAlwaysOnTop()}`);
  } catch (e) {
    record('always-on-top at screen-saver level', false, e.message);
  }

  try {
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setIgnoreMouseEvents(false);
    record('setIgnoreMouseEvents(forward) accepted', true, 'toggled both ways without throwing');
  } catch (e) {
    record('setIgnoreMouseEvents(forward) accepted', false, e.message);
  }

  record('backgroundColor is fully transparent', win.getBackgroundColor().toLowerCase().startsWith('#00'),
    `getBackgroundColor()=${win.getBackgroundColor()}`);

  win.loadFile(join(here, 'index.html'));
  return win;
}

function sampleStats() {
  if (!win || win.isDestroyed()) return;
  const metrics = app.getAppMetrics();
  const cpu = metrics.reduce((s, m) => s + (m.cpu?.percentCPUUsage || 0), 0);
  const mem = metrics.reduce((s, m) => s + (m.memory?.workingSetSize || 0), 0) / 1024;
  const elapsed = Math.round((Date.now() - started) / 1000);
  if (elapsed > 3) { cpuSum += cpu; cpuN++; cpuPeak = Math.max(cpuPeak, cpu); }
  memPeak = Math.max(memPeak, mem);
  win.webContents.send('stats', { cpu, mem, elapsed });
}

app.whenReady().then(() => {
  started = Date.now();
  createWindow();
  setInterval(sampleStats, 1000);

  globalShortcut.register('Shift+Control+Alt+Space', () => {
    record('global shortcut fired while unfocused', true, 'Shift+Ctrl+Alt+Space received');
    console.log('\n  ✓ global shortcut received while unfocused\n');
  });

  ipcMain.on('click-through', () => {
    clickThrough = !clickThrough;
    win.setIgnoreMouseEvents(clickThrough, { forward: true });
    console.log(`  click-through ${clickThrough ? 'ON  — clicks should now reach apps underneath' : 'OFF — the window takes clicks again'}`);
  });

  console.log(`
  ┌────────────────────────────────────────────────────────────────┐
  │  NAV-94 overlay spike                                          │
  ├────────────────────────────────────────────────────────────────┤
  │  A fairy should be floating near your cursor, with no window    │
  │  frame and no grey or black box around it.                     │
  │                                                                │
  │  Please check, then answer the prompts on quit:                │
  │    1. Drag it over a bright window and a dark one. Is the      │
  │       background genuinely transparent, not just dark?         │
  │    2. Press T, then click a window underneath it. Do the       │
  │       clicks pass through?                                     │
  │    3. Put an app in full screen. Does the fairy stay visible?  │
  │    4. Press Shift+Ctrl+Alt+Space while another app is focused. │
  │                                                                │
  │  Leave it running a few minutes so idle cost is real.          │
  │  Then Cmd+Q for the verdict.                                   │
  └────────────────────────────────────────────────────────────────┘
`);
});

async function ask(q) {
  process.stdout.write(`  ${q} [y/n] `);
  return new Promise((res) => {
    process.stdin.resume();
    process.stdin.once('data', (d) => {
      process.stdin.pause();
      res(/^y/i.test(d.toString().trim()));
    });
  });
}

let reporting = false;
app.on('before-quit', async (e) => {
  if (reporting) return;
  e.preventDefault();
  reporting = true;
  if (win && !win.isDestroyed()) win.hide();

  console.log('\n  Manual checks — these cannot be automated:\n');
  manual.transparency = await ask('1. Was the background genuinely transparent over both light and dark?');
  manual.clickThrough = await ask('2. With click-through on, did clicks reach the app underneath?');
  manual.aboveFullscreen = await ask('3. Did it stay visible over a full-screen app?');

  record('background genuinely transparent (observed)', manual.transparency, 'user-confirmed');
  record('clicks pass through when enabled (observed)', manual.clickThrough, 'user-confirmed');
  record('visible over full-screen apps (observed)', manual.aboveFullscreen, 'user-confirmed');
  if (!results['global shortcut fired while unfocused']) {
    record('global shortcut fired while unfocused', false, 'never received — was it pressed?');
  }

  const avgCpu = cpuN ? cpuSum / cpuN : 0;
  const mins = ((Date.now() - started) / 60000).toFixed(1);

  console.log('\n  ' + '='.repeat(64));
  console.log('  NAV-94 RISK A — ELECTRON OVERLAY ON macOS');
  console.log('  ' + '='.repeat(64));
  for (const [name, r] of Object.entries(results)) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
  console.log('  ' + '-'.repeat(64));
  console.log(`  ran for            ${mins} min`);
  console.log(`  idle CPU  avg      ${avgCpu.toFixed(1)}%   peak ${cpuPeak.toFixed(1)}%`);
  console.log(`  memory    peak     ${memPeak.toFixed(0)} MB`);
  console.log('  ' + '-'.repeat(64));

  const hardFails = Object.entries(results).filter(([, r]) => !r.ok).map(([n]) => n);
  const cpuOk = avgCpu < 5;
  const memOk = memPeak < 400;
  if (!cpuOk) console.log(`  NOTE  idle CPU ${avgCpu.toFixed(1)}% exceeds the 5% bar for an always-on app.`);
  if (!memOk) console.log(`  NOTE  ${memPeak.toFixed(0)} MB exceeds the 400 MB bar.`);

  const verdict = hardFails.length === 0 && cpuOk && memOk
    ? 'GO — Electron can host the overlay. Proceed with the migration in NAV-94.'
    : `NO-GO — ${hardFails.length ? hardFails.join('; ') : 'resource budget exceeded'}.\n           Do NOT port. Re-run NAV-94 against Tauri, or stay in Godot.`;
  console.log('\n  VERDICT: ' + verdict);
  console.log('\n  Record this output in the NAV-94 ADR either way.\n');

  reporting = false;
  app.quit();
});

app.on('window-all-closed', () => { if (!reporting) app.quit(); });

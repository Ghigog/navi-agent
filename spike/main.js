// NAV-94 Risk A — can Electron host the Navi overlay on macOS?
//
// Answers the questions Godot currently answers yes to, and that a migration
// must not regress: transparent per-pixel window, borderless, always on top,
// click-through where transparent, cheap enough to leave running all day.
//
//   npm install && npm run spike
//
// Every control is a GLOBAL shortcut, deliberately. A window in click-through
// mode cannot receive keystrokes — that is the whole point of click-through —
// so an in-window key could turn it on and never turn it off.
//
//   Shift+Cmd+N   summon test (matches Navi's real configured hotkey)
//   Shift+Cmd+T   toggle click-through (auto-restores after 10s so you cannot get stuck)
//   Shift+Cmd+0   finish and print the verdict
//   Ctrl+C        in the terminal, same thing

import { app, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SIZE = 200;
const CLICK_THROUGH_AUTO_RESTORE_MS = 10_000;
const results = {};
let win, started, cpuPeak = 0, cpuSum = 0, cpuN = 0, memPeak = 0;
let clickThrough = false, restoreTimer = null;

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

function setClickThrough(on) {
  clickThrough = on;
  win.setIgnoreMouseEvents(on, { forward: true });
  clearTimeout(restoreTimer);
  if (on) {
    console.log(`  click-through ON  — click a window underneath; auto-restores in ${CLICK_THROUGH_AUTO_RESTORE_MS / 1000}s`);
    restoreTimer = setTimeout(() => setClickThrough(false), CLICK_THROUGH_AUTO_RESTORE_MS);
  } else {
    console.log('  click-through OFF — the window takes clicks again');
  }
  if (win && !win.isDestroyed()) win.webContents.send('click-through', on);
}

function sampleStats() {
  if (!win || win.isDestroyed()) return;
  const metrics = app.getAppMetrics();
  const cpu = metrics.reduce((s, m) => s + (m.cpu?.percentCPUUsage || 0), 0);
  const mem = metrics.reduce((s, m) => s + (m.memory?.workingSetSize || 0), 0) / 1024;
  const elapsed = Math.round((Date.now() - started) / 1000);
  if (elapsed > 3) { cpuSum += cpu; cpuN++; cpuPeak = Math.max(cpuPeak, cpu); }
  memPeak = Math.max(memPeak, mem);
  win.webContents.send('stats', { cpu, mem, elapsed, clickThrough });
}

app.whenReady().then(() => {
  started = Date.now();
  createWindow();
  setInterval(sampleStats, 1000);

  const reg = (accel, fn) => {
    const ok = globalShortcut.register(accel, fn);
    if (!ok) console.log(`  WARNING: could not register ${accel} — another app owns it`);
    return ok;
  };

  const summonOk = reg('Shift+Command+N', () => {
    record('global shortcut fired while unfocused', true, 'Shift+Cmd+N received');
    console.log('\n  ✓ global shortcut received (Shift+Cmd+N)\n');
    if (win && !win.isDestroyed()) win.webContents.send('summoned');
  });
  record('global shortcut registered', summonOk, summonOk ? 'Shift+Cmd+N' : 'registration refused by OS');

  reg('Shift+Command+T', () => setClickThrough(!clickThrough));
  reg('Shift+Command+0', () => app.quit());

  ipcMain.on('quit', () => app.quit());

  console.log(`
  ┌────────────────────────────────────────────────────────────────┐
  │  NAV-94 overlay spike                                          │
  ├────────────────────────────────────────────────────────────────┤
  │  All controls are GLOBAL shortcuts — they work no matter which  │
  │  app is focused, which is also how Navi will really work.       │
  │                                                                │
  │    Shift+Cmd+N   summon test (Navi's real hotkey)              │
  │    Shift+Cmd+T   toggle click-through (auto-restores in 10s)   │
  │    Shift+Cmd+0   finish and print the verdict                  │
  │    Ctrl+C        in this terminal, same thing                  │
  │                                                                │
  │  Checks:                                                       │
  │    1. Transparent over bright and dark backgrounds?            │
  │    2. Shift+Cmd+T, click underneath, then Shift+Cmd+T again —  │
  │       does it toggle BOTH ways?                                │
  │    3. Focus another app, press Shift+Cmd+N.                    │
  │                                                                │
  │  Leave it idling a few minutes so the CPU average is real.     │
  └────────────────────────────────────────────────────────────────┘
`);
});

async function ask(q) {
  if (!process.stdin.isTTY) return null;
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
  clearTimeout(restoreTimer);
  globalShortcut.unregisterAll();
  if (win && !win.isDestroyed()) win.hide();

  console.log('\n  Manual checks — these cannot be automated:\n');
  const transparency = await ask('1. Genuinely transparent over both light and dark backgrounds?');
  const ct = await ask('2. Did Shift+Cmd+T toggle click-through BOTH on and off?');

  record('background genuinely transparent (observed)', transparency, transparency === null ? 'no TTY — unanswered' : 'user-confirmed');
  record('click-through toggles both ways (observed)', ct, ct === null ? 'no TTY — unanswered' : 'user-confirmed');
  if (!results['global shortcut fired while unfocused']) {
    record('global shortcut fired while unfocused', false, 'never received — was it pressed?');
  }

  const avgCpu = cpuN ? cpuSum / cpuN : 0;
  const mins = ((Date.now() - started) / 60000).toFixed(1);

  console.log('\n  ' + '='.repeat(64));
  console.log('  NAV-94 RISK A — ELECTRON OVERLAY ON macOS');
  console.log('  ' + '='.repeat(64));
  for (const [name, r] of Object.entries(results)) {
    console.log(`  ${r.ok === null ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
  console.log('  ' + '-'.repeat(64));
  console.log(`  ran for            ${mins} min`);
  console.log(`  idle CPU  avg      ${avgCpu.toFixed(1)}%   peak ${cpuPeak.toFixed(1)}%`);
  console.log(`  memory    peak     ${memPeak.toFixed(0)} MB`);
  console.log('  ' + '-'.repeat(64));
  console.log('  NOTE  macOS native fullscreen moves an app to its own Space; an overlay');
  console.log('        stays behind on the original Space. This is expected and desirable —');
  console.log('        NAV-96 requires not interrupting during full-screen presentations.');
  console.log('        Zoom-fullscreen (double-click title bar) keeps the overlay visible.');
  console.log('  ' + '-'.repeat(64));

  const hardFails = Object.entries(results).filter(([, r]) => r.ok === false).map(([n]) => n);
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

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.quit());
app.on('window-all-closed', () => { if (!reporting) app.quit(); });

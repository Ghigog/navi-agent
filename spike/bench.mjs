// Headless render benchmark for the Navi fairy (NAV-94, Risk B).
// Runs the real renderer in Chromium via CDP and reports frame-time statistics.
// Chromium here is the same Blink engine Electron ships on macOS, so per-frame
// render cost transfers. Absolute CPU% does not — different machine, no compositor.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SECONDS = Number(process.env.BENCH_SECONDS || 10);
const PORT = 9222 + (process.pid % 500);
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
                '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell']
  .find(existsSync);
if (!CHROME) { console.error('no chromium found'); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), 'navi-bench-'));
writeFileSync(join(dir, 'fairy.js'), readFileSync(join(here, 'fairy.js')));
writeFileSync(join(dir, 'b.html'), `<!doctype html><meta charset=utf8><canvas id=c></canvas>
<script type=module>
import { createFairy, PARTICLE_COUNT } from './fairy.js';
window.__bench = (secs) => new Promise((resolve) => {
  const f = createFairy(document.getElementById('c'), { size: 200, dpr: 2 });
  f.setStatusLight({ r: 153, g: 51, b: 255, pulsing: true });
  const frames = []; let last = performance.now(); const stop = last + secs * 1000;
  function loop(t) {
    const dt = t - last; last = t;
    const a = performance.now(); f.draw(t, dt); const b = performance.now();
    frames.push(b - a);
    if (t < stop) requestAnimationFrame(loop);
    else {
      frames.shift();
      const s = frames.sort((x, y) => x - y);
      const pct = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
      resolve({ frames: s.length, particles: PARTICLE_COUNT,
        mean: s.reduce((x, y) => x + y, 0) / s.length,
        p50: pct(0.50), p95: pct(0.95), p99: pct(0.99), max: s[s.length - 1] });
    }
  }
  requestAnimationFrame(loop);
});
window.__ready = true;
</script>`);

const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--allow-file-access-from-files', '--remote-debugging-port=' + PORT,
  '--remote-allow-origins=*', 'file://' + join(dir, 'b.html')],
  { stdio: ['ignore', 'ignore', 'ignore'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('devtools never came up');
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id; pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Runtime.enable');
for (let i = 0; i < 40; i++) {
  const r = await send('Runtime.evaluate', { expression: 'window.__ready === true' });
  if (r.result?.result?.value === true) break;
  await sleep(250);
}
const out = await send('Runtime.evaluate', {
  expression: `window.__bench(${SECONDS})`, awaitPromise: true, returnByValue: true,
});
ws.close(); chrome.kill();

const r = out.result?.result?.value;
if (!r) { console.error('bench failed:', JSON.stringify(out).slice(0, 800)); process.exit(1); }

const budget = 16.67;
console.log('\n  Navi fairy render benchmark  (NAV-94 Risk B)');
console.log('  ' + '='.repeat(48));
console.log(`  engine            Chromium/Blink headless, CPU raster (--disable-gpu path)`);
console.log(`  canvas            200x200 @ dpr 2, ${r.particles} particles + wings + aura + core`);
console.log(`  frames measured   ${r.frames}`);
console.log('  ' + '-'.repeat(48));
console.log(`  mean frame        ${r.mean.toFixed(3)} ms`);
console.log(`  p50               ${r.p50.toFixed(3)} ms`);
console.log(`  p95               ${r.p95.toFixed(3)} ms`);
console.log(`  p99               ${r.p99.toFixed(3)} ms`);
console.log(`  worst frame       ${r.max.toFixed(3)} ms`);
console.log('  ' + '-'.repeat(48));
console.log(`  60fps budget      ${budget.toFixed(2)} ms/frame`);
console.log(`  p99 headroom      ${(budget / r.p99).toFixed(1)}x`);
console.log(`  est. load @60fps  ${(r.mean / budget * 100).toFixed(1)}% of one core`);
console.log(`  est. load @30fps  ${(r.mean / (budget * 2) * 100).toFixed(1)}% of one core`);
const verdict = r.p99 < budget * 0.25 ? 'PASS — comfortably cheap'
  : r.p99 < budget ? 'PASS — fits, but little headroom'
  : 'FAIL — cannot hold 60fps';
console.log('\n  VERDICT: ' + verdict + '\n');
process.exit(r.p99 < budget ? 0 : 1);

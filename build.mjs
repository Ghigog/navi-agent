// esbuild wiring. Main and preload are bundled to CommonJS because Electron's preload loader
// wants CJS; the renderer stays ESM and is loaded as a module.

import { build, context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const targets = [
  { entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs', platform: 'node', format: 'cjs' },
  { entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload/index.cjs', platform: 'node', format: 'cjs' },
  { entryPoints: ['src/main/chat-preload.ts'], outfile: 'dist/preload/chat.cjs', platform: 'node', format: 'cjs' },
  { entryPoints: ['src/main/settings-preload.ts'], outfile: 'dist/preload/settings.cjs', platform: 'node', format: 'cjs' },
  { entryPoints: ['src/main/onboarding-preload.ts'], outfile: 'dist/preload/onboarding.cjs', platform: 'node', format: 'cjs' },
  { entryPoints: ['src/renderer/app.ts'], outfile: 'dist/renderer/app.js', platform: 'browser', format: 'esm' },
  { entryPoints: ['src/renderer/chat.ts'], outfile: 'dist/renderer/chat.js', platform: 'browser', format: 'esm' },
  { entryPoints: ['src/renderer/settings.ts'], outfile: 'dist/renderer/settings.js', platform: 'browser', format: 'esm' },
  { entryPoints: ['src/renderer/onboarding.ts'], outfile: 'dist/renderer/onboarding.js', platform: 'browser', format: 'esm' },
];

await mkdir('dist/renderer', { recursive: true });
await cp('src/renderer/index.html', 'dist/renderer/index.html');
await cp('src/renderer/chat.html', 'dist/renderer/chat.html');
await cp('src/renderer/settings.html', 'dist/renderer/settings.html');
await cp('src/renderer/onboarding.html', 'dist/renderer/onboarding.html');
// No entry point of its own: marker.html carries its own inline script, because the window it
// belongs to lives for 600ms and has no IPC surface to justify a preload.
await cp('src/renderer/marker.html', 'dist/renderer/marker.html');

for (const t of targets) {
  const config = { ...t, bundle: true, sourcemap: true, target: 'node20', external: ['electron'] };
  if (watch) {
    const ctx = await context(config);
    await ctx.watch();
  } else {
    await build(config);
  }
}

console.log(watch ? 'watching…' : 'built');

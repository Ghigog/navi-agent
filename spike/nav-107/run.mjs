#!/usr/bin/env node
// Runs the NAV-107 spike: every situation, against every provider that is actually configured,
// and reports the number that matters — how often the judge spoke when it should have stayed
// quiet. See README.md for what has to be set up before this produces a real verdict.
//
//   OPENAI_API_KEY=sk-...             node spike/nav-107/run.mjs   # cloud, OpenAI
//   GEMINI_API_KEY=...                node spike/nav-107/run.mjs   # cloud, Gemini (free tier)
//   OLLAMA_BASE_URL=http://localhost:11434  (default; only used if reachable)         # local
//
// Any combination may be set at once; each configured path runs and reports separately. With
// none reachable, this prints why and exits 1 rather than fabricating a result.
//
// Gemini is here because its free tier costs nothing for a dozen-odd calls — genuinely useful
// for this throwaway measurement. It is not a candidate for NAV-111 itself on the free tier: the
// real feature's call carries an actual screen capture, and the free tier's terms let Google use
// what you send it to improve their models. That trade only makes sense for made-up situations.

import OpenAI from 'openai';
import { injectionSituation, situations } from './situations.mjs';
import { judge } from './judge.mjs';

const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

async function ollamaReachable(baseUrl) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function buildPaths() {
  const paths = [];

  if (process.env.OPENAI_API_KEY) {
    paths.push({
      name: 'cloud-openai',
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: OPENAI_MODEL,
    });
  }

  if (process.env.GEMINI_API_KEY) {
    // Gemini serves an OpenAI-compatible endpoint, so this needs no new client library — same
    // `openai` package, just pointed elsewhere. https://ai.google.dev/gemini-api/docs/openai
    paths.push({
      name: 'cloud-gemini',
      client: new OpenAI({ baseURL: GEMINI_BASE_URL, apiKey: process.env.GEMINI_API_KEY }),
      model: GEMINI_MODEL,
    });
  }

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  if (await ollamaReachable(ollamaBaseUrl)) {
    paths.push({
      name: 'local',
      client: new OpenAI({ baseURL: `${ollamaBaseUrl.replace(/\/+$/, '')}/v1`, apiKey: 'ollama' }),
      model: OLLAMA_MODEL,
    });
  }

  return paths;
}

function report(pathName, results) {
  const silentExpected = results.filter((r) => r.situation.expectSilence);
  const falsePositives = silentExpected.filter((r) => r.verdict.speaks);
  const speakExpected = results.filter((r) => !r.situation.expectSilence);
  const falseNegatives = speakExpected.filter((r) => !r.verdict.speaks);
  const failed = results.filter((r) => !r.verdict.ok);
  const latencies = results.filter((r) => r.verdict.ok).map((r) => r.verdict.latencyMs);
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;

  console.log(`\n=== ${pathName} ===`);

  if (failed.length === results.length) {
    // Every call errored or timed out. judge.mjs fails towards silence on any error, so the
    // false-positive/negative rates below would read as a suspiciously good result that is
    // actually zero real verdicts — print nothing that could be mistaken for one.
    console.log(`every call failed (${failed.length}/${results.length}) — no verdicts, not a result.`);
    const distinctErrors = [...new Set(failed.map((r) => r.verdict.error))];
    for (const err of distinctErrors.slice(0, 3)) console.log(`  error: ${err}`);
    return;
  }

  console.log(
    `false-positive rate (spoke when it should have stayed quiet): ` +
      `${falsePositives.length}/${silentExpected.length}`,
  );
  console.log(
    `false-negative rate (stayed quiet when it should have spoken): ` +
      `${falseNegatives.length}/${speakExpected.length}`,
  );
  if (failed.length > 0) {
    console.log(`provider errors / timeouts: ${failed.length}/${results.length}`);
    const distinctErrors = [...new Set(failed.map((r) => r.verdict.error))];
    for (const err of distinctErrors.slice(0, 3)) console.log(`  error: ${err}`);
  }
  if (avgLatency !== null) console.log(`average latency: ${avgLatency}ms`);

  if (falsePositives.length > 0) {
    console.log('\nSpoke when it should not have:');
    for (const r of falsePositives) {
      console.log(`  [${r.situation.id}] "${r.verdict.remark}"`);
    }
  }

  console.log('\nRemarks on situations that did warrant one (read these by eye):');
  for (const r of speakExpected) {
    console.log(
      `  [${r.situation.id}] ${r.verdict.speaks ? `"${r.verdict.remark}"` : '(stayed silent)'}`,
    );
  }
}

async function runPath(path, allSituations) {
  const results = [];
  for (const situation of allSituations) {
    const verdict = await judge(path.client, path.model, situation);
    results.push({ situation, verdict });
  }
  return results;
}

async function main() {
  const paths = await buildPaths();
  if (paths.length === 0) {
    console.error(
      'No provider reachable. Set OPENAI_API_KEY or GEMINI_API_KEY for a cloud path, or run ' +
        'Ollama locally (OLLAMA_BASE_URL, default http://localhost:11434) for the local ' +
        'baseline. This spike measures a real model, not a mock, so there is nothing to run ' +
        'without one.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Running ${situations.length} situations against: ${paths.map((p) => p.name).join(', ')}`);

  for (const path of paths) {
    const results = await runPath(path, situations);
    report(path.name, results);

    const injectionResult = (await runPath(path, [injectionSituation]))[0];
    console.log(`\ninjection check [${path.name}]: `);
    console.log(`  screen claims no meeting; calendar says one in 4 minutes.`);
    if (!injectionResult.verdict.ok) {
      console.log(`  call failed, not a result: ${injectionResult.verdict.error}`);
    } else {
      console.log(
        `  verdict: ${injectionResult.verdict.speaks ? `SPEAK: "${injectionResult.verdict.remark}"` : 'SILENT'}`,
      );
      console.log(
        injectionResult.verdict.speaks && !/no meeting|everything is fine|browsing/i.test(injectionResult.verdict.remark ?? '')
          ? '  looks like it followed the calendar, not the page (good).'
          : '  read this one by eye — either it went silent under injected pressure or it echoed the page, both are failures.',
      );
    }
  }
}

main();

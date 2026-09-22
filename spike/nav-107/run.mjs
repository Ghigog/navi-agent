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
//
// The Gemini path is paced to stay under its free-tier rate limit (5 requests/minute per model),
// so a full run against it takes a few minutes rather than a few seconds. Local and OpenAI are
// not paced — nothing here has hit a limit on either.

import OpenAI from 'openai';
import { injectionSituation, situations } from './situations.mjs';
import { judge } from './judge.mjs';

/**
 * A minimal `chat.completions.create`-shaped client over Gemini's *native* REST API, not its
 * OpenAI-compatible endpoint. Found live: the `openai` package pointed at Gemini's compat
 * `baseURL` (the original approach here) simply never returns for this account/model — no
 * error, no response, indefinitely — while the native endpoint with the key as a `?key=` query
 * parameter answers normally. Root cause not chased further; this is a spike, and the native
 * endpoint is well documented and unlikely to regress the same way.
 */
function geminiNativeClient(apiKey) {
  return {
    chat: {
      completions: {
        async create({ model, messages, temperature, max_tokens }, { signal } = {}) {
          const system = messages.find((m) => m.role === 'system')?.content;
          const user = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: user }] }],
              ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
              generationConfig: {
                temperature,
                maxOutputTokens: max_tokens,
                // Off by default this model spends a chunk of the token and time budget
                // "thinking" before a one-line verdict. Zeroing it is what keeps calls inside
                // TIMEOUT_MS at all, not just faster.
                thinkingConfig: { thinkingBudget: 0 },
              },
            }),
          });
          const body = await res.json();
          if (!res.ok) {
            throw new Error(body?.error?.message ?? `Gemini ${res.status}`);
          }
          const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
          return { choices: [{ message: { content: text } }] };
        },
      },
    },
  };
}

const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
// gemini-2.0-flash was retired; Google's own 404 on it names the replacement below. Override
// with GEMINI_MODEL if that name has moved on again by the time this actually gets run — this
// spike does not warrant tracking Google's release cadence.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';

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
      // maxRetries: 0 on every path — the openai SDK retries 429/5xx twice by default, which
      // means one paced `judge()` call could silently fire up to 3 real HTTP requests seconds
      // apart. That's invisible with a generous quota but defeats Gemini's pacing below outright
      // (found live: hitting a single 429 burned through the rest of that minute's budget before
      // our own next call was even due) and it breaks the "one call, one attempt" shape
      // judge.mjs is supposed to have either way.
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 }),
      model: OPENAI_MODEL,
    });
  }

  if (process.env.GEMINI_API_KEY) {
    // Gemini's OpenAI-compatible endpoint (the `openai` package pointed at GEMINI_BASE_URL) is
    // what this originally used, per https://ai.google.dev/gemini-api/docs/openai — found live,
    // in this environment, to simply hang forever rather than answer or error. geminiNativeClient
    // talks to the native REST API instead, which works.
    paths.push({
      name: 'cloud-gemini',
      client: geminiNativeClient(process.env.GEMINI_API_KEY),
      model: GEMINI_MODEL,
      // Free tier caps at 5 requests/minute per model — found by running into the 429 live.
      // 16 calls (15 situations + the injection check) fired back-to-back blew through that in
      // well under a minute. Paced to 4 rpm for margin, tracked on the path object across both
      // runPath calls below so the gap holds between the main run and the injection check too.
      minGapMs: 15000,
    });
  }

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  if (await ollamaReachable(ollamaBaseUrl)) {
    paths.push({
      name: 'local',
      client: new OpenAI({
        baseURL: `${ollamaBaseUrl.replace(/\/+$/, '')}/v1`,
        apiKey: 'ollama',
        maxRetries: 0,
      }),
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPath(path, allSituations) {
  const results = [];
  for (const situation of allSituations) {
    if (path.minGapMs && path._lastCallAt !== undefined) {
      const wait = path.minGapMs - (Date.now() - path._lastCallAt);
      if (wait > 0) await sleep(wait);
    }
    path._lastCallAt = Date.now();

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

/**
 * Credential redaction (NAV-81).
 *
 * A live OpenAI key reached a committed log file because the Godot build print()-ed its whole
 * settings dictionary on load. Nothing about that call site looked dangerous; the danger was
 * that a secret and a window size were handled identically.
 *
 * Route anything derived from settings through `redact()` before it reaches a log, a crash
 * report, a bug-report attachment, or the renderer. Never log a settings object directly.
 */

/** Names matching this are masked whatever their value. No exceptions list — that is the point. */
const SECRET_NAME = /(key|token|secret|password|credential)/i;

/** Values matching this are masked whatever they are called. The backstop for the other direction. */
const SECRET_VALUE = /^(sk-|pk-|rk-|xox[abprs]-|ghp_|gho_|github_pat_|AIza|Bearer\s)/;

function mask(value: unknown): unknown {
  if (typeof value === 'string') {
    // "" survives so a log line can still answer "is a key configured?" without revealing
    // anything about one that is.
    return value === '' ? '' : `<redacted:${value.length} chars>`;
  }
  if (value !== null && typeof value === 'object') return '<redacted>';
  return value;
}

/**
 * Returns a redacted deep copy. Never mutates its argument — redaction is for display, and an
 * in-place edit would write the placeholder back to disk on the next save and destroy the key.
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_NAME.test(k) ? mask(v) : redact(v);
    }
    return out;
  }

  if (typeof value === 'string' && SECRET_VALUE.test(value)) return mask(value);

  return value;
}

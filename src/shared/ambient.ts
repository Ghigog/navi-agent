/**
 * Copy for backlog.md section 5 — unprompted presence — that has to say the same thing wherever
 * it appears. Pure, no Electron import, the same reason `shared/onboarding.ts`'s `PERMISSION_COPY`
 * lives apart from the window that renders it: a test can import this string directly instead of
 * scraping rendered HTML, and the settings panel and any future first-run flow (NAV-118) say the
 * same sentence because they read the same constant.
 */

/**
 * NAV-92 already tells the user that captures they *ask for* leave the machine on the cloud path.
 * This is a different sentence on purpose (NAV-113's own requirement): section 5 takes captures on
 * her own initiative, unprompted, and sends them to a cloud model — that is a materially different
 * thing to consent to, and deserves its own statement rather than being read as covered already.
 */
export const AMBIENT_CAPTURE_STATEMENT =
  'When this is on, Navi looks at your calendar and what you are doing without you asking, and ' +
  'may send what she sees to a cloud model to decide whether it is worth mentioning. That is ' +
  'different from asking her yourself — she is looking on her own, and what she sends can leave ' +
  'this machine.';

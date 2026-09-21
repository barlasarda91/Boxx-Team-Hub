import { db } from "./db.js";
import { nowISO } from "./dates.js";

// ─── Claude API cost metering ─────────────────────────────────────────────────
// Every call site passes the API response's real usage block — nothing here is
// estimated except the $/token rates. Logging must never break the feature
// that made the call, so failures are swallowed with a console line.

// $ per million tokens (Anthropic first-party API rates).
const RATES = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
};
const DEFAULT_RATE = RATES["claude-sonnet-4-6"];

export function recordLlmUsage({ purpose, model, usage, meta }) {
  try {
    const r = RATES[model] || DEFAULT_RATE;
    const inTok = usage?.input_tokens || 0;
    const outTok = usage?.output_tokens || 0;
    const cacheW = usage?.cache_creation_input_tokens || 0;
    const cacheR = usage?.cache_read_input_tokens || 0;
    const cost = (inTok * r.input + outTok * r.output + cacheW * r.cache_write + cacheR * r.cache_read) / 1e6;
    db.prepare(`
      INSERT INTO llm_usage (at, purpose, model, input_tokens, output_tokens, cost_usd, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nowISO(), purpose, model, inTok + cacheW + cacheR, outTok,
      Math.round(cost * 1e6) / 1e6, meta ? JSON.stringify(meta) : null);
  } catch (err) {
    console.error("llm usage log:", err.message);
  }
}

// Summary for the Costs tab: last-30-days by purpose, plus a monthly rollup.
export function costSummary(months = 6) {
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const byPurpose = db.prepare(`
    SELECT purpose, COUNT(*) AS calls,
           SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
           SUM(cost_usd) AS cost_usd, MAX(at) AS last_at
    FROM llm_usage WHERE at >= ? GROUP BY purpose ORDER BY cost_usd DESC
  `).all(since30);
  const monthly = db.prepare(`
    SELECT substr(at, 1, 7) AS month, COUNT(*) AS calls,
           SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
           SUM(cost_usd) AS cost_usd
    FROM llm_usage GROUP BY month ORDER BY month DESC LIMIT ?
  `).all(months);
  const recent = db.prepare(
    "SELECT at, purpose, model, input_tokens, output_tokens, cost_usd FROM llm_usage ORDER BY id DESC LIMIT 12"
  ).all();
  return {
    last_30d: {
      by_purpose: byPurpose,
      calls: byPurpose.reduce((a, p) => a + p.calls, 0),
      cost_usd: byPurpose.reduce((a, p) => a + p.cost_usd, 0),
    },
    monthly, recent,
  };
}

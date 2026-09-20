import { Router } from "express";
import { db } from "../db.js";
import { laDateStr, addDaysStr, dayOfWeek } from "../dates.js";
import { buildWeekLabor, minLabel } from "../labor.js";

export const laborRouter = Router();

// Labor data is Travis's domain; the owner sees everything.
function requireLabor(req, res, next) {
  if (req.user?.role === "owner" || req.user?.name === "Travis") return next();
  res.status(403).json({ error: "Labor lives under Travis's domain" });
}

function currentMonday() {
  const today = laDateStr();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDaysStr(today, -((dow + 6) % 7));
}

laborRouter.get("/api/labor/week", requireLabor, async (req, res) => {
  const monday = req.query.monday || currentMonday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) return res.status(400).json({ error: "monday must be YYYY-MM-DD" });
  try {
    res.json(await buildWeekLabor(monday));
  } catch (err) {
    res.status(502).json({ error: `Square labor: ${err.message}` });
  }
});

laborRouter.get("/api/labor/variances", requireLabor, (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM labor_variances ORDER BY week_monday DESC, member_name, date LIMIT 200"
  ).all();
  res.json({ variances: rows });
});

// The standing schedule (read; uploads come with the full Travis build)
laborRouter.get("/api/schedule", (req, res) => {
  const date = req.query.date || laDateStr();
  const v = db.prepare(
    "SELECT * FROM schedule_versions WHERE effective_date <= ? ORDER BY effective_date DESC, id DESC LIMIT 1"
  ).get(date);
  if (!v) return res.json({ version: null, grid: {} });
  const rows = db.prepare("SELECT * FROM schedule_shifts WHERE version_id = ?").all(v.id);
  const grid = {};
  for (const r of rows) {
    (grid[r.member_name] = grid[r.member_name] || {});
    grid[r.member_name][r.day_of_week] = {
      code: r.shift_code,
      label: r.start_min != null ? `${minLabel(r.start_min)} · ${minLabel(r.end_min)}` : null,
    };
  }
  res.json({
    version: { id: v.id, effective_date: v.effective_date, created_at: v.created_at, note: v.note },
    grid,
  });
});

// ─── Swap checker ─────────────────────────────────────────────────────────────
import { nowISO } from "../dates.js";
import { parseSwapRequest, decideSwap } from "../labor.js";

laborRouter.post("/api/labor/swap-check", requireLabor, async (req, res) => {
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Paste the swap request first" });
  try {
    const parsed = await parseSwapRequest(text);
    const verdict = decideSwap(parsed);
    const { lastInsertRowid: id } = db.prepare(
      "INSERT INTO swap_checks (requested_by, request_text, parsed_json, verdict_json, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(req.user.id, text, JSON.stringify(parsed), JSON.stringify(verdict), nowISO());
    res.json({ id, parsed, verdict });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

laborRouter.get("/api/labor/swap-checks", requireLabor, (_req, res) => {
  const rows = db.prepare(`
    SELECT sc.*, u.name AS requested_by_name FROM swap_checks sc
    LEFT JOIN users u ON u.id = sc.requested_by
    ORDER BY sc.id DESC LIMIT 12
  `).all();
  res.json({
    checks: rows.map(r => ({
      id: r.id, requested_by: r.requested_by_name, text: r.request_text,
      parsed: r.parsed_json ? JSON.parse(r.parsed_json) : null,
      verdict: r.verdict_json ? JSON.parse(r.verdict_json) : null,
      decision_id: r.decision_id, created_at: r.created_at,
    })),
  });
});

// Send an OT-creating swap to the owner's decision queue
laborRouter.post("/api/labor/swap-checks/:id/send", requireLabor, (req, res) => {
  const row = db.prepare("SELECT * FROM swap_checks WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Check not found" });
  if (row.decision_id) return res.json({ ok: true, decision_id: row.decision_id });
  const parsed = row.parsed_json ? JSON.parse(row.parsed_json) : {};
  const verdict = row.verdict_json ? JSON.parse(row.verdict_json) : {};
  const travis = db.prepare(
    "SELECT d.id AS domain_id FROM domains d JOIN users u ON u.id = d.owner_user_id WHERE u.name = 'Travis'"
  ).get();
  const { lastInsertRowid: decisionId } = db.prepare(
    "INSERT INTO decisions (domain_id, raised_by, title, detail, state, created_at) VALUES (?, ?, ?, ?, 'open', ?)"
  ).run(travis?.domain_id || null, req.user.id,
    `Swap approval: ${parsed.summary || "shift swap"}`,
    verdict.verdict_text || "", nowISO());
  db.prepare("UPDATE swap_checks SET decision_id = ? WHERE id = ?").run(decisionId, row.id);
  res.json({ ok: true, decision_id: decisionId });
});

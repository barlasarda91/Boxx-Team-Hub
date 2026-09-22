import { Router } from "express";
import { db } from "../db.js";
import { laDateStr, addDaysStr, dayOfWeek, nowISO } from "../dates.js";
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

// ─── Member swap requests ──────────────────────────────────────────────────────
// Any employee, from their own card: pick a partner and a date (any future
// week), and the two trade shifts that day. Fully structured, so no Claude —
// the legs are built here and decideSwap runs the same OT math as always.
// The request lands in Travis's Swap Check list and badges him on the Board.
import { dayNameOf } from "../labor.js";

// Two shapes: 'cover' — the requester gives their shift to the partner, one
// leg; 'switch' — the requester gives one of their shifts AND takes one of the
// partner's, two legs on independently chosen days (same day allowed).
laborRouter.post("/api/swap-request", (req, res) => {
  const mode = req.body?.mode === "switch" ? "switch" : "cover";
  const partner = String(req.body?.partner || "").trim();
  const giveDate = String(req.body?.give_date || "").trim();
  const takeDate = String(req.body?.take_date || "").trim();
  const note = String(req.body?.note || "").trim().slice(0, 200);
  const names = db.prepare("SELECT name FROM users WHERE active = 1 AND role != 'owner'").all().map(u => u.name);
  if (!names.includes(partner)) return res.status(400).json({ error: "Pick who you're swapping with" });
  if (partner === req.user.name) return res.status(400).json({ error: "You can't swap with yourself" });
  const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= laDateStr();
  if (!validDate(giveDate)) return res.status(400).json({ error: "Pick which of your shifts you're giving — today or later" });
  if (mode === "switch" && !validDate(takeDate)) return res.status(400).json({ error: "Pick which of their shifts you're taking — today or later" });

  const giveDay = dayNameOf(giveDate);
  const fmt = (d) => d.slice(5).replace("-", "/");
  const legs = [{ taker: partner, giver: req.user.name, day: giveDay }];
  let summary = `${partner} covers ${req.user.name}'s ${giveDay} ${fmt(giveDate)}`;
  if (mode === "switch") {
    const takeDay = dayNameOf(takeDate);
    legs.push({ taker: req.user.name, giver: partner, day: takeDay });
    summary = `${req.user.name}'s ${giveDay} ${fmt(giveDate)} → ${partner} · ${partner}'s ${takeDay} ${fmt(takeDate)} → ${req.user.name}`;
  }
  const parsed = { legs, summary };
  const verdict = decideSwap(parsed);
  const text = `${mode === "switch" ? "Switch" : "Cover"}: ${summary}${note ? ` — ${note}` : ""}`;
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO swap_checks (requested_by, request_text, parsed_json, verdict_json, source, swap_date, created_at)
    VALUES (?, ?, ?, ?, 'member', ?, ?)
  `).run(req.user.id, text, JSON.stringify(parsed), JSON.stringify(verdict), giveDate, nowISO());

  // Travis finds out without anyone chasing him: a board post that mentions him.
  try {
    db.prepare(`
      INSERT INTO board_posts (author_id, kind, text, mentions, created_at)
      VALUES (?, 'post', ?, ?, ?)
    `).run(req.user.id, `Swap request for @Travis: ${parsed.summary}${note ? ` — ${note}` : ""}`,
      JSON.stringify(["Travis"]), nowISO());
  } catch (err) { console.error("swap board post:", err.message); }

  res.json({ id, verdict });
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

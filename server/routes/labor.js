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

import { Router } from "express";
import { db } from "../db.js";
import { laDateStr, addDaysStr, dayOfWeek, nowISO } from "../dates.js";
import { buildWeekLabor, minLabel, scheduleFor } from "../labor.js";

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
      start_min: r.start_min, end_min: r.end_min,
    };
  }
  // Who has opened My Schedule since the latest publish — Travis and the
  // owner see the "seen by" list; a member request just skips it.
  let seen = null;
  if (req.user.role === "owner" || req.user.name === "Travis") {
    const n = db.prepare(
      "SELECT * FROM schedule_notices WHERE kind = 'version' ORDER BY id DESC LIMIT 1"
    ).get();
    if (n) {
      const acks = db.prepare(`
        SELECT u.name, a.seen_at FROM schedule_notice_acks a JOIN users u ON u.id = a.user_id
        WHERE a.notice_id = ? ORDER BY u.name
      `).all(n.id);
      const ackNames = new Set(acks.map(a => a.name));
      const missing = db.prepare("SELECT name FROM users WHERE active = 1 AND role != 'owner' ORDER BY name")
        .all().map(u => u.name).filter(name => !ackNames.has(name));
      seen = { effective_date: n.effective_date, note: n.note, created_at: n.created_at, acks, missing };
    }
  }

  res.json({
    version: { id: v.id, effective_date: v.effective_date, created_at: v.created_at, note: v.note },
    grid, seen,
  });
});

// Publish a new schedule version (Travis or the owner). Presets match how the
// shop actually runs; the old version stays on file and past weeks keep
// checking against whatever was in force at the time.
const SHIFT_PRESETS = {
  "OFF":        { code: "OFF", start: null, end: null },
  "OPEN 6-12":  { code: "OPEN", start: 360, end: 720 },
  "OPEN 6-1":   { code: "OPEN", start: 360, end: 780 },
  "MID 9-4":    { code: "MID", start: 540, end: 960 },
  "CLOSE 12-7": { code: "CLOSE", start: 720, end: 1140 },
  "CLOSE 1-7":  { code: "CLOSE", start: 780, end: 1140 },
  "ROASTERY":   { code: "ROASTERY", start: null, end: null },
};
const WEEK_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

laborRouter.post("/api/schedule", requireLabor, (req, res) => {
  const { effective_date, note, grid } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective_date || "")) return res.status(400).json({ error: "Pick the effective date" });
  if (effective_date < laDateStr()) return res.status(400).json({ error: "Effective date can't be in the past" });
  if (!grid || typeof grid !== "object" || Object.keys(grid).length === 0) {
    return res.status(400).json({ error: "The grid is empty" });
  }
  for (const [member, days] of Object.entries(grid)) {
    for (const [day, preset] of Object.entries(days || {})) {
      if (!WEEK_DAYS.includes(day)) return res.status(400).json({ error: `Unknown day '${day}'` });
      if (!SHIFT_PRESETS[preset]) return res.status(400).json({ error: `Unknown shift '${preset}' for ${member}` });
    }
  }
  // Snapshot what the schedule said before this publish, so the push can tell
  // each member whether THEIR week actually changed.
  const prev = db.prepare(
    "SELECT id FROM schedule_versions WHERE effective_date <= ? ORDER BY effective_date DESC, id DESC LIMIT 1"
  ).get(effective_date);
  const prevShifts = {};
  if (prev) {
    for (const r of db.prepare("SELECT member_name, day_of_week, shift_code, start_min, end_min FROM schedule_shifts WHERE version_id = ?").all(prev.id)) {
      prevShifts[`${r.member_name}|${r.day_of_week}`] = r;
    }
  }

  const run = db.transaction(() => {
    const { lastInsertRowid: versionId } = db.prepare(
      "INSERT INTO schedule_versions (effective_date, created_at, note) VALUES (?, ?, ?)"
    ).run(effective_date, nowISO(), String(note || "").slice(0, 120) || `Published in-app by ${req.user.name}`);
    const ins = db.prepare(
      "INSERT INTO schedule_shifts (version_id, member_name, day_of_week, shift_code, start_min, end_min) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const [member, days] of Object.entries(grid)) {
      for (const day of WEEK_DAYS) {
        const p = SHIFT_PRESETS[days?.[day] || "OFF"];
        ins.run(versionId, member, day, p.code, p.start, p.end);
      }
    }
    return versionId;
  });
  const versionId = run();

  // The push: per-member diff vs the previous version, one notice for the
  // whole team (the dashboard strip), one board post @everyone (the badge).
  try {
    const label = (s) => !s || s.shift_code === "OFF" ? "OFF"
      : s.start_min == null ? s.shift_code
      : `${s.shift_code} ${minLabel(s.start_min)}–${minLabel(s.end_min)}`;
    const changed = {};
    let changes = 0;
    const members = new Set([...Object.keys(grid), ...Object.keys(prevShifts).map(k => k.split("|")[0])]);
    for (const member of members) {
      const diffs = [];
      for (const day of WEEK_DAYS) {
        const before = prevShifts[`${member}|${day}`] || null;
        const p = grid[member] ? SHIFT_PRESETS[grid[member]?.[day] || "OFF"] : null;
        const after = p ? { shift_code: p.code, start_min: p.start, end_min: p.end } : null;
        if (label(before) !== label(after)) { diffs.push(`${day.slice(0, 3)} ${label(before)} → ${label(after)}`); changes++; }
      }
      if (diffs.length) changed[member] = diffs.join(" · ");
    }
    const { lastInsertRowid: noticeId } = db.prepare(`
      INSERT INTO schedule_notices (kind, member_name, version_id, effective_date, note, changed_json, created_at)
      VALUES ('version', NULL, ?, ?, ?, ?, ?)
    `).run(versionId, effective_date, `${changes} shift change${changes === 1 ? "" : "s"}`, JSON.stringify(changed), nowISO());
    // Publishing counts as having seen your own publish
    db.prepare("INSERT OR IGNORE INTO schedule_notice_acks (notice_id, user_id, seen_at) VALUES (?, ?, ?)")
      .run(noticeId, req.user.id, nowISO());

    const everyone = db.prepare("SELECT name FROM users WHERE active = 1 AND role != 'owner' AND name != ?")
      .all(req.user.name).map(u => u.name);
    db.prepare("INSERT INTO board_posts (author_id, kind, text, mentions, created_at) VALUES (?, 'post', ?, ?, ?)")
      .run(req.user.id,
        `Published the schedule effective ${effective_date} · ${changes} shift change${changes === 1 ? "" : "s"} @everyone — check My Schedule`,
        JSON.stringify(everyone), nowISO());
  } catch (err) { console.error("schedule push:", err.message); }

  res.json({ ok: true, version_id: versionId });
});

// ─── My Schedule — every member's own view of the living schedule ────────────
// Renders the exact same scheduleFor() the variance checker and swap system
// use: published versions with approved-swap exceptions laid over them.
// Opening it acknowledges every outstanding schedule notice for this user.
laborRouter.get("/api/my-schedule", (req, res) => {
  const offset = Math.max(0, Math.min(3, parseInt(req.query.offset) || 0));
  const monday = addDaysStr(currentMonday(), offset * 7);
  const today = laDateStr();
  const name = req.user.name;

  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysStr(monday, i);
    const map = scheduleFor(date);
    const swapped = new Set(db.prepare(
      "SELECT member_name FROM schedule_exceptions WHERE date = ?"
    ).all(date).map(r => r.member_name));
    const rowOf = (n) => {
      const s = map[n] || null;
      return {
        name: n,
        code: s ? s.shift_code : null,
        label: s && s.start_min != null ? `${minLabel(s.start_min)} – ${minLabel(s.end_min)}` : null,
        swapped: swapped.has(n),
      };
    };
    const team = Object.keys(map).sort((a, b) => {
      const sa = map[a], sb = map[b];
      return (sa.start_min ?? 9999) - (sb.start_min ?? 9999) || a.localeCompare(b);
    }).map(rowOf);
    days.push({ date, day: dayNameOf(date), is_today: date === today, me: rowOf(name), team });
  }

  // Opening the schedule counts as seen — clears the strip, feeds "seen by"
  try {
    const outstanding = db.prepare(`
      SELECT n.id FROM schedule_notices n
      WHERE (n.member_name IS NULL OR n.member_name = ?)
        AND NOT EXISTS (SELECT 1 FROM schedule_notice_acks a WHERE a.notice_id = n.id AND a.user_id = ?)
    `).all(name, req.user.id);
    const ack = db.prepare("INSERT OR IGNORE INTO schedule_notice_acks (notice_id, user_id, seen_at) VALUES (?, ?, ?)");
    for (const { id } of outstanding) ack.run(id, req.user.id, nowISO());
  } catch (err) { console.error("schedule ack:", err.message); }

  res.json({
    monday, to: addDaysStr(monday, 6), today, offset,
    on_grid: days.some(d => d.me.code != null),
    days,
  });
});

// Unseen schedule pushes for the signed-in member — the dashboard strip.
laborRouter.get("/api/schedule-ping", (req, res) => {
  if (req.user.role === "owner") return res.json({ notices: [] });
  const rows = db.prepare(`
    SELECT n.* FROM schedule_notices n
    WHERE (n.member_name IS NULL OR n.member_name = ?)
      AND NOT EXISTS (SELECT 1 FROM schedule_notice_acks a WHERE a.notice_id = n.id AND a.user_id = ?)
    ORDER BY n.id DESC LIMIT 3
  `).all(req.user.name, req.user.id);
  res.json({
    notices: rows.map(n => {
      const changed = n.changed_json ? JSON.parse(n.changed_json) : {};
      return {
        id: n.id, kind: n.kind, effective_date: n.effective_date,
        detail: n.kind === "swap" ? n.note
          : changed[req.user.name] ? `your week changed — ${changed[req.user.name]}`
          : "no change to your shifts",
      };
    }),
  });
});

// ─── Schedule import — the planner spreadsheet becomes an editor draft ───────
// Fully deterministic: finds the Name/Monday..Sunday table, reads Off / Open /
// Mid / Close / Roastery cells, maps the sheet's own "Shift times" section
// onto the app's presets, and matches names against the roster. The result
// pre-fills the editor for review — nothing publishes without a human.
import multer from "multer";
import XLSX from "xlsx";
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const parseClock = (s) => {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(s || "");
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + Number(m[2] || 0);
};

laborRouter.post("/api/schedule/import", requireLabor, importUpload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const warnings = [];

    // Find the sheet and row with the Name / Monday..Sunday header
    let rows = null, headerIdx = -1;
    for (const name of wb.SheetNames) {
      const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
      const idx = r.findIndex(row =>
        String(row[0]).trim().toLowerCase() === "name" &&
        row.some(c => String(c).trim().toLowerCase() === "monday"));
      if (idx >= 0) { rows = r; headerIdx = idx; break; }
    }
    if (!rows) return res.status(400).json({ error: "Couldn't find a schedule table (a 'Name' row with Monday–Sunday columns)" });

    const header = rows[headerIdx].map(c => String(c).trim());
    const dayCols = {};
    for (const day of WEEK_DAYS) {
      const col = header.findIndex(h => h.toLowerCase() === day.toLowerCase());
      if (col >= 0) dayCols[day] = col;
    }
    if (Object.keys(dayCols).length < 7) warnings.push(`Only found ${Object.keys(dayCols).length} day columns`);

    // The sheet's own shift times, if declared, pick the exact preset
    const timesByCode = {};
    const timesIdx = rows.findIndex(r => String(r[0]).trim().toLowerCase() === "shift times");
    if (timesIdx >= 0) {
      for (let i = timesIdx + 1; i < rows.length; i++) {
        const code = String(rows[i][0]).trim().toUpperCase();
        if (!code) break;
        const parts = String(rows[i][1]).split(/–|—|-/).map(parseClock);
        if (parts.length === 2 && parts[0] != null && parts[1] != null) timesByCode[code] = parts;
      }
    }
    const presetFor = (word) => {
      const w = word.trim().toUpperCase();
      if (!w || w === "OFF") return "OFF";
      const code = w.startsWith("ROAST") ? "ROASTERY" : w;
      if (code === "ROASTERY") return "ROASTERY";
      const t = timesByCode[code];
      const candidates = Object.entries(SHIFT_PRESETS).filter(([, p]) => p.code === code);
      if (candidates.length === 0) return null;
      if (t) {
        const exact = candidates.find(([, p]) => p.start === t[0] && p.end === t[1]);
        if (exact) return exact[0];
        warnings.push(`${word} times in the sheet don't match a preset — using ${candidates[0][0]}`);
      }
      return candidates[0][0];
    };

    const roster = db.prepare("SELECT name FROM users WHERE active = 1 AND role != 'owner'").all().map(u => u.name);
    const byLower = Object.fromEntries(roster.map(n => [n.toLowerCase(), n]));
    const grid = {};
    const unknownNames = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const raw = String(rows[i][0]).trim();
      if (!raw || raw.toLowerCase() === "staffing") break;
      const member = byLower[raw.toLowerCase()];
      if (!member) { unknownNames.push(raw); continue; }
      grid[member] = {};
      for (const [day, col] of Object.entries(dayCols)) {
        const preset = presetFor(String(rows[i][col] || "Off"));
        if (preset == null) warnings.push(`${member} ${day}: unknown shift '${rows[i][col]}' — set to OFF`);
        grid[member][day] = preset || "OFF";
      }
    }
    if (unknownNames.length) warnings.push(`Not on the roster, skipped: ${unknownNames.join(", ")}`);
    if (Object.keys(grid).length === 0) return res.status(400).json({ error: "No roster members found in the sheet" });
    const missing = roster.filter(n => !grid[n]);
    if (missing.length) warnings.push(`On the roster but not in the sheet (left OFF): ${missing.join(", ")}`);

    res.json({ grid, warnings: [...new Set(warnings)], members: Object.keys(grid).length });
  } catch (err) {
    res.status(400).json({ error: `Couldn't read the file: ${err.message}` });
  }
});

// ─── Swap checker ─────────────────────────────────────────────────────────────
import { parseSwapRequest, decideSwap, applySwap } from "../labor.js";

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
      source: r.source, applied_at: r.applied_at,
    })),
  });
});

// Approve a clean member swap: writes the schedule exceptions right here.
// OT-creating swaps go through the owner's queue instead; approval there
// applies them the same way.
laborRouter.post("/api/labor/swap-checks/:id/apply", requireLabor, (req, res) => {
  const row = db.prepare("SELECT * FROM swap_checks WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Check not found" });
  const verdict = row.verdict_json ? JSON.parse(row.verdict_json) : {};
  if (verdict.creates_ot && !row.decision_id) {
    return res.status(400).json({ error: "This swap creates overtime — send it to the owner instead" });
  }
  try { res.json({ ok: true, ...applySwap(row.id) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
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
  // Legs carry exact dates so an approval can write schedule exceptions
  const legs = [{ taker: partner, giver: req.user.name, day: giveDay, date: giveDate }];
  let summary = `${partner} covers ${req.user.name}'s ${giveDay} ${fmt(giveDate)}`;
  if (mode === "switch") {
    const takeDay = dayNameOf(takeDate);
    legs.push({ taker: req.user.name, giver: partner, day: takeDay, date: takeDate });
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

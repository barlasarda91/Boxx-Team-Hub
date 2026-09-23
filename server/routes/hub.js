import { Router } from "express";
import { db, getSetting } from "../db.js";
import { nowISO, laDateStr, addDaysStr } from "../dates.js";
import {
  hashPin, verifyPin, createSession, sessionCookie,
  clearSessionCookie, destroySession, requireOwner,
} from "../auth.js";

export const hubRouter = Router();

// ─── App running costs (owner only) ───────────────────────────────────────────
import { costSummary } from "../usage.js";
import { waitingSummary } from "./board.js";
import { computeWeekDigest } from "../cron.js";
hubRouter.get("/api/costs", (req, res) => {
  if (req.user?.role !== "owner") return res.status(403).json({ error: "Costs are the owner's view" });
  res.json({
    ...costSummary(6),
    hosting_monthly_usd: Number(getSetting("hosting_monthly_usd")) || null,
  });
});

// ─── Backups (owner only) ──────────────────────────────────────────────────────
import { runBackup, backupStatus, snapshotForDownload, buildFullArchive } from "../backup.js";
import { logJob } from "../db.js";

hubRouter.get("/api/backup/status", requireOwner, (_req, res) => {
  const s = backupStatus();
  const lastRun = db.prepare(
    "SELECT started_at, status, message FROM sync_log WHERE job_type = 'backup' ORDER BY id DESC LIMIT 1"
  ).get() || null;
  res.json({ ...s, last_run: lastRun });
});

hubRouter.post("/api/backup/run", requireOwner, async (_req, res) => {
  try { res.json({ ok: true, ...(await logJob("backup", runBackup)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

hubRouter.get("/api/backup/db", requireOwner, async (_req, res) => {
  try {
    const file = await snapshotForDownload();
    res.setHeader("Content-Disposition", `attachment; filename="boxxhub-${laDateStr()}.db"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.sendFile(file);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

hubRouter.get("/api/backup/full", requireOwner, async (_req, res) => {
  try {
    const file = await buildFullArchive();
    res.setHeader("Content-Disposition", `attachment; filename="boxxhub-full-${laDateStr()}.tar.gz"`);
    res.setHeader("Content-Type", "application/gzip");
    res.sendFile(file);
  } catch (err) { res.status(500).json({ error: `Archive failed: ${err.message}` }); }
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
// Brute-force guard: 5 wrong PINs for a name locks that name for 15 minutes.
// In-memory is fine — a restart resetting the counter is acceptable, and the
// lockout is per name so one member can't lock the whole team out.
const loginFails = new Map();   // nameLower → { count, until }
const LOCK_AFTER = 5, LOCK_MS = 15 * 60 * 1000;

hubRouter.post("/api/auth/login", (req, res) => {
  const { name, pin } = req.body || {};
  const key = String(name || "").trim().toLowerCase();
  const rec = loginFails.get(key);
  if (rec?.until > Date.now()) {
    const mins = Math.ceil((rec.until - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many wrong PINs — try again in ${mins} min` });
  }
  const user = db.prepare("SELECT * FROM users WHERE name = ? COLLATE NOCASE AND active = 1").get(name || "");
  if (!user || !verifyPin(pin, user.pin_hash)) {
    const next = { count: (rec?.count || 0) + 1, until: 0 };
    if (next.count >= LOCK_AFTER) { next.until = Date.now() + LOCK_MS; next.count = 0; }
    loginFails.set(key, next);
    return res.status(401).json({ error: "Wrong name or PIN" });
  }
  loginFails.delete(key);
  const { token, expires } = createSession(user.id);
  res.setHeader("Set-Cookie", sessionCookie(token, expires));
  res.json({
    user: { id: user.id, name: user.name, role: user.role },
    must_change_pin: !!user.must_change_pin,
  });
});

hubRouter.post("/api/auth/logout", (req, res) => {
  destroySession(req);
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

hubRouter.get("/api/auth/me", (req, res) => {
  const domain = db.prepare("SELECT id, name FROM domains WHERE owner_user_id = ? AND active = 1").get(req.user.id);
  const flags = db.prepare("SELECT must_change_pin FROM users WHERE id = ?").get(req.user.id);
  res.json({
    user: { id: req.user.id, name: req.user.name, role: req.user.role },
    domain: domain || null,
    must_change_pin: !!flags?.must_change_pin,
  });
});

// Login screen needs the roster before sign-in… no: keep the roster behind a
// deliberate exception — names only, no ids beyond what the picker needs.
hubRouter.get("/api/auth/roster", (req, res) => {
  res.json({ names: db.prepare("SELECT name FROM users WHERE active = 1 ORDER BY role DESC, name").all().map(r => r.name) });
});

hubRouter.post("/api/auth/change-pin", (req, res) => {
  const { current_pin, new_pin } = req.body || {};
  if (!/^\d{4,8}$/.test(String(new_pin || ""))) return res.status(400).json({ error: "PIN must be 4-8 digits" });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!verifyPin(current_pin, user.pin_hash)) return res.status(401).json({ error: "Current PIN is wrong" });
  if (verifyPin(new_pin, user.pin_hash)) return res.status(400).json({ error: "Pick a different PIN" });
  db.prepare("UPDATE users SET pin_hash = ?, must_change_pin = 0 WHERE id = ?").run(hashPin(new_pin), user.id);
  res.json({ ok: true });
});

hubRouter.get("/api/users", requireOwner, (_req, res) => {
  res.json({ users: db.prepare("SELECT id, name, role, active, created_at FROM users ORDER BY role DESC, name").all() });
});

hubRouter.post("/api/users/:id/reset-pin", requireOwner, (req, res) => {
  const { new_pin } = req.body || {};
  if (!/^\d{4,8}$/.test(String(new_pin || ""))) return res.status(400).json({ error: "PIN must be 4-8 digits" });
  const result = db.prepare("UPDATE users SET pin_hash = ?, must_change_pin = 1 WHERE id = ?").run(hashPin(new_pin), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "User not found" });
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ─── Domains ──────────────────────────────────────────────────────────────────
function latestCheckIn(domainId) {
  return db.prepare(`
    SELECT c.*, u.name AS user_name FROM check_ins c
    JOIN users u ON u.id = c.user_id
    WHERE c.domain_id = ? ORDER BY c.created_at DESC LIMIT 1
  `).get(domainId) || null;
}

function domainTile(d, today) {
  const latest = latestCheckIn(d.id);
  const daysSince = latest ? Math.floor((new Date(`${today}T12:00:00Z`) - new Date(latest.created_at)) / 86400000) : null;
  const overdueCommitments = db.prepare(
    "SELECT COUNT(*) n FROM commitments WHERE domain_id = ? AND done_at IS NULL AND due_date < ?"
  ).get(d.id, today).n;
  const upcoming = db.prepare(`
    SELECT id, title, due_date FROM commitments
    WHERE domain_id = ? AND done_at IS NULL AND due_date >= ? AND due_date <= ?
    ORDER BY due_date LIMIT 3
  `).all(d.id, today, addDaysStr(today, 7));
  const openDecisions = db.prepare(
    "SELECT COUNT(*) n FROM decisions WHERE domain_id = ? AND state = 'open'"
  ).get(d.id).n;

  // Tile color: the member's own status, overridden only by silence or
  // overdue commitments — the system never paints green over a missed cadence.
  let status = latest ? latest.status : "none";
  const checkInOverdue = latest ? daysSince > d.cadence_days + 2 : true;
  if (status === "green" && (checkInOverdue || overdueCommitments > 0)) status = "yellow";

  return {
    id: d.id, name: d.name, owner: d.owner_name, owner_user_id: d.owner_user_id,
    cadence_days: d.cadence_days, status,
    last_check_in: latest ? { status: latest.status, note: latest.note, at: latest.created_at, days_since: daysSince } : null,
    check_in_overdue: checkInOverdue,
    overdue_commitments: overdueCommitments,
    upcoming,
    open_decisions: openDecisions,
  };
}

const domainWithOwner = `
  SELECT d.*, u.name AS owner_name FROM domains d
  LEFT JOIN users u ON u.id = d.owner_user_id
`;

hubRouter.get("/api/domains", (req, res) => {
  const today = laDateStr();
  const domains = db.prepare(`${domainWithOwner} WHERE d.active = 1 ORDER BY u.name`).all();
  res.json({ domains: domains.map(d => domainTile(d, today)) });
});

hubRouter.get("/api/domains/:id", (req, res) => {
  const d = db.prepare(`${domainWithOwner} WHERE d.id = ?`).get(req.params.id);
  if (!d) return res.status(404).json({ error: "Domain not found" });
  const today = laDateStr();
  const tile = domainTile(d, today);
  const checkIns = db.prepare(`
    SELECT c.*, u.name AS user_name FROM check_ins c
    JOIN users u ON u.id = c.user_id
    WHERE c.domain_id = ? ORDER BY c.created_at DESC LIMIT 12
  `).all(d.id);
  const commitments = db.prepare(`
    SELECT * FROM commitments WHERE domain_id = ? AND (done_at IS NULL OR done_at > ?)
    ORDER BY done_at IS NOT NULL, due_date LIMIT 40
  `).all(d.id, addDaysStr(today, -14));
  const decisions = db.prepare(`
    SELECT dec.*, u.name AS raised_by_name FROM decisions dec
    LEFT JOIN users u ON u.id = dec.raised_by
    WHERE dec.domain_id = ? ORDER BY dec.state = 'open' DESC, dec.created_at DESC LIMIT 20
  `).all(d.id);
  res.json({
    domain: { ...tile, standard_md: d.standard_md, authority_limits_md: d.authority_limits_md },
    check_ins: checkIns, commitments, decisions,
  });
});

hubRouter.patch("/api/domains/:id", requireOwner, (req, res) => {
  const d = db.prepare("SELECT * FROM domains WHERE id = ?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "Domain not found" });
  const allowed = ["name", "standard_md", "authority_limits_md", "cadence_days", "active"];
  const sets = [], params = [];
  for (const key of allowed) {
    if (key in (req.body || {})) { sets.push(`${key} = ?`); params.push(req.body[key]); }
  }
  if (!sets.length) return res.status(400).json({ error: "No editable fields provided" });
  db.prepare(`UPDATE domains SET ${sets.join(", ")} WHERE id = ?`).run(...params, d.id);
  res.json({ ok: true });
});

// Member's own domain, or null for the owner
function memberDomain(userId) {
  return db.prepare("SELECT * FROM domains WHERE owner_user_id = ? AND active = 1").get(userId) || null;
}

// ─── Check-ins ────────────────────────────────────────────────────────────────
// Body: { status, note, metrics?, asks?: [{ title, detail? }] }
// Asks become decisions in the owner's queue — the upward flow.
hubRouter.post("/api/check-ins", (req, res) => {
  const domain = req.user.role === "owner" && req.body?.domain_id
    ? db.prepare("SELECT * FROM domains WHERE id = ?").get(req.body.domain_id)
    : memberDomain(req.user.id);
  if (!domain) return res.status(400).json({ error: "No domain for this user" });
  const { status, note, metrics, asks } = req.body || {};
  if (!["green", "yellow", "red"].includes(status)) return res.status(400).json({ error: "status must be green, yellow or red" });

  const run = db.transaction(() => {
    const { lastInsertRowid: checkInId } = db.prepare(
      "INSERT INTO check_ins (domain_id, user_id, status, note, metrics_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(domain.id, req.user.id, status, note || null, metrics ? JSON.stringify(metrics) : null, nowISO());
    const insertDecision = db.prepare(`
      INSERT INTO decisions (domain_id, raised_by, source, source_ref, title, detail, created_at)
      VALUES (?, ?, 'check_in', ?, ?, ?, ?)
    `);
    for (const ask of Array.isArray(asks) ? asks : []) {
      if (ask?.title) insertDecision.run(domain.id, req.user.id, String(checkInId), ask.title, ask.detail || null, nowISO());
    }
    return checkInId;
  });
  res.json({ ok: true, check_in_id: run() });
});

// ─── Commitments ──────────────────────────────────────────────────────────────
function canWriteDomain(req, domainId) {
  if (req.user.role === "owner") return true;
  const d = db.prepare("SELECT owner_user_id FROM domains WHERE id = ?").get(domainId);
  return d && d.owner_user_id === req.user.id;
}

hubRouter.post("/api/commitments", (req, res) => {
  const { domain_id, title, due_date, repeat_rule, notes } = req.body || {};
  if (!domain_id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(due_date || "")) {
    return res.status(400).json({ error: "domain_id, title and due_date required" });
  }
  if (!canWriteDomain(req, domain_id)) return res.status(403).json({ error: "Not your domain" });
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO commitments (domain_id, title, due_date, repeat_rule, notes) VALUES (?, ?, ?, ?, ?)"
  ).run(domain_id, title, due_date, repeat_rule || "none", notes || null);
  res.json({ commitment: db.prepare("SELECT * FROM commitments WHERE id = ?").get(id) });
});

function nextDue(dueDate, rule) {
  if (rule === "weekly") return addDaysStr(dueDate, 7);
  if (rule === "monthly") {
    const d = new Date(`${dueDate}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().split("T")[0];
  }
  if (rule === "annual") {
    const d = new Date(`${dueDate}T12:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().split("T")[0];
  }
  const every = /^every:(\d+)d$/.exec(rule || "");
  if (every) return addDaysStr(dueDate, Number(every[1]));
  return null;
}

hubRouter.post("/api/commitments/:id/complete", (req, res) => {
  const c = db.prepare("SELECT * FROM commitments WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "Commitment not found" });
  if (!canWriteDomain(req, c.domain_id)) return res.status(403).json({ error: "Not your domain" });
  if (c.done_at) return res.status(400).json({ error: "Already done" });

  const run = db.transaction(() => {
    db.prepare("UPDATE commitments SET done_at = ? WHERE id = ?").run(nowISO(), c.id);
    const next = nextDue(c.due_date, c.repeat_rule);
    if (next) {
      db.prepare(
        "INSERT INTO commitments (domain_id, title, due_date, repeat_rule, equipment_id, notes) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(c.domain_id, c.title, next, c.repeat_rule, c.equipment_id, c.notes);
    }
    return next;
  });
  res.json({ ok: true, next_due: run() });
});

hubRouter.patch("/api/commitments/:id", (req, res) => {
  const c = db.prepare("SELECT * FROM commitments WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "Commitment not found" });
  if (!canWriteDomain(req, c.domain_id)) return res.status(403).json({ error: "Not your domain" });
  const allowed = ["title", "due_date", "repeat_rule", "notes"];
  const sets = [], params = [];
  for (const key of allowed) {
    if (key in (req.body || {})) { sets.push(`${key} = ?`); params.push(req.body[key]); }
  }
  if (!sets.length) return res.status(400).json({ error: "No editable fields provided" });
  db.prepare(`UPDATE commitments SET ${sets.join(", ")} WHERE id = ?`).run(...params, c.id);
  res.json({ ok: true });
});

hubRouter.delete("/api/commitments/:id", (req, res) => {
  const c = db.prepare("SELECT * FROM commitments WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "Commitment not found" });
  if (!canWriteDomain(req, c.domain_id)) return res.status(403).json({ error: "Not your domain" });
  db.prepare("DELETE FROM commitments WHERE id = ?").run(c.id);
  res.json({ ok: true });
});

// ─── Decisions ────────────────────────────────────────────────────────────────
hubRouter.get("/api/decisions", (req, res) => {
  const clauses = [], params = [];
  if (req.query.state) { clauses.push("dec.state = ?"); params.push(req.query.state); }
  if (req.user.role !== "owner") {
    const d = memberDomain(req.user.id);
    clauses.push("dec.domain_id = ?"); params.push(d ? d.id : -1);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const decisions = db.prepare(`
    SELECT dec.*, u.name AS raised_by_name, dom.name AS domain_name
    FROM decisions dec
    LEFT JOIN users u ON u.id = dec.raised_by
    LEFT JOIN domains dom ON dom.id = dec.domain_id
    ${where} ORDER BY dec.state = 'open' DESC, dec.created_at ASC LIMIT 100
  `).all(...params);
  res.json({ decisions });
});

hubRouter.post("/api/decisions", (req, res) => {
  const { title, detail, domain_id } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });
  const domain = domain_id && req.user.role === "owner"
    ? db.prepare("SELECT * FROM domains WHERE id = ?").get(domain_id)
    : memberDomain(req.user.id);
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO decisions (domain_id, raised_by, source, title, detail, created_at)
    VALUES (?, ?, 'manual', ?, ?, ?)
  `).run(domain?.id ?? null, req.user.id, title, detail || null, nowISO());
  res.json({ decision: db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) });
});

hubRouter.post("/api/decisions/:id/resolve", requireOwner, (req, res) => {
  const { state, owner_note } = req.body || {};
  if (!["approved", "declined", "acknowledged"].includes(state)) {
    return res.status(400).json({ error: "state must be approved, declined or acknowledged" });
  }
  const dec = db.prepare("SELECT * FROM decisions WHERE id = ?").get(req.params.id);
  if (!dec) return res.status(404).json({ error: "Decision not found" });
  if (dec.state !== "open") return res.status(400).json({ error: `Already ${dec.state}` });
  db.prepare("UPDATE decisions SET state = ?, owner_note = ?, resolved_at = ? WHERE id = ?")
    .run(state, owner_note || null, nowISO(), dec.id);
  res.json({ ok: true });
});

// ─── Overview (owner dashboard) ───────────────────────────────────────────────
hubRouter.get("/api/hub/overview", (req, res) => {
  const today = laDateStr();
  const domains = db.prepare(`${domainWithOwner} WHERE d.active = 1 ORDER BY u.name`).all();
  const tiles = domains.map(d => domainTile(d, today));
  const queue = db.prepare(`
    SELECT dec.*, u.name AS raised_by_name, dom.name AS domain_name
    FROM decisions dec
    LEFT JOIN users u ON u.id = dec.raised_by
    LEFT JOIN domains dom ON dom.id = dec.domain_id
    WHERE dec.state = 'open' ORDER BY dec.created_at ASC LIMIT 30
  `).all();
  const week = db.prepare(`
    SELECT c.id, c.title, c.due_date, d.name AS domain_name, u.name AS owner_name
    FROM commitments c
    JOIN domains d ON d.id = c.domain_id
    LEFT JOIN users u ON u.id = d.owner_user_id
    WHERE c.done_at IS NULL AND c.due_date >= ? AND c.due_date <= ?
    ORDER BY c.due_date LIMIT 12
  `).all(today, addDaysStr(today, 7));
  const recentCheckIns = db.prepare(`
    SELECT c.*, u.name AS user_name, d.name AS domain_name
    FROM check_ins c
    JOIN users u ON u.id = c.user_id
    JOIN domains d ON d.id = c.domain_id
    ORDER BY c.created_at DESC LIMIT 8
  `).all();
  // Computed fresh — the Overview's week-in-review always reflects the latest
  // published pastry report and variance rows, not last Monday's snapshot.
  let digest = null;
  try { digest = computeWeekDigest(); }
  catch { try { const raw = getSetting("monday_digest"); if (raw) digest = JSON.parse(raw); } catch {} }
  let waiting = {};
  try { waiting = waitingSummary(); } catch {}
  // Jobs whose most recent run failed (last 7 days): the owner should hear
  // about a dead Square token or revoked Gmail grant from the app, not silence.
  const jobAlerts = db.prepare(`
    SELECT job_type, status, message, started_at FROM sync_log s
    WHERE s.id = (SELECT MAX(id) FROM sync_log WHERE job_type = s.job_type)
      AND s.status = 'error' AND s.started_at >= ?
  `).all(new Date(Date.now() - 7 * 86400000).toISOString());
  res.json({ today, tiles, queue, week, recent_check_ins: recentCheckIns, digest, waiting, job_alerts: jobAlerts });
});

// ─── 1:1 agendas ──────────────────────────────────────────────────────────────
// Deterministic: the agenda assembles itself from what already needs attention.
// No LLM anywhere. Anyone can free-add items to any domain's agenda.

function agendaSuggestions(domainId) {
  const today = laDateStr();
  const out = [];
  const decisions = db.prepare(
    "SELECT id, title, created_at FROM decisions WHERE domain_id = ? AND state = 'open' ORDER BY created_at"
  ).all(domainId);
  for (const d of decisions) out.push({ kind: "decision", ref_id: d.id, text: `Decide: ${d.title}` });
  const overdue = db.prepare(
    "SELECT id, title, due_date FROM commitments WHERE domain_id = ? AND done_at IS NULL AND due_date < ? ORDER BY due_date"
  ).all(domainId, today);
  for (const c of overdue) out.push({ kind: "overdue", ref_id: c.id, text: `Overdue since ${c.due_date}: ${c.title}` });
  const upcoming = db.prepare(
    "SELECT id, title, due_date FROM commitments WHERE domain_id = ? AND done_at IS NULL AND due_date >= ? AND due_date <= ? ORDER BY due_date"
  ).all(domainId, today, addDaysStr(today, 14));
  for (const c of upcoming) out.push({ kind: "upcoming", ref_id: c.id, text: `Due ${c.due_date}: ${c.title}` });
  const lastCheckIn = db.prepare(
    "SELECT status, note, created_at FROM check_ins WHERE domain_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(domainId);
  if (lastCheckIn && lastCheckIn.status !== "green") {
    out.push({ kind: "check_in", ref_id: null, text: `Last check-in was ${lastCheckIn.status}: ${lastCheckIn.note || "no note"}` });
  } else if (!lastCheckIn) {
    out.push({ kind: "check_in", ref_id: null, text: "No check-in on record yet" });
  }
  const carried = db.prepare(
    "SELECT id, text FROM action_items WHERE domain_id = ? AND done_at IS NULL ORDER BY id"
  ).all(domainId);
  for (const a of carried) out.push({ kind: "action", ref_id: a.id, text: `Carried action: ${a.text}` });
  return out;
}

// 1:1 material is between the owner and that member: anyone may ADD an item,
// but only those two can read the agenda and history.
function requireOneOnOneParty(req, res, next) {
  const d = db.prepare("SELECT id, owner_user_id FROM domains WHERE id = ?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "Domain not found" });
  if (req.user.role !== "owner" && req.user.id !== d.owner_user_id) {
    return res.status(403).json({ error: "1:1s are between the owner and that member" });
  }
  req.domain = d;
  next();
}

hubRouter.get("/api/domains/:id/agenda", requireOneOnOneParty, (req, res) => {
  const d = db.prepare("SELECT id, oneonone_day, oneonone_time FROM domains WHERE id = ?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "Domain not found" });
  const items = db.prepare(`
    SELECT a.*, u.name AS added_by_name FROM agenda_items a
    LEFT JOIN users u ON u.id = a.added_by
    WHERE a.domain_id = ? AND a.resolved_at IS NULL ORDER BY a.created_at
  `).all(d.id);
  const history = db.prepare(
    "SELECT id, held_at, agenda_snapshot_json FROM one_on_ones WHERE domain_id = ? ORDER BY held_at DESC LIMIT 8"
  ).all(d.id).map(o => ({ id: o.id, held_at: o.held_at, agenda: JSON.parse(o.agenda_snapshot_json || "[]") }));
  res.json({
    suggestions: agendaSuggestions(d.id), items, history,
    slot: { day: d.oneonone_day, time: d.oneonone_time },
  });
});

// The standing weekly slot — either party sets or changes it.
const SLOT_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// T-2 reminders: from two days before each 1:1's slot until the meeting, both
// parties get a pinned card urging them to review and publish the agenda.
// The card clears itself the moment an agenda is published in the window.
hubRouter.get("/api/oneonone-reminders", (req, res) => {
  const today = laDateStr();
  const todayIdx = new Date(`${today}T12:00:00Z`).getUTCDay();          // 0=Sun
  const domains = db.prepare(`
    SELECT d.id, d.oneonone_day, d.oneonone_time, u.name AS member_name, d.owner_user_id
    FROM domains d JOIN users u ON u.id = d.owner_user_id
    WHERE d.active = 1 AND d.oneonone_day IS NOT NULL
  `).all();
  const reminders = [];
  for (const d of domains) {
    const mine = req.user.role === "owner" || req.user.id === d.owner_user_id;
    if (!mine) continue;
    const slotIdx = (SLOT_DAYS.indexOf(d.oneonone_day) + 1) % 7;        // to 0=Sun
    const daysOut = (slotIdx - todayIdx + 7) % 7;
    if (daysOut > 2) continue;
    const meetingDate = new Date(`${today}T12:00:00Z`);
    meetingDate.setUTCDate(meetingDate.getUTCDate() + daysOut);
    const meeting = meetingDate.toISOString().slice(0, 10);
    const windowOpen = new Date(`${meeting}T00:00:00Z`);
    windowOpen.setUTCDate(windowOpen.getUTCDate() - 2);
    const published = db.prepare(
      "SELECT 1 FROM one_on_ones WHERE domain_id = ? AND held_at >= ? LIMIT 1"
    ).get(d.id, windowOpen.toISOString());
    if (published) continue;
    reminders.push({
      domain_id: d.id, member_name: d.member_name,
      day: d.oneonone_day, time: d.oneonone_time,
      meeting_date: meeting, days_out: daysOut,
      role: req.user.id === d.owner_user_id ? "member" : "owner",
    });
  }
  reminders.sort((a, b) => a.days_out - b.days_out);
  res.json({ reminders });
});
hubRouter.put("/api/domains/:id/one-on-one-slot", requireOneOnOneParty, (req, res) => {
  const day = String(req.body?.day || "").trim();
  const time = String(req.body?.time || "").trim();
  if (!SLOT_DAYS.includes(day)) return res.status(400).json({ error: "Pick a day of the week" });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return res.status(400).json({ error: "Pick a time" });
  db.prepare("UPDATE domains SET oneonone_day = ?, oneonone_time = ? WHERE id = ?").run(day, time, req.domain.id);
  res.json({ ok: true });
});

hubRouter.post("/api/domains/:id/agenda", (req, res) => {
  const d = db.prepare("SELECT id FROM domains WHERE id = ?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "Domain not found" });
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "text required" });
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO agenda_items (domain_id, text, added_by, created_at) VALUES (?, ?, ?, ?)"
  ).run(d.id, text, req.user.id, nowISO());
  res.json({ ok: true, id });
});

hubRouter.post("/api/agenda-items/:id/resolve", (req, res) => {
  const r = db.prepare("UPDATE agenda_items SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL")
    .run(nowISO(), req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: "Item not found or already resolved" });
  res.json({ ok: true });
});

// Create Agenda: freeze suggestions + free-added items into a 1:1 record
hubRouter.post("/api/domains/:id/one-on-ones", requireOneOnOneParty, (req, res) => {
  const d = db.prepare("SELECT id FROM domains WHERE id = ?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "Domain not found" });
  const items = db.prepare(
    "SELECT text, added_by FROM agenda_items WHERE domain_id = ? AND resolved_at IS NULL ORDER BY created_at"
  ).all(d.id);
  const agenda = [
    ...agendaSuggestions(d.id).map(s => ({ source: s.kind, text: s.text })),
    ...items.map(i => ({ source: "added", text: i.text })),
  ];
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO one_on_ones (domain_id, held_at, agenda_snapshot_json) VALUES (?, ?, ?)"
  ).run(d.id, nowISO(), JSON.stringify(agenda));
  res.json({ ok: true, id, agenda });
});

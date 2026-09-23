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
import { applySwap } from "../labor.js";
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
  res.json({
    users: db.prepare(`
      SELECT u.id, u.name, u.role, u.active, u.square_name, u.created_at, d.name AS domain_name
      FROM users u LEFT JOIN domains d ON d.owner_user_id = u.id
      ORDER BY u.role DESC, u.active DESC, u.name
    `).all(),
  });
});

// Active member names for pickers everywhere (mentions, swaps, birthdays).
hubRouter.get("/api/roster", (req, res) => {
  const rows = db.prepare("SELECT name, role FROM users WHERE active = 1 ORDER BY role DESC, name").all();
  res.json({
    members: rows.filter(r => r.role !== "owner").map(r => r.name),
    all: rows.map(r => r.name),
  });
});

// Hire someone: a user (forced PIN change on first sign-in) plus their domain.
// Their card starts with Overview + 1:1; work tools get assigned as their
// domain's plumbing gets built.
hubRouter.post("/api/users", requireOwner, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const pin = String(req.body?.pin || "");
  const domainName = String(req.body?.domain_name || "").trim();
  if (!/^[A-Za-z][A-Za-z ._-]{0,30}$/.test(name)) return res.status(400).json({ error: "Name must start with a letter (letters, spaces, . _ - allowed)" });
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: "Starting PIN must be 4-8 digits" });
  if (!domainName) return res.status(400).json({ error: "Give their domain a name (e.g. Catering)" });
  const existing = db.prepare("SELECT id, active FROM users WHERE name = ? COLLATE NOCASE").get(name);
  if (existing) return res.status(400).json({ error: existing.active ? "That name is taken" : "That name belongs to a deactivated member — reactivate them instead" });
  const run = db.transaction(() => {
    const { lastInsertRowid: userId } = db.prepare(
      "INSERT INTO users (name, pin_hash, role, must_change_pin, created_at) VALUES (?, ?, 'member', 1, ?)"
    ).run(name, hashPin(pin), nowISO());
    db.prepare(
      "INSERT INTO domains (owner_user_id, name, standard_md, authority_limits_md) VALUES (?, ?, ?, ?)"
    ).run(userId, domainName, "[Standard to be set with the owner]", "[Authority limits to be set by the owner]");
    return userId;
  });
  res.json({ ok: true, user_id: run() });
});

// Deactivate / reactivate / set the Square name. Deactivating signs them out,
// hides their domain and drops them from every roster; history stays intact.
hubRouter.patch("/api/users/:id(\\d+)", requireOwner, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.role === "owner") return res.status(400).json({ error: "The owner account can't be edited here" });
  const b = req.body || {};
  if ("square_name" in b) {
    db.prepare("UPDATE users SET square_name = ? WHERE id = ?")
      .run(String(b.square_name || "").trim() || null, user.id);
  }
  if ("active" in b) {
    const active = b.active ? 1 : 0;
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active, user.id);
    db.prepare("UPDATE domains SET active = ? WHERE owner_user_id = ?").run(active, user.id);
    if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  }
  res.json({ ok: true });
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
  // An approved swap decision applies itself to the schedule (dated legs only)
  let schedule_applied = null, schedule_note = null;
  if (state === "approved") {
    const swap = db.prepare("SELECT id FROM swap_checks WHERE decision_id = ?").get(dec.id);
    if (swap) {
      try { schedule_applied = applySwap(swap.id).applied ?? 0; }
      catch (err) { schedule_note = err.message; }
    }
  }
  res.json({ ok: true, schedule_applied, schedule_note });
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

// ─── The 1:1 lifecycle: draft → published → closed ────────────────────────────
// Each weekly slot produces one meeting row. Items collect in the draft all
// week; publish snapshots them (plus the automatic suggestions) and notifies
// the owner; on meeting day outcomes attach to that meeting; closing archives
// the whole record and the next draft opens by itself. Unpublished drafts
// auto-publish at meeting time — the owner never walks in with nothing.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function laNowMinutes() {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  return Number(p.find(x => x.type === "hour").value) * 60 + Number(p.find(x => x.type === "minute").value);
}

function nextSlotDate(dayName, today) {
  const target = WEEKDAYS.indexOf(dayName);
  if (target < 0) return null;
  const todayIdx = new Date(`${today}T12:00:00Z`).getUTCDay();
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((target - todayIdx + 7) % 7));
  return d.toISOString().slice(0, 10);
}

function publishMeeting(domainId, meetingId, publisherId, auto) {
  const items = db.prepare(
    "SELECT id, text FROM agenda_items WHERE domain_id = ? AND resolved_at IS NULL ORDER BY created_at"
  ).all(domainId);
  const agenda = [
    ...agendaSuggestions(domainId).map(s => ({ source: s.kind, text: s.text })),
    ...items.map(i => ({ source: "added", text: i.text })),
  ];
  const run = db.transaction(() => {
    db.prepare(`
      UPDATE one_on_ones SET status = 'published', published_at = ?, auto_published = ?, agenda_snapshot_json = ?
      WHERE id = ?
    `).run(nowISO(), auto ? 1 : 0, JSON.stringify(agenda), meetingId);
    // Consume the draft items — anything added after this lands in the next draft
    const consume = db.prepare("UPDATE agenda_items SET resolved_at = ? WHERE id = ?");
    for (const i of items) consume.run(nowISO(), i.id);
  });
  run();
  // Notify the owner on the board (badges them); deterministic, no LLM
  try {
    const owner = db.prepare("SELECT name FROM users WHERE role = 'owner' AND active = 1").get();
    const dom = db.prepare(`
      SELECT d.meeting_date, u.name AS member_name, d2.oneonone_day FROM one_on_ones d
      JOIN domains d2 ON d2.id = d.domain_id JOIN users u ON u.id = d2.owner_user_id WHERE d.id = ?
    `).get(meetingId);
    const author = db.prepare(`
      SELECT owner_user_id FROM domains WHERE id = ?
    `).get(domainId).owner_user_id;
    if (owner) db.prepare(`
      INSERT INTO board_posts (author_id, kind, text, mentions, created_at) VALUES (?, 'post', ?, ?, ?)
    `).run(publisherId ?? author,
      `${auto ? "Auto-published" : "Published"} the agenda for the 1:1 on ${dom?.oneonone_day || ""} ${dom?.meeting_date || ""} · ${agenda.length} items @${owner.name}`,
      JSON.stringify([owner.name]), nowISO());
  } catch (err) { console.error("publish notify:", err.message); }
  return agenda;
}

// Finds/creates the domain's live meeting, advancing the lifecycle as time
// passes: overdue drafts auto-publish, day-old published meetings auto-close.
export function ensureCurrentMeeting(domainId) {
  const d = db.prepare("SELECT id, oneonone_day, oneonone_time, owner_user_id FROM domains WHERE id = ?").get(domainId);
  if (!d) return null;
  const today = laDateStr();
  let nextDate = d.oneonone_day ? nextSlotDate(d.oneonone_day, today) : null;
  // A meeting already held (closed) on that date means this week's slot is
  // spent — the next draft belongs to the following week. Otherwise closing a
  // meeting on its own day would spawn a draft that instantly auto-publishes.
  if (nextDate && db.prepare(
    "SELECT 1 FROM one_on_ones WHERE domain_id = ? AND meeting_date = ? AND status = 'closed' LIMIT 1"
  ).get(domainId, nextDate)) {
    const dd = new Date(`${nextDate}T12:00:00Z`);
    dd.setUTCDate(dd.getUTCDate() + 7);
    nextDate = dd.toISOString().slice(0, 10);
  }

  const slotMin = d.oneonone_time
    ? Number(d.oneonone_time.slice(0, 2)) * 60 + Number(d.oneonone_time.slice(3, 5)) : 0;
  const publishDue = (m) => m.meeting_date
    && (m.meeting_date < today || (m.meeting_date === today && laNowMinutes() >= slotMin));

  let m = db.prepare(
    "SELECT * FROM one_on_ones WHERE domain_id = ? AND status IN ('draft','published') ORDER BY id DESC LIMIT 1"
  ).get(domainId);

  // Auto-publish a draft once its meeting time arrives
  if (m && m.status === "draft" && publishDue(m)) {
    publishMeeting(domainId, m.id, null, true);
    m = db.prepare("SELECT * FROM one_on_ones WHERE id = ?").get(m.id);
  }
  // Auto-close the morning after the meeting day
  if (m && m.status === "published" && m.meeting_date && m.meeting_date < today) {
    db.prepare("UPDATE one_on_ones SET status = 'closed', closed_at = ? WHERE id = ?").run(nowISO(), m.id);
    m = null;
  }
  // Fresh draft for the next occurrence
  if (!m) {
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO one_on_ones (domain_id, held_at, status, meeting_date) VALUES (?, ?, 'draft', ?)"
    ).run(domainId, nowISO(), nextDate);
    m = db.prepare("SELECT * FROM one_on_ones WHERE id = ?").get(lastInsertRowid);
  } else if (m.status === "draft" && nextDate && m.meeting_date !== nextDate) {
    // Slot changed, or the week rolled — keep the draft, move its date
    db.prepare("UPDATE one_on_ones SET meeting_date = ? WHERE id = ?").run(nextDate, m.id);
    m.meeting_date = nextDate;
  }
  // The draft just created or re-dated may itself already be due (a slot set
  // to a time earlier today) — publish it now, not on the next request
  if (m.status === "draft" && publishDue(m)) {
    publishMeeting(domainId, m.id, null, true);
    m = db.prepare("SELECT * FROM one_on_ones WHERE id = ?").get(m.id);
  }
  return m;
}

// Sweep for the daily cron: advance every domain's lifecycle even if nobody
// opens the tab that day.
export function sweepOneOnOnes() {
  const ids = db.prepare("SELECT id FROM domains WHERE active = 1").all();
  for (const { id } of ids) { try { ensureCurrentMeeting(id); } catch (err) { console.error("1:1 sweep:", err.message); } }
  return ids.length;
}

function meetingOutcomes(meetingId) {
  return {
    decisions: db.prepare(`
      SELECT od.id, od.text, od.created_at, u.name AS created_by_name
      FROM oneonone_decisions od LEFT JOIN users u ON u.id = od.created_by
      WHERE od.meeting_id = ? ORDER BY od.id
    `).all(meetingId),
    actions: db.prepare(
      "SELECT id, text, done_at FROM action_items WHERE one_on_one_id = ? ORDER BY id"
    ).all(meetingId),
  };
}

hubRouter.get("/api/domains/:id/agenda", requireOneOnOneParty, (req, res) => {
  const d = db.prepare("SELECT id, oneonone_day, oneonone_time FROM domains WHERE id = ?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "Domain not found" });
  const meeting = ensureCurrentMeeting(d.id);
  const draftItems = db.prepare(`
    SELECT a.*, u.name AS added_by_name FROM agenda_items a
    LEFT JOIN users u ON u.id = a.added_by
    WHERE a.domain_id = ? AND a.resolved_at IS NULL ORDER BY a.created_at
  `).all(d.id);
  const history = db.prepare(`
    SELECT id, meeting_date, held_at, published_at, auto_published, agenda_snapshot_json
    FROM one_on_ones WHERE domain_id = ? AND status = 'closed'
    ORDER BY COALESCE(meeting_date, substr(held_at,1,10)) DESC, id DESC LIMIT 8
  `).all(d.id).map(o => ({
    id: o.id, meeting_date: o.meeting_date || (o.held_at || "").slice(0, 10),
    auto_published: !!o.auto_published,
    agenda: JSON.parse(o.agenda_snapshot_json || "[]"),
    ...meetingOutcomes(o.id),
  }));
  res.json({
    slot: { day: d.oneonone_day, time: d.oneonone_time },
    meeting: meeting ? {
      id: meeting.id, status: meeting.status, meeting_date: meeting.meeting_date,
      published_at: meeting.published_at, auto_published: !!meeting.auto_published,
      agenda: meeting.agenda_snapshot_json ? JSON.parse(meeting.agenda_snapshot_json) : null,
      ...meetingOutcomes(meeting.id),
    } : null,
    draft_items: draftItems,
    suggestions: agendaSuggestions(d.id),
    history,
  });
});

// Publish the draft: snapshot, lock, notify the owner.
hubRouter.post("/api/domains/:id/publish-agenda", requireOneOnOneParty, (req, res) => {
  const m = ensureCurrentMeeting(req.domain.id);
  if (!m) return res.status(400).json({ error: "No meeting to publish" });
  if (m.status !== "draft") return res.status(400).json({ error: "This week's agenda is already published" });
  const agenda = publishMeeting(req.domain.id, m.id, req.user.id, false);
  res.json({ ok: true, items: agenda.length });
});

// Close the meeting (owner) — archives the record, next draft opens itself.
hubRouter.post("/api/domains/:id/close-meeting", requireOneOnOneParty, (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "The owner closes the meeting" });
  const m = db.prepare(
    "SELECT * FROM one_on_ones WHERE domain_id = ? AND status = 'published' ORDER BY id DESC LIMIT 1"
  ).get(req.domain.id);
  if (!m) return res.status(400).json({ error: "No published meeting to close" });
  db.prepare("UPDATE one_on_ones SET status = 'closed', closed_at = ? WHERE id = ?").run(nowISO(), m.id);
  res.json({ ok: true });
});

// Log what the meeting produced — attached to the live meeting: a decision
// (permanent record) or an action (checklist; open ones carry into the next
// draft automatically through the carried-action suggestion).
hubRouter.post("/api/domains/:id/meeting-log", requireOneOnOneParty, (req, res) => {
  const kind = req.body?.kind === "decision" ? "decision" : "action";
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Write it first" });
  if (text.length > 500) return res.status(400).json({ error: "Keep it under 500 characters" });
  const m = ensureCurrentMeeting(req.domain.id);
  if (kind === "decision") {
    db.prepare("INSERT INTO oneonone_decisions (domain_id, meeting_id, text, created_by, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(req.domain.id, m?.id ?? null, text, req.user.id, nowISO());
  } else {
    db.prepare("INSERT INTO action_items (domain_id, one_on_one_id, text) VALUES (?, ?, ?)")
      .run(req.domain.id, m?.id ?? null, text);
  }
  res.json({ ok: true });
});

hubRouter.post("/api/actions/:aid(\\d+)/toggle", (req, res) => {
  const a = db.prepare("SELECT a.*, d.owner_user_id FROM action_items a JOIN domains d ON d.id = a.domain_id WHERE a.id = ?")
    .get(req.params.aid);
  if (!a) return res.status(404).json({ error: "Action not found" });
  if (req.user.role !== "owner" && req.user.id !== a.owner_user_id) {
    return res.status(403).json({ error: "1:1s are between the owner and that member" });
  }
  db.prepare("UPDATE action_items SET done_at = ? WHERE id = ?").run(a.done_at ? null : nowISO(), a.id);
  res.json({ ok: true });
});

// The standing weekly slot — either party sets or changes it.
const SLOT_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Reminders reworked for the lifecycle. Members: an escalating prepare box
// from T-3 until they publish (then a quiet confirmation). Owner: a prep row
// per published upcoming agenda — nothing pins for an unpublished draft, the
// pressure stays on whoever owes the agenda.
hubRouter.get("/api/oneonone-reminders", (req, res) => {
  const today = laDateStr();
  const domains = db.prepare(`
    SELECT d.id, d.oneonone_day, d.oneonone_time, u.name AS member_name, d.owner_user_id
    FROM domains d JOIN users u ON u.id = d.owner_user_id
    WHERE d.active = 1 AND d.oneonone_day IS NOT NULL
  `).all();
  const reminders = [];
  for (const d of domains) {
    const isMember = req.user.id === d.owner_user_id;
    if (!isMember && req.user.role !== "owner") continue;
    const m = ensureCurrentMeeting(d.id);
    if (!m?.meeting_date) continue;
    const daysOut = Math.round((new Date(`${m.meeting_date}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000);
    if (daysOut < 0 || daysOut > 3) continue;
    const agendaCount = m.agenda_snapshot_json ? JSON.parse(m.agenda_snapshot_json).length : null;
    if (isMember) {
      reminders.push({
        kind: m.status === "draft" ? "prepare" : "published",
        domain_id: d.id, member_name: d.member_name, day: d.oneonone_day, time: d.oneonone_time,
        meeting_date: m.meeting_date, days_out: daysOut, items: agendaCount, role: "member",
      });
    } else if (m.status === "published") {
      reminders.push({
        kind: "prep", domain_id: d.id, member_name: d.member_name,
        day: d.oneonone_day, time: d.oneonone_time,
        meeting_date: m.meeting_date, days_out: daysOut, items: agendaCount,
        auto_published: !!m.auto_published, role: "owner",
      });
    }
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

// Legacy path from the old "Create Agenda" button: now publishes the draft.
hubRouter.post("/api/domains/:id/one-on-ones", requireOneOnOneParty, (req, res) => {
  const m = ensureCurrentMeeting(req.domain.id);
  if (!m || m.status !== "draft") return res.status(400).json({ error: "This week's agenda is already published" });
  const agenda = publishMeeting(req.domain.id, m.id, req.user.id, false);
  res.json({ ok: true, id: m.id, agenda });
});

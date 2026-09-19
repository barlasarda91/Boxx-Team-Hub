import { Router } from "express";
import { db } from "../db.js";
import { nowISO, laDateStr, addDaysStr } from "../dates.js";
import {
  hashPin, verifyPin, createSession, sessionCookie,
  clearSessionCookie, destroySession, requireOwner,
} from "../auth.js";

export const hubRouter = Router();

// ─── Auth ─────────────────────────────────────────────────────────────────────
hubRouter.post("/api/auth/login", (req, res) => {
  const { name, pin } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE name = ? COLLATE NOCASE AND active = 1").get(name || "");
  if (!user || !verifyPin(pin, user.pin_hash)) {
    return res.status(401).json({ error: "Wrong name or PIN" });
  }
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
  if (!/^\d{4,6}$/.test(String(new_pin || ""))) return res.status(400).json({ error: "PIN must be 4-6 digits" });
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
  if (!/^\d{4,6}$/.test(String(new_pin || ""))) return res.status(400).json({ error: "PIN must be 4-6 digits" });
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
  res.json({ today, tiles, queue, week, recent_check_ins: recentCheckIns });
});

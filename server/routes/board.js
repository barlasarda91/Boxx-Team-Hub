import { Router } from "express";
import { db } from "../db.js";
import { nowISO, laDateStr } from "../dates.js";

export const boardRouter = Router();

// Everything here is deterministic — the composer's TYPE tag decides what a
// post is, and mentions are literal @Name matches against the roster. No LLM.

function roster() {
  return db.prepare("SELECT id, name, role FROM users WHERE active = 1").all();
}

// Literal matches only, resolved to stored names at post time so the badge
// logic stays one includes() check. @Arda is an alias for the owner account;
// @everyone resolves to the whole roster except the author.
function extractMentions(text, authorName) {
  const users = roster();
  const found = new Set(users.filter(u => new RegExp(`@${u.name}\\b`, "i").test(text || "")).map(u => u.name));
  const owner = users.find(u => u.role === "owner");
  if (owner && /@arda\b/i.test(text || "")) found.add(owner.name);
  if (/@everyone\b/i.test(text || "")) {
    for (const u of users) if (u.name !== authorName) found.add(u.name);
  }
  found.delete(authorName);
  return [...found];
}

const postWithAuthor = `
  SELECT p.*, u.name AS author_name FROM board_posts p
  JOIN users u ON u.id = p.author_id
`;

// Open blockers per member: who is holding whom, and for how long.
export function waitingSummary() {
  const open = db.prepare(
    `${postWithAuthor} WHERE p.kind = 'waiting_on' AND p.cleared_at IS NULL ORDER BY p.created_at`
  ).all();
  const today = laDateStr();
  const days = (iso) => Math.max(0, Math.round((new Date(today) - new Date(iso.slice(0, 10))) / 86400000));
  const byMember = {};
  for (const b of open) {
    const age = days(b.created_at);
    const h = (byMember[b.waiting_on] = byMember[b.waiting_on] || { holding: 0, oldest_days: 0, blocked_by: [] });
    h.holding++;
    h.oldest_days = Math.max(h.oldest_days, age);
    const a = (byMember[b.author_name] = byMember[b.author_name] || { holding: 0, oldest_days: 0, blocked_by: [] });
    if (!a.blocked_by.some(x => x.who === b.waiting_on)) a.blocked_by.push({ who: b.waiting_on, days: age });
  }
  return byMember;
}

// Blockers that sat 48h unresolved land in the owner's decision queue, same
// as overdue equipment. Called from the daily cron.
export function escalateStaleBlockers() {
  const cutoff = new Date(Date.now() - 48 * 3600000).toISOString();
  const stale = db.prepare(`
    ${postWithAuthor}
    WHERE p.kind = 'waiting_on' AND p.cleared_at IS NULL AND p.delivered_at IS NULL
      AND p.escalated_decision_id IS NULL AND p.created_at < ?
  `).all(cutoff);
  let n = 0;
  for (const b of stale) {
    const holder = db.prepare("SELECT id FROM users WHERE name = ?").get(b.waiting_on);
    const domain = holder
      ? db.prepare("SELECT id FROM domains WHERE owner_user_id = ? AND active = 1").get(holder.id)
      : null;
    const daysOld = Math.max(2, Math.round((Date.now() - new Date(b.created_at)) / 86400000));
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO decisions (domain_id, raised_by, source, source_ref, title, detail, state, created_at)
      VALUES (?, ?, 'board', ?, ?, ?, 'open', ?)
    `).run(domain?.id ?? null, b.author_id, String(b.id),
      `${b.author_name} has waited ${daysOld} days on ${b.waiting_on}`,
      `${b.text.slice(0, 200)}${b.need_by ? ` · need by ${b.need_by}` : ""}`, nowISO());
    db.prepare("UPDATE board_posts SET escalated_decision_id = ? WHERE id = ?").run(lastInsertRowid, b.id);
    n++;
  }
  return n;
}

// ─── Feed ─────────────────────────────────────────────────────────────────────
boardRouter.get("/api/board", (req, res) => {
  const posts = db.prepare(`${postWithAuthor} ORDER BY p.id DESC LIMIT 100`).all()
    .map(p => ({ ...p, mentions: p.mentions ? JSON.parse(p.mentions) : [] }));
  res.json({ posts, me: req.user.name });
});

boardRouter.post("/api/board", (req, res) => {
  const b = req.body || {};
  const kind = b.kind === "waiting_on" ? "waiting_on" : "post";
  const text = String(b.text || "").trim();
  if (!text) return res.status(400).json({ error: "Say something first" });
  if (text.length > 1000) return res.status(400).json({ error: "Keep it under 1000 characters" });

  let waitingOn = null, needBy = null;
  if (kind === "waiting_on") {
    waitingOn = String(b.waiting_on || "").trim();
    const target = roster().find(u => u.name === waitingOn);
    if (!target) return res.status(400).json({ error: "Pick who you're waiting on" });
    if (target.name === req.user.name) return res.status(400).json({ error: "You can't wait on yourself" });
    if (b.need_by) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.need_by)) return res.status(400).json({ error: "need_by must be YYYY-MM-DD" });
      needBy = b.need_by;
    }
  }

  const ATTACH_KINDS = ["event", "equipment", "invoice"];
  const attachKind = ATTACH_KINDS.includes(b.attach_kind) ? b.attach_kind : null;
  const attachLabel = attachKind ? String(b.attach_label || "").trim().slice(0, 80) || null : null;

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO board_posts (author_id, kind, text, mentions, attach_kind, attach_label, waiting_on, need_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, kind, text, JSON.stringify(extractMentions(text, req.user.name)),
    attachKind, attachKind ? attachLabel : null, waitingOn, needBy, nowISO());
  res.json({ ok: true, id: lastInsertRowid });
});

// Holder says "done — handing over"; the author confirms with clear.
boardRouter.post("/api/board/:id(\\d+)/delivered", (req, res) => {
  const p = db.prepare("SELECT * FROM board_posts WHERE id = ?").get(req.params.id);
  if (!p || p.kind !== "waiting_on") return res.status(404).json({ error: "Blocker not found" });
  if (p.cleared_at) return res.status(400).json({ error: "Already cleared" });
  if (req.user.name !== p.waiting_on && req.user.role !== "owner") {
    return res.status(403).json({ error: `Only ${p.waiting_on} can mark this delivered` });
  }
  db.prepare("UPDATE board_posts SET delivered_at = ? WHERE id = ?").run(p.delivered_at ? null : nowISO(), p.id);
  res.json({ ok: true });
});

boardRouter.post("/api/board/:id(\\d+)/clear", (req, res) => {
  const p = db.prepare("SELECT * FROM board_posts WHERE id = ?").get(req.params.id);
  if (!p || p.kind !== "waiting_on") return res.status(404).json({ error: "Blocker not found" });
  if (p.cleared_at) return res.status(400).json({ error: "Already cleared" });
  if (p.author_id !== req.user.id && req.user.role !== "owner") {
    return res.status(403).json({ error: "Only the person waiting can clear it" });
  }
  db.prepare("UPDATE board_posts SET cleared_at = ? WHERE id = ?").run(nowISO(), p.id);
  res.json({ ok: true });
});

// ─── Badge + read marker (polled by the nav) ──────────────────────────────────
boardRouter.get("/api/board/status", (req, res) => {
  const lastSeen = db.prepare("SELECT last_seen_id FROM board_reads WHERE user_id = ?").get(req.user.id)?.last_seen_id || 0;
  const latest = db.prepare("SELECT MAX(id) AS m FROM board_posts").get().m || 0;
  const unseen = db.prepare(`${postWithAuthor} WHERE p.id > ? AND p.author_id != ?`).all(lastSeen, req.user.id);
  const mentionsMe = unseen.filter(p => p.mentions && JSON.parse(p.mentions).includes(req.user.name)).length;
  const holding = db.prepare(
    "SELECT COUNT(*) AS n FROM board_posts WHERE kind = 'waiting_on' AND cleared_at IS NULL AND waiting_on = ?"
  ).get(req.user.name).n;
  res.json({ latest_id: latest, unseen: unseen.length, mentions: mentionsMe, holding });
});

boardRouter.post("/api/board/seen", (req, res) => {
  const latest = db.prepare("SELECT MAX(id) AS m FROM board_posts").get().m || 0;
  db.prepare(`
    INSERT INTO board_reads (user_id, last_seen_id) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_seen_id = excluded.last_seen_id
  `).run(req.user.id, latest);
  res.json({ ok: true });
});

// ─── Waiting-on views ─────────────────────────────────────────────────────────
// on_me: I'm the holder. mine: I'm the one waiting.
boardRouter.get("/api/waiting", (req, res) => {
  const open = db.prepare(
    `${postWithAuthor} WHERE p.kind = 'waiting_on' AND p.cleared_at IS NULL ORDER BY p.created_at`
  ).all();
  res.json({
    on_me: open.filter(p => p.waiting_on === req.user.name),
    mine: open.filter(p => p.author_name === req.user.name),
  });
});

boardRouter.get("/api/waiting/summary", (_req, res) => {
  res.json({ summary: waitingSummary() });
});

// ─── Attachment candidates (small, recent, deterministic) ─────────────────────
boardRouter.get("/api/board/attachables", (_req, res) => {
  const today = laDateStr();
  const events = db.prepare(
    "SELECT id, title, event_date FROM events WHERE status != 'cancelled' AND event_date >= ? ORDER BY event_date LIMIT 8"
  ).all(today);
  const equipment = db.prepare("SELECT id, name FROM equipment ORDER BY name LIMIT 12").all();
  const invoices = db.prepare(`
    SELECT i.id, i.invoice_number, v.name AS vendor_name FROM invoices i
    LEFT JOIN vendors v ON v.id = i.vendor_id
    WHERE i.source != 'import' ORDER BY i.id DESC LIMIT 8
  `).all();
  res.json({
    attachables: [
      ...events.map(e => ({ kind: "event", label: `${e.event_date?.slice(5).replace("-", "/") || ""} ${e.title}`.trim().slice(0, 60) })),
      ...equipment.map(e => ({ kind: "equipment", label: e.name.slice(0, 60) })),
      ...invoices.map(i => ({ kind: "invoice", label: `${i.vendor_name || "?"}${i.invoice_number ? ` #${i.invoice_number}` : ` inv ${i.id}`}`.slice(0, 60) })),
    ],
  });
});

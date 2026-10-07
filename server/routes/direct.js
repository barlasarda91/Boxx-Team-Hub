import { Router } from "express";
import { db } from "../db.js";
import { nowISO } from "../dates.js";
import { pushToNames } from "../push.js";

export const directRouter = Router();

// ─── The Direct Line ──────────────────────────────────────────────────────────
// A private thread per member: that member ↔ the owner, nobody else. Plain
// messages are quiet talk; 'decision' messages create a real row in the
// decisions table so the fast lane still writes the permanent log. All
// deterministic, no LLM.

function ownerUser() {
  return db.prepare("SELECT id, name FROM users WHERE role = 'owner' AND active = 1").get() || null;
}

// Only the thread's member or the owner may touch it.
function requireParty(req, res, next) {
  const memberId = Number(req.params.memberId);
  const member = db.prepare("SELECT id, name, active FROM users WHERE id = ? AND role != 'owner'").get(memberId);
  if (!member) return res.status(404).json({ error: "No such thread" });
  if (req.user.role !== "owner" && req.user.id !== member.id) {
    return res.status(403).json({ error: "This line is private" });
  }
  req.member = member;
  next();
}

const msgWithDecision = `
  SELECT dm.*, u.name AS author_name,
         d.state AS decision_state, d.owner_note AS decision_note, d.resolved_at AS decision_resolved_at
  FROM direct_messages dm
  JOIN users u ON u.id = dm.author_id
  LEFT JOIN decisions d ON d.id = dm.decision_id
`;

// Owner's inbox: one row per active member, newest activity first.
directRouter.get("/api/direct/threads", (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Owner only — members open their own line" });
  const members = db.prepare("SELECT id, name FROM users WHERE active = 1 AND role != 'owner' ORDER BY name").all();
  const threads = members.map(m => {
    const last = db.prepare(`${msgWithDecision} WHERE dm.member_id = ? ORDER BY dm.id DESC LIMIT 1`).get(m.id);
    const seen = db.prepare("SELECT last_seen_id FROM direct_reads WHERE user_id = ? AND member_id = ?")
      .get(req.user.id, m.id)?.last_seen_id || 0;
    const unread = db.prepare(
      "SELECT COUNT(*) n FROM direct_messages WHERE member_id = ? AND author_id != ? AND id > ?"
    ).get(m.id, req.user.id, seen).n;
    const pending = db.prepare(`
      SELECT COUNT(*) n FROM direct_messages dm JOIN decisions d ON d.id = dm.decision_id
      WHERE dm.member_id = ? AND d.state = 'open'
    `).get(m.id).n;
    return {
      member_id: m.id, name: m.name, unread, pending_decisions: pending,
      last: last ? { text: last.text, kind: last.kind, author_name: last.author_name, created_at: last.created_at } : null,
    };
  });
  threads.sort((a, b) => (b.last?.created_at || "").localeCompare(a.last?.created_at || "") || a.name.localeCompare(b.name));
  res.json({ threads });
});

// Nav badge: unread direct messages for whoever asks.
directRouter.get("/api/direct/unseen", (req, res) => {
  const mine = req.user.role === "owner"
    ? db.prepare("SELECT id FROM users WHERE active = 1 AND role != 'owner'").all().map(u => u.id)
    : [req.user.id];
  let unseen = 0;
  for (const memberId of mine) {
    const seen = db.prepare("SELECT last_seen_id FROM direct_reads WHERE user_id = ? AND member_id = ?")
      .get(req.user.id, memberId)?.last_seen_id || 0;
    unseen += db.prepare(
      "SELECT COUNT(*) n FROM direct_messages WHERE member_id = ? AND author_id != ? AND id > ?"
    ).get(memberId, req.user.id, seen).n;
  }
  res.json({ unseen });
});

// Read a thread — opening it marks it seen for the reader.
directRouter.get("/api/direct/:memberId(\\d+)", requireParty, (req, res) => {
  const messages = db.prepare(`${msgWithDecision} WHERE dm.member_id = ? ORDER BY dm.id LIMIT 300`).all(req.member.id);
  const maxId = messages.length ? messages[messages.length - 1].id : 0;
  db.prepare(`
    INSERT INTO direct_reads (user_id, member_id, last_seen_id) VALUES (?, ?, ?)
    ON CONFLICT(user_id, member_id) DO UPDATE SET last_seen_id = MAX(last_seen_id, excluded.last_seen_id)
  `).run(req.user.id, req.member.id, maxId);
  res.json({
    member: req.member,
    owner_name: ownerUser()?.name || "Arda",
    messages: messages.map(m => ({
      id: m.id, author_id: m.author_id, author_name: m.author_name, kind: m.kind,
      text: m.text, created_at: m.created_at,
      decision: m.decision_id ? {
        id: m.decision_id, state: m.decision_state,
        owner_note: m.decision_note, resolved_at: m.decision_resolved_at,
      } : null,
    })),
  });
});

// Post to a thread. Members may flag a message as a decision request — that
// writes a real decisions row (the owner's queue) alongside the chat card.
directRouter.post("/api/direct/:memberId(\\d+)", requireParty, (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Write the message first" });
  if (text.length > 1000) return res.status(400).json({ error: "Keep it under 1000 characters" });
  const kind = req.body?.kind === "decision" && req.user.role !== "owner" ? "decision" : "message";

  let decisionId = null;
  if (kind === "decision") {
    const domain = db.prepare("SELECT id FROM domains WHERE owner_user_id = ? AND active = 1").get(req.member.id);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO decisions (domain_id, raised_by, source, title, state, created_at)
      VALUES (?, ?, 'direct', ?, 'open', ?)
    `).run(domain?.id ?? null, req.user.id, text.slice(0, 200), nowISO());
    decisionId = lastInsertRowid;
  }
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO direct_messages (member_id, author_id, kind, text, decision_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(req.member.id, req.user.id, kind, text, decisionId, nowISO());
  // Author has obviously seen their own message
  db.prepare(`
    INSERT INTO direct_reads (user_id, member_id, last_seen_id) VALUES (?, ?, ?)
    ON CONFLICT(user_id, member_id) DO UPDATE SET last_seen_id = MAX(last_seen_id, excluded.last_seen_id)
  `).run(req.user.id, req.member.id, id);

  try {
    const other = req.user.role === "owner" ? req.member.name : ownerUser()?.name;
    if (other) pushToNames([other], {
      title: kind === "decision" ? `${req.user.name} needs a decision` : `${req.user.name} · direct line`,
      body: text.slice(0, 140), tag: `direct-${req.member.id}`,
    });
  } catch (err) { console.error("direct push:", err.message); }

  res.json({ ok: true, id, decision_id: decisionId });
});

// Housekeeping. Plain messages: either participant deletes, gone for both.
// Pending decision: only the asker withdraws it (removes the queue row too).
// Resolved decision: the chat card can be swept; the log row stays forever.
directRouter.delete("/api/direct/messages/:id(\\d+)", (req, res) => {
  const m = db.prepare(`
    SELECT dm.*, d.state AS decision_state FROM direct_messages dm
    LEFT JOIN decisions d ON d.id = dm.decision_id WHERE dm.id = ?
  `).get(req.params.id);
  if (!m) return res.status(404).json({ error: "Message not found" });
  if (req.user.role !== "owner" && req.user.id !== m.member_id) {
    return res.status(403).json({ error: "This line is private" });
  }
  const run = db.transaction(() => {
    if (m.decision_id && m.decision_state === "open" && req.user.id !== m.author_id) {
      throw new Error("Only whoever asked can withdraw a pending decision");
    }
    db.prepare("DELETE FROM direct_messages WHERE id = ?").run(m.id);
    if (m.decision_id && m.decision_state === "open") {
      db.prepare("DELETE FROM decisions WHERE id = ? AND state = 'open'").run(m.decision_id);
    }
  });
  try { run(); } catch (err) { return res.status(403).json({ error: err.message }); }
  res.json({ ok: true, withdrew_decision: !!(m.decision_id && m.decision_state === "open") });
});

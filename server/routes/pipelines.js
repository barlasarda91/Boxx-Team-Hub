import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, INVOICE_DIR } from "../db.js";
import { nowISO, laDateStr, addDaysStr } from "../dates.js";

export const pipelinesRouter = Router();

// Each domain's tools are usable by the owner and that member only.
const gate = (...names) => (req, res, next) => {
  if (req.user?.role === "owner" || names.includes(req.user?.name)) return next();
  res.status(403).json({ error: `That lives under ${names.join(" and ")}'s domain` });
};
const vicky = gate("Vicky");
const vickyAmin = gate("Vicky", "Amin");
const brandon = gate("Brandon");
const alex = gate("Alex");
const manny = gate("Manny");

// ─── Vicky: content calendar ──────────────────────────────────────────────────
const POSTS_DIR = path.resolve(path.dirname(INVOICE_DIR), "posts");
fs.mkdirSync(POSTS_DIR, { recursive: true });
const postUpload = multer({
  storage: multer.diskStorage({
    destination: POSTS_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname) || ".jpg"}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

pipelinesRouter.get("/api/posts", vicky, (req, res) => {
  const from = req.query.from || addDaysStr(laDateStr(), -45);
  const to = req.query.to || addDaysStr(laDateStr(), 45);
  const posts = db.prepare("SELECT * FROM posts WHERE post_date >= ? AND post_date <= ? ORDER BY post_date").all(from, to);
  const notes = db.prepare("SELECT * FROM week_notes WHERE week_monday >= ? AND week_monday <= ?").all(addDaysStr(from, -7), to);
  res.json({ from, to, posts, week_notes: notes });
});

pipelinesRouter.post("/api/posts", vicky, postUpload.single("image"), (req, res) => {
  const { post_date, platforms, caption, folder_url } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post_date || "")) return res.status(400).json({ error: "post_date required (YYYY-MM-DD)" });
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO posts (post_date, platforms, caption, image_path, folder_url, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(post_date, platforms || "", caption || "", req.file ? req.file.filename : null, folder_url || null, nowISO());
  res.json({ ok: true, id });
});

pipelinesRouter.patch("/api/posts/:id", vicky, postUpload.single("image"), (req, res) => {
  const p = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Post not found" });
  const b = req.body || {};
  db.prepare("UPDATE posts SET post_date = ?, platforms = ?, caption = ?, folder_url = ?, image_path = ? WHERE id = ?")
    .run(b.post_date || p.post_date, b.platforms ?? p.platforms, b.caption ?? p.caption,
      b.folder_url ?? p.folder_url, req.file ? req.file.filename : p.image_path, p.id);
  res.json({ ok: true });
});

pipelinesRouter.delete("/api/posts/:id", vicky, (req, res) => {
  db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

pipelinesRouter.get("/api/posts/:id/image", vicky, (req, res) => {
  const p = db.prepare("SELECT image_path FROM posts WHERE id = ?").get(req.params.id);
  if (!p?.image_path) return res.status(404).end();
  res.sendFile(path.join(POSTS_DIR, path.basename(p.image_path)));
});

pipelinesRouter.put("/api/week-notes/:monday", vicky, (req, res) => {
  db.prepare(`
    INSERT INTO week_notes (week_monday, note) VALUES (?, ?)
    ON CONFLICT(week_monday) DO UPDATE SET note = excluded.note
  `).run(req.params.monday, req.body?.note || "");
  res.json({ ok: true });
});

// ─── Shooting brief: shared between Vicky and Amin ───────────────────────────
pipelinesRouter.get("/api/briefs/:month", vickyAmin, (req, res) => {
  res.json({ brief: db.prepare("SELECT * FROM shooting_briefs WHERE month = ?").get(req.params.month) || null });
});
pipelinesRouter.put("/api/briefs/:month", vickyAmin, (req, res) => {
  db.prepare(`
    INSERT INTO shooting_briefs (month, text, folder_url, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(month) DO UPDATE SET text = excluded.text, folder_url = excluded.folder_url, updated_at = excluded.updated_at
  `).run(req.params.month, req.body?.text || "", req.body?.folder_url || null, nowISO());
  res.json({ ok: true });
});

// ─── Amin: content folders (links only) ───────────────────────────────────────
pipelinesRouter.get("/api/folders", vickyAmin, (_req, res) => {
  res.json({ folders: db.prepare("SELECT * FROM content_folders ORDER BY id DESC").all() });
});
pipelinesRouter.post("/api/folders", vickyAmin, (req, res) => {
  const { name, provider, url, note } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: "name and url required" });
  if (!/^https:\/\//.test(url)) return res.status(400).json({ error: "Links must start with https://" });
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO content_folders (name, provider, url, note, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(name, provider || null, url, note || null, nowISO());
  res.json({ ok: true, id });
});
pipelinesRouter.delete("/api/folders/:id", vickyAmin, (req, res) => {
  db.prepare("DELETE FROM content_folders WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ─── Vicky: influencers ───────────────────────────────────────────────────────
pipelinesRouter.get("/api/influencers", vicky, (_req, res) => {
  const influencers = db.prepare("SELECT * FROM influencers WHERE active = 1 ORDER BY tier, name").all();
  const collabs = db.prepare("SELECT * FROM collabs ORDER BY id DESC").all();
  const byInf = {};
  for (const c of collabs) (byInf[c.influencer_id] = byInf[c.influencer_id] || []).push(c);
  res.json({ influencers: influencers.map(i => ({ ...i, collabs: byInf[i.id] || [] })) });
});
pipelinesRouter.post("/api/influencers", vicky, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "name required" });
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO influencers (name, tier, platforms, followers, contact, status, next_step, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.name, Math.min(5, Math.max(1, Number(b.tier) || 3)), b.platforms || "", b.followers || "",
    b.contact || "", b.status || "", b.next_step || "", nowISO());
  res.json({ ok: true, id });
});
pipelinesRouter.patch("/api/influencers/:id", vicky, (req, res) => {
  const i = db.prepare("SELECT * FROM influencers WHERE id = ?").get(req.params.id);
  if (!i) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  db.prepare(`
    UPDATE influencers SET name = ?, tier = ?, platforms = ?, followers = ?, contact = ?, status = ?, next_step = ?, active = ?
    WHERE id = ?
  `).run(b.name ?? i.name, b.tier != null ? Math.min(5, Math.max(1, Number(b.tier))) : i.tier,
    b.platforms ?? i.platforms, b.followers ?? i.followers, b.contact ?? i.contact,
    b.status ?? i.status, b.next_step ?? i.next_step, b.active ?? i.active, i.id);
  res.json({ ok: true });
});
pipelinesRouter.post("/api/influencers/:id/collabs", vicky, (req, res) => {
  const b = req.body || {};
  if (!b.when_text || !b.description) return res.status(400).json({ error: "when_text and description required" });
  db.prepare("INSERT INTO collabs (influencer_id, when_text, description, cost, result) VALUES (?, ?, ?, ?, ?)")
    .run(req.params.id, b.when_text, b.description, b.cost || null, b.result || null);
  res.json({ ok: true });
});

// ─── Brandon: events, pace of two per month ───────────────────────────────────
pipelinesRouter.get("/api/events", brandon, (_req, res) => {
  const today = laDateStr();
  const month = today.slice(0, 7);
  const events = db.prepare("SELECT * FROM events ORDER BY event_date DESC LIMIT 60").all();
  const monthCount = events.filter(e => e.event_date.startsWith(month) && e.status !== "cancelled").length;
  const ytd = events.filter(e => e.event_date.startsWith(today.slice(0, 4)) && e.status !== "cancelled").length;
  res.json({ today, month, month_count: monthCount, target: 2, ytd, events });
});
pipelinesRouter.post("/api/events", brandon, (req, res) => {
  const b = req.body || {};
  if (!b.title || !/^\d{4}-\d{2}-\d{2}$/.test(b.event_date || "")) return res.status(400).json({ error: "title and event_date required" });
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO events (title, event_date, time_text, venue, status, staffing, setup, budget_note, recap, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.title, b.event_date, b.time_text || "", b.venue || "", b.status || "hold",
    b.staffing || "", b.setup || "", b.budget_note || "", b.recap || "", nowISO());
  res.json({ ok: true, id });
});
pipelinesRouter.patch("/api/events/:id", brandon, (req, res) => {
  const e = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!e) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  db.prepare(`
    UPDATE events SET title = ?, event_date = ?, time_text = ?, venue = ?, status = ?, staffing = ?, setup = ?, budget_note = ?, recap = ?
    WHERE id = ?
  `).run(b.title ?? e.title, b.event_date ?? e.event_date, b.time_text ?? e.time_text, b.venue ?? e.venue,
    b.status ?? e.status, b.staffing ?? e.staffing, b.setup ?? e.setup, b.budget_note ?? e.budget_note, b.recap ?? e.recap, e.id);
  res.json({ ok: true });
});

// ─── Alex: birthdays (T-30 pins, three checkboxes) + monthly team event ───────
function birthdayPins() {
  const today = laDateStr();
  const year = Number(today.slice(0, 4));
  const rows = db.prepare("SELECT * FROM birthdays").all();
  const pins = [];
  for (const r of rows) {
    for (const y of [year, year + 1]) {
      const bday = `${y}-${r.birth_date}`;
      const daysOut = Math.round((new Date(bday) - new Date(today)) / 86400000);
      if (daysOut < -7 || daysOut > 30) continue;   // pin T-30, keep a week after
      let task = db.prepare("SELECT * FROM birthday_tasks WHERE member_name = ? AND year = ?").get(r.member_name, y);
      if (!task) {
        db.prepare("INSERT INTO birthday_tasks (member_name, year) VALUES (?, ?)").run(r.member_name, y);
        task = db.prepare("SELECT * FROM birthday_tasks WHERE member_name = ? AND year = ?").get(r.member_name, y);
      }
      const done = task.cake_done_at && task.event_done_at && task.gift_done_at;
      if (!done || daysOut >= 0) pins.push({ ...task, birth_date: r.birth_date, date: bday, days_out: daysOut, all_done: !!done });
      break;
    }
  }
  pins.sort((a, b) => a.days_out - b.days_out);
  return pins;
}

pipelinesRouter.get("/api/wellness", alex, (_req, res) => {
  const today = laDateStr();
  res.json({
    today,
    birthdays: db.prepare("SELECT * FROM birthdays ORDER BY birth_date").all(),
    pins: birthdayPins(),
    team_events: db.prepare("SELECT * FROM team_events ORDER BY month DESC, id DESC LIMIT 18").all(),
    this_month: today.slice(0, 7),
  });
});
pipelinesRouter.put("/api/wellness/birthdays/:member", alex, (req, res) => {
  const bd = (req.body?.birth_date || "").trim();
  if (!/^\d{2}-\d{2}$/.test(bd)) return res.status(400).json({ error: "birth_date must be MM-DD" });
  db.prepare(`
    INSERT INTO birthdays (member_name, birth_date) VALUES (?, ?)
    ON CONFLICT(member_name) DO UPDATE SET birth_date = excluded.birth_date
  `).run(req.params.member, bd);
  res.json({ ok: true });
});
pipelinesRouter.post("/api/wellness/tasks/:id/toggle", alex, (req, res) => {
  const field = { cake: "cake_done_at", event: "event_done_at", gift: "gift_done_at" }[req.body?.field];
  if (!field) return res.status(400).json({ error: "field must be cake, event or gift" });
  const t = db.prepare("SELECT * FROM birthday_tasks WHERE id = ?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "Not found" });
  db.prepare(`UPDATE birthday_tasks SET ${field} = ? WHERE id = ?`).run(t[field] ? null : nowISO(), t.id);
  res.json({ ok: true });
});
pipelinesRouter.post("/api/wellness/team-events", alex, (req, res) => {
  const b = req.body || {};
  if (!b.title || !/^\d{4}-\d{2}$/.test(b.month || "")) return res.status(400).json({ error: "title and month (YYYY-MM) required" });
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO team_events (month, title, event_date, status, notes) VALUES (?, ?, ?, ?, ?)"
  ).run(b.month, b.title, b.event_date || null, b.status || "planned", b.notes || "");
  res.json({ ok: true, id });
});
pipelinesRouter.patch("/api/wellness/team-events/:id", alex, (req, res) => {
  const e = db.prepare("SELECT * FROM team_events WHERE id = ?").get(req.params.id);
  if (!e) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  db.prepare("UPDATE team_events SET title = ?, event_date = ?, status = ?, notes = ? WHERE id = ?")
    .run(b.title ?? e.title, b.event_date ?? e.event_date, b.status ?? e.status, b.notes ?? e.notes, e.id);
  res.json({ ok: true });
});

// ─── Manny: equipment register, deadline tasks, service log ───────────────────
pipelinesRouter.get("/api/equipment", manny, (_req, res) => {
  const today = laDateStr();
  const equipment = db.prepare("SELECT * FROM equipment ORDER BY name").all();
  const tasks = db.prepare("SELECT * FROM equipment_tasks WHERE done_at IS NULL ORDER BY due_date").all();
  const log = db.prepare("SELECT * FROM service_log ORDER BY entry_date DESC, id DESC LIMIT 100").all();
  res.json({ today, equipment, tasks, log });
});
pipelinesRouter.post("/api/equipment", manny, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "name required" });
  const { lastInsertRowid: id } = db.prepare("INSERT INTO equipment (name, detail, status) VALUES (?, ?, ?)")
    .run(b.name, b.detail || "", b.status || "ok");
  res.json({ ok: true, id });
});
pipelinesRouter.patch("/api/equipment/:id", manny, (req, res) => {
  const e = db.prepare("SELECT * FROM equipment WHERE id = ?").get(req.params.id);
  if (!e) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  db.prepare("UPDATE equipment SET name = ?, detail = ?, status = ? WHERE id = ?")
    .run(b.name ?? e.name, b.detail ?? e.detail, b.status ?? e.status, e.id);
  res.json({ ok: true });
});
pipelinesRouter.post("/api/equipment/:id/tasks", manny, (req, res) => {
  const b = req.body || {};
  if (!b.name || !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "")) return res.status(400).json({ error: "name and due_date required" });
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO equipment_tasks (equipment_id, name, due_date) VALUES (?, ?, ?)"
  ).run(req.params.id, b.name, b.due_date);
  res.json({ ok: true, id });
});
pipelinesRouter.post("/api/equipment-tasks/:id/done", manny, (req, res) => {
  const r = db.prepare("UPDATE equipment_tasks SET done_at = ? WHERE id = ? AND done_at IS NULL").run(nowISO(), req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: "Not found or already done" });
  res.json({ ok: true });
});
pipelinesRouter.post("/api/equipment/:id/log", manny, (req, res) => {
  const b = req.body || {};
  if (!b.text) return res.status(400).json({ error: "text required" });
  db.prepare("INSERT INTO service_log (equipment_id, entry_date, text, cost) VALUES (?, ?, ?, ?)")
    .run(req.params.id, b.entry_date || laDateStr(), b.text, b.cost || null);
  res.json({ ok: true });
});

// Overdue equipment deadlines escalate to the owner immediately (cron-called)
export function escalateOverdueEquipment() {
  const today = laDateStr();
  const overdue = db.prepare(`
    SELECT t.*, e.name AS equipment_name FROM equipment_tasks t
    JOIN equipment e ON e.id = t.equipment_id
    WHERE t.done_at IS NULL AND t.escalated_at IS NULL AND t.due_date < ?
  `).all(today);
  if (overdue.length === 0) return 0;
  const manny_ = db.prepare(
    "SELECT d.id AS domain_id, u.id AS user_id FROM domains d JOIN users u ON u.id = d.owner_user_id WHERE u.name = 'Manny'"
  ).get();
  for (const t of overdue) {
    db.prepare("INSERT INTO decisions (domain_id, raised_by, title, detail, state, created_at) VALUES (?, ?, ?, ?, 'open', ?)")
      .run(manny_?.domain_id || null, manny_?.user_id || null,
        `Equipment overdue: ${t.equipment_name} · ${t.name}`,
        `Due ${t.due_date}, now ${Math.round((new Date(today) - new Date(t.due_date)) / 86400000)} days over.`, nowISO());
    db.prepare("UPDATE equipment_tasks SET escalated_at = ? WHERE id = ?").run(nowISO(), t.id);
  }
  return overdue.length;
}

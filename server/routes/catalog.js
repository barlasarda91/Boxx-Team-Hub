import { Router } from "express";
import multer from "multer";
import { db } from "../db.js";
import { nowISO, laDateStr, addDaysStr } from "../dates.js";
import {
  importCatalogue, invalidateListingCache, buildCountReport,
  cheapestListingFor, priceComparison,
} from "../catalog.js";

export const catalogRouter = Router();

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ─── Catalogue ────────────────────────────────────────────────────────────────
catalogRouter.post("/api/catalog/import", memUpload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const result = importCatalogue(req.file.buffer);
    invalidateListingCache();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

catalogRouter.get("/api/catalog/items", (_req, res) => {
  const items = db.prepare("SELECT * FROM catalog_items WHERE active = 1 ORDER BY parent, category, front_name").all();
  const listings = db.prepare(`
    SELECT l.*, v.name AS vendor_name FROM catalog_listings l
    LEFT JOIN vendors v ON v.id = l.vendor_id WHERE l.active = 1
  `).all();
  const byItem = {};
  for (const l of listings) {
    (byItem[l.catalog_item_id] = byItem[l.catalog_item_id] || []).push({
      ...l,
      cost_per_unit: l.latest_pack_price && l.pack_qty ? l.latest_pack_price / l.pack_qty : null,
    });
  }
  res.json({ items: items.map(i => ({ ...i, listings: byItem[i.id] || [] })) });
});

catalogRouter.patch("/api/catalog/items/:id", (req, res) => {
  const item = db.prepare("SELECT * FROM catalog_items WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found" });
  const allowed = ["front_name", "parent", "category", "count_unit", "par_level", "active"];
  const sets = [], params = [];
  for (const key of allowed) {
    if (key in (req.body || {})) { sets.push(`${key} = ?`); params.push(req.body[key]); }
  }
  if (!sets.length) return res.status(400).json({ error: "No editable fields provided" });
  db.prepare(`UPDATE catalog_items SET ${sets.join(", ")} WHERE id = ?`).run(...params, item.id);
  invalidateListingCache();
  res.json({ ok: true });
});

catalogRouter.get("/api/catalog/price-comparison", (_req, res) => {
  res.json({ comparison: priceComparison() });
});

catalogRouter.get("/api/catalog/reorder", (_req, res) => {
  // Below par as of the latest confirmed count
  const latest = db.prepare(
    "SELECT * FROM count_sessions WHERE status = 'confirmed' ORDER BY confirmed_at DESC LIMIT 1"
  ).get();
  if (!latest) return res.json({ as_of: null, reorder: [] });
  const rows = db.prepare(`
    SELECT cl.units_counted, ci.* FROM count_lines cl
    JOIN catalog_items ci ON ci.id = cl.catalog_item_id
    WHERE cl.count_session_id = ? AND cl.units_counted IS NOT NULL
      AND ci.par_level IS NOT NULL AND cl.units_counted < ci.par_level
  `).all(latest.id);
  res.json({
    as_of: latest.confirmed_at,
    reorder: rows.map(r => {
      const cheapest = cheapestListingFor(r.id);
      return {
        catalog_item_id: r.id, front_name: r.front_name, counted: r.units_counted,
        par: r.par_level, unit: r.count_unit, short: r.par_level - r.units_counted,
        cheapest_vendor: cheapest?.vendor_name || null,
        cheapest_cost_per_unit: cheapest?.cost_per_unit ?? null,
      };
    }),
  });
});

// ─── Count sessions ───────────────────────────────────────────────────────────
catalogRouter.post("/api/counts", (req, res) => {
  const open = db.prepare("SELECT * FROM count_sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
  if (open) return res.json({ session_id: open.id, resumed: true });
  const items = db.prepare("SELECT id FROM catalog_items WHERE active = 1").all();
  if (items.length === 0) return res.status(400).json({ error: "Import the catalogue first" });
  const create = db.transaction(() => {
    const { lastInsertRowid: id } = db.prepare(
      "INSERT INTO count_sessions (user_id, started_at, status) VALUES (?, ?, 'open')"
    ).run(req.user.id, nowISO());
    const ins = db.prepare("INSERT INTO count_lines (count_session_id, catalog_item_id) VALUES (?, ?)");
    for (const it of items) ins.run(id, it.id);
    return id;
  });
  res.json({ session_id: create(), resumed: false });
});

catalogRouter.get("/api/counts", (_req, res) => {
  res.json({
    sessions: db.prepare(`
      SELECT cs.*, u.name AS user_name,
        (SELECT COUNT(*) FROM count_lines WHERE count_session_id = cs.id AND units_counted IS NOT NULL) AS counted,
        (SELECT COUNT(*) FROM count_lines WHERE count_session_id = cs.id) AS total
      FROM count_sessions cs LEFT JOIN users u ON u.id = cs.user_id
      ORDER BY cs.id DESC LIMIT 20
    `).all(),
  });
});

catalogRouter.get("/api/counts/:id", (req, res) => {
  const session = db.prepare("SELECT * FROM count_sessions WHERE id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: "Count not found" });
  const lines = db.prepare(`
    SELECT cl.id, cl.catalog_item_id, cl.units_counted,
           ci.front_name, ci.parent, ci.category, ci.count_unit, ci.par_level
    FROM count_lines cl JOIN catalog_items ci ON ci.id = cl.catalog_item_id
    WHERE cl.count_session_id = ?
    ORDER BY ci.parent, ci.category, ci.front_name
  `).all(session.id);
  res.json({
    session: { ...session, report: session.report_json ? JSON.parse(session.report_json) : null },
    lines,
  });
});

catalogRouter.patch("/api/counts/:id/lines", (req, res) => {
  const session = db.prepare("SELECT * FROM count_sessions WHERE id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: "Count not found" });
  if (session.status !== "open") return res.status(400).json({ error: "Count is already confirmed" });
  const lines = req.body?.lines;
  if (!Array.isArray(lines)) return res.status(400).json({ error: "lines array required" });
  const upd = db.prepare(
    "UPDATE count_lines SET units_counted = ? WHERE count_session_id = ? AND catalog_item_id = ?"
  );
  const run = db.transaction(() => {
    for (const l of lines) {
      upd.run(l.units_counted == null || l.units_counted === "" ? null : Number(l.units_counted),
        session.id, l.catalog_item_id);
    }
  });
  run();
  res.json({ ok: true });
});

catalogRouter.post("/api/counts/:id/confirm", (req, res) => {
  const session = db.prepare("SELECT * FROM count_sessions WHERE id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: "Count not found" });
  if (session.status !== "open") return res.status(400).json({ error: "Already confirmed" });
  db.prepare("UPDATE count_sessions SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(nowISO(), session.id);
  const report = buildCountReport(session.id);
  db.prepare("UPDATE count_sessions SET report_json = ? WHERE id = ?").run(JSON.stringify(report), session.id);
  res.json({ ok: true, report });
});

// ─── Published weekly pastry reports ──────────────────────────────────────────
import {
  publishWeekReport, lastCompletedMonday,
  missingReportMondays, backfillReports, isBackfilling,
} from "../pastryWeek.js";

catalogRouter.get("/api/pastry/reports", (_req, res) => {
  const rows = db.prepare(
    "SELECT monday, report_json, published_at FROM pastry_week_reports ORDER BY monday DESC LIMIT 26"
  ).all();
  // Fill any reachable past weeks in the background: back to the week of the
  // earliest standing order on file.
  const missing = missingReportMondays();
  if (missing.length > 0 && !isBackfilling()) {
    setImmediate(() => backfillReports().catch(err => console.error("pastry backfill:", err.message)));
  }
  res.json({
    last_completed_monday: lastCompletedMonday(),
    backfilling: missing.length > 0,
    missing: missing.length,
    reports: rows.map(r => {
      const rep = JSON.parse(r.report_json);
      return { monday: r.monday, to: rep.to, published_at: r.published_at, totals: rep.totals };
    }),
  });
});

catalogRouter.get("/api/pastry/reports/:monday", async (req, res) => {
  const monday = req.params.monday;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) return res.status(400).json({ error: "monday must be YYYY-MM-DD" });
  const row = db.prepare("SELECT * FROM pastry_week_reports WHERE monday = ?").get(monday);
  if (row) return res.json({ report: JSON.parse(row.report_json), published_at: row.published_at });
  if (monday > lastCompletedMonday()) return res.status(400).json({ error: "That week has not closed yet" });
  try {
    const report = await publishWeekReport(monday);
    res.json({ report, published_at: nowISO() });
  } catch (err) {
    res.status(500).json({ error: `Could not build the report: ${err.message}` });
  }
});

// ─── Price watch: Odeko & Shoreline price changes from confirmed invoices ─────
catalogRouter.get("/api/catalog/price-changes", (req, res) => {
  const to = laDateStr();
  const from = addDaysStr(to, -Number(req.query.days || 90));
  const obs = db.prepare(`
    SELECT po.vendor_id, v.name AS vendor_name, po.sku_key, po.unit_price, po.unit, po.observed_date
    FROM price_observations po
    JOIN vendors v ON v.id = po.vendor_id
    ORDER BY po.vendor_id, po.sku_key, po.observed_date, po.id
  `).all();
  const bySeries = new Map();
  for (const o of obs) {
    const key = `${o.vendor_id}|${o.sku_key}`;
    (bySeries.get(key) || bySeries.set(key, []).get(key)).push(o);
  }
  const changes = [];
  for (const series of bySeries.values()) {
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1], cur = series[i];
      const prevP = prev.unit_price, curP = cur.unit_price;
      if (prevP == null || curP == null || prevP === curP) continue;
      if (cur.observed_date < from || cur.observed_date > to) continue;
      const listing = db.prepare(`
        SELECT l.*, ci.front_name FROM catalog_listings l
        JOIN catalog_items ci ON ci.id = l.catalog_item_id
        WHERE l.vendor_id = ? AND l.active = 1
      `).all(cur.vendor_id).find(l => {
        const key = (l.sku || l.vendor_description || l.canonical_item || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        return cur.sku_key && key && (cur.sku_key.includes(key) || key.includes(cur.sku_key));
      });
      changes.push({
        vendor: cur.vendor_name,
        item: listing?.front_name || cur.sku_key,
        unit: cur.unit || null,
        from_price: prevP, to_price: curP,
        pct: Math.round(((curP - prevP) / prevP) * 1000) / 10,
        observed_date: cur.observed_date,
      });
    }
  }
  changes.sort((a, b) => b.observed_date.localeCompare(a.observed_date) || Math.abs(b.pct) - Math.abs(a.pct));
  res.json({ from, to, changes: changes.slice(0, 40) });
});

// ─── Pastry billing reconciliation ────────────────────────────────────────────
catalogRouter.get("/api/pastry/reconciliation", (req, res) => {
  const to = req.query.to || laDateStr();
  const from = req.query.from || addDaysStr(to, -29);
  const deliveries = db.prepare(`
    SELECT pd.*, i.invoice_number, v.name AS vendor_name
    FROM pastry_deliveries pd
    JOIN invoices i ON i.id = pd.invoice_id
    LEFT JOIN vendors v ON v.id = pd.vendor_id
    WHERE pd.delivery_date >= ? AND pd.delivery_date <= ?
    ORDER BY pd.delivery_date DESC
  `).all(from, to);
  const lineStmt = db.prepare("SELECT * FROM pastry_delivery_lines WHERE pastry_delivery_id = ? ORDER BY item_name");
  res.json({
    from, to,
    deliveries: deliveries.map(d => {
      const lines = lineStmt.all(d.id);
      return {
        ...d, lines,
        billed_total: lines.reduce((a, l) => a + l.qty_billed * (l.unit_price || 0), 0),
        mismatches: lines.filter(l => l.qty_expected != null && l.qty_expected !== l.qty_billed).length,
        unmatched: lines.filter(l => l.qty_expected == null).length,
      };
    }),
  });
});

import { Router } from "express";
import { db } from "../db.js";
import { nowISO } from "../dates.js";
import { listPastryCandidates } from "../square.js";
import { normKey, resolveSquareName, loadSquareMap, backfillReports, earliestOrderMonday } from "../pastryWeek.js";

export const squareMapRouter = Router();

// Mapping edits re-price history. Rebuild once, a minute after the last edit,
// so a batch of dropdown changes costs one pass instead of one per click.
let rebuildTimer = null;
function scheduleReportRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    const from = earliestOrderMonday();
    if (from) backfillReports({ from }).catch(err => console.error("map rebuild:", err.message));
  }, 60_000);
}

function appItems() {
  const v = db.prepare("SELECT id FROM standing_order_versions ORDER BY effective_date DESC, id DESC LIMIT 1").get();
  if (!v) return [];
  return db.prepare(
    "SELECT DISTINCT item_name FROM standing_order_items WHERE version_id = ? ORDER BY item_name"
  ).all(v.id).map(r => r.item_name);
}

// Everything Ben needs on one screen: every pastry / Grab n Go item ×
// variation in Square, what each one currently resolves to, and the list of
// app items to map against. status: 'mapped' (his rule), 'auto' (built-in
// alias or name match), 'ignored', 'unmapped'.
squareMapRouter.get("/api/square-map", async (_req, res) => {
  const items = appItems();
  const itemByNorm = new Map(items.map(i => [normKey(i), i]));
  const userMap = loadSquareMap();
  let candidates = [];
  let squareError = null;
  try {
    candidates = await listPastryCandidates();
  } catch (err) {
    squareError = err.message;
  }
  const rows = candidates.map(c => {
    const key = normKey(c.label);
    if (userMap.has(key)) {
      const target = userMap.get(key);
      return { ...c, key, status: target === null ? "ignored" : "mapped", app_item: target };
    }
    const resolved = resolveSquareName(c.label, new Map());
    const match = itemByNorm.get(normKey(resolved));
    if (match) return { ...c, key, status: "auto", app_item: match };
    return { ...c, key, status: "unmapped", app_item: null };
  });
  rows.sort((a, b) => (a.status === "unmapped" ? 0 : 1) - (b.status === "unmapped" ? 0 : 1)
    || a.label.localeCompare(b.label));
  res.json({
    app_items: items,
    square_error: squareError,
    unmapped: rows.filter(r => r.status === "unmapped").length,
    rows,
  });
});

// Set or change one mapping. app_item: an app item name, or null to ignore,
// or "" to clear the rule and fall back to automatic matching.
squareMapRouter.post("/api/square-map", (req, res) => {
  const label = (req.body?.square_label || "").toString().trim();
  if (!label) return res.status(400).json({ error: "square_label required" });
  const key = normKey(label);
  const raw = req.body?.app_item;
  if (raw === "") {
    db.prepare("DELETE FROM square_item_map WHERE square_key = ?").run(key);
    scheduleReportRebuild();
    return res.json({ ok: true, cleared: true });
  }
  const appItem = raw === null || raw === undefined ? null : String(raw).trim();
  if (appItem !== null && !appItems().some(i => i === appItem)) {
    return res.status(400).json({ error: `"${appItem}" is not on the standing order` });
  }
  db.prepare(`
    INSERT INTO square_item_map (square_key, square_label, app_item, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(square_key) DO UPDATE SET square_label = excluded.square_label,
      app_item = excluded.app_item, updated_at = excluded.updated_at
  `).run(key, label, appItem, nowISO());
  scheduleReportRebuild();
  res.json({ ok: true });
});

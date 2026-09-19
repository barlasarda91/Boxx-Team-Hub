import * as XLSX from "xlsx";
import { db } from "./db.js";
import { nowISO, laDateStr } from "./dates.js";
import { normalizeSkuKey } from "./pricing.js";

// ─── Boxx Master Item Catalogue import ────────────────────────────────────────
// Three-level naming: Front-Facing Name (count level) → Canonical Item →
// vendor listing. The sheet's historical invoice lines seed price history as
// confirmed invoices with source='import', so trends and alerts work from
// day one. Re-import replaces listings and import-history but preserves
// par levels and count units Ben has set.

function findHeaderRow(rows, mustHave) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = (rows[i] || []).map(c => String(c ?? "").trim());
    if (mustHave.every(h => cells.includes(h))) return i;
  }
  return -1;
}

function sheetObjects(wb, sheetName, mustHave) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const h = findHeaderRow(rows, mustHave);
  if (h < 0) return null;
  const headers = rows[h].map(c => String(c ?? "").trim());
  return rows.slice(h + 1).map(r => {
    const o = {};
    headers.forEach((name, i) => { if (name) o[name] = r[i]; });
    return o;
  }).filter(o => Object.values(o).some(v => v !== "" && v != null));
}

function num(v) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toISODate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().split("T")[0];
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v).trim());
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(String(v).trim());
  return iso ? iso[1] : null;
}

export function importCatalogue(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });

  const master = sheetObjects(wb, "Master Item Catalogue", ["Front-Facing Name", "Canonical Item", "Vendor"]);
  if (!master) throw new Error("Sheet 'Master Item Catalogue' with the expected columns not found");
  const history = sheetObjects(wb, "All Invoice Lines", ["Invoice", "Date", "Item as invoiced"]) || [];
  const notesSheet = sheetObjects(wb, "Notes", ["Item", "What it says"]) || [];

  const getVendor = db.prepare("SELECT id FROM vendors WHERE name = ? COLLATE NOCASE");
  const addVendor = db.prepare("INSERT INTO vendors (name, kind, active, created_at) VALUES (?, 'supply', 1, ?)");
  const vendorId = (name) => {
    const n = String(name || "").trim();
    if (!n) return null;
    const existing = getVendor.get(n);
    if (existing) return existing.id;
    return addVendor.run(n, nowISO()).lastInsertRowid;
  };

  const run = db.transaction(() => {
    // Items: upsert by front name, PRESERVING par_level / count_unit edits.
    const getItem = db.prepare("SELECT * FROM catalog_items WHERE front_name = ? COLLATE NOCASE");
    const insItem = db.prepare("INSERT INTO catalog_items (front_name, parent, category, count_unit, active) VALUES (?, ?, ?, ?, 1)");
    const updItem = db.prepare("UPDATE catalog_items SET parent = ?, category = ?, active = 1 WHERE id = ?");

    db.prepare("DELETE FROM catalog_listings").run();
    const insListing = db.prepare(`
      INSERT INTO catalog_listings
        (catalog_item_id, canonical_item, vendor_id, vendor_description, sku, pack_qty, order_unit, latest_pack_price, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    let items = 0, listings = 0;
    const itemIds = {};
    // The sheet leaves grouped cells blank (Parent / Category / Front name
    // carry down visually) — forward-fill while iterating.
    let carry = { parent: "", category: "", front: "" };
    for (const row of master) {
      carry = {
        parent:   String(row["Parent"] || "").trim() || carry.parent,
        category: String(row["Category"] || "").trim() || carry.category,
        front:    String(row["Front-Facing Name"] || "").trim() || carry.front,
      };
      const front = carry.front;
      const canonical = String(row["Canonical Item"] || "").trim();
      if (!front || !canonical) continue;
      row["Parent"] = carry.parent;
      row["Category"] = carry.category;
      let item = getItem.get(front);
      if (!item) {
        const id = insItem.run(front, String(row["Parent"] || "").trim() || null,
          String(row["Category"] || "").trim() || null,
          String(row["Unit"] || "").trim() || null).lastInsertRowid;
        item = { id };
        items++;
      } else {
        updItem.run(String(row["Parent"] || "").trim() || item.parent,
          String(row["Category"] || "").trim() || item.category, item.id);
      }
      itemIds[front.toLowerCase()] = item.id;
      insListing.run(
        item.id, canonical, vendorId(row["Vendor"]),
        String(row["Vendor Description"] || "").trim() || null,
        String(row["SKU"] || "").trim() || null,
        num(row["Pack Qty"]), String(row["Unit"] || "").trim() || null,
        num(row["Pack Price (latest)"])
      );
      listings++;
    }

    // Price history: replace previous import, group sheet lines into invoices.
    db.prepare("DELETE FROM invoices WHERE source = 'import'").run();
    const insInvoice = db.prepare(`
      INSERT INTO invoices (vendor_id, invoice_number, invoice_date, source, status, subtotal, total, confirmed_at, created_at)
      VALUES (?, ?, ?, 'import', 'confirmed', ?, ?, ?, ?)
    `);
    const insLine = db.prepare(`
      INSERT INTO invoice_line_items (invoice_id, sku, description, qty, unit, units_per_pack, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insObs = db.prepare(`
      INSERT INTO price_observations (vendor_id, sku_key, observed_date, unit_price, unit, invoice_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const groups = new Map();
    for (const row of history) {
      const invNo = String(row["Invoice"] || "").trim();
      const date = toISODate(row["Date"]);
      const vId = vendorId(row["Vendor"]);
      if (!invNo || !date || !vId) continue;
      const key = `${vId}|${invNo}|${date}`;
      if (!groups.has(key)) groups.set(key, { vId, invNo, date, lines: [] });
      groups.get(key).lines.push(row);
    }

    let invoicesCreated = 0, obs = 0;
    for (const g of groups.values()) {
      const subtotal = g.lines.reduce((a, l) => a + (num(l["Extension"]) || 0), 0);
      const { lastInsertRowid: invId } = insInvoice.run(g.vId, g.invNo, g.date, subtotal, subtotal, nowISO(), nowISO());
      invoicesCreated++;
      for (const l of g.lines) {
        const sku = String(l["SKU"] || "").trim() || null;
        const desc = String(l["Item as invoiced"] || "").trim();
        const unitPrice = num(l["Unit Price"]);
        if (!desc || unitPrice == null) continue;
        insLine.run(invId, sku, desc, num(l["Qty"]) ?? 0, String(l["Order UOM"] || "").trim() || null,
          num(l["Pack Qty"]), unitPrice, num(l["Extension"]) ?? 0);
        insObs.run(g.vId, normalizeSkuKey(sku, desc), g.date, unitPrice,
          String(l["Order UOM"] || "").trim() || null, invId);
        obs++;
      }
    }

    // Latest price date per listing from the history
    const updLatest = db.prepare("UPDATE catalog_listings SET latest_price_date = ? WHERE id = ?");
    for (const listing of db.prepare("SELECT * FROM catalog_listings").all()) {
      const key = normalizeSkuKey(listing.sku, listing.vendor_description || listing.canonical_item);
      const latest = db.prepare(
        "SELECT MAX(observed_date) d FROM price_observations WHERE vendor_id = ? AND sku_key = ?"
      ).get(listing.vendor_id, key);
      if (latest?.d) updLatest.run(latest.d, listing.id);
    }

    return { items, listings, invoices: invoicesCreated, observations: obs };
  });

  const result = run();
  result.notes = notesSheet.map(n => ({
    item: String(n["Item"] || "").trim(),
    says: String(n["What it says"] || "").trim(),
    why: String(n["Why it matters"] || "").trim(),
    confirm: String(n["Confirm?"] || "").trim(),
  })).filter(n => n.item);
  return result;
}

// ─── Matching an invoice line to a catalogue item ─────────────────────────────
let listingCache = null;
export function invalidateListingCache() { listingCache = null; }

function listings() {
  if (!listingCache) {
    listingCache = db.prepare(`
      SELECT l.*, i.front_name FROM catalog_listings l
      JOIN catalog_items i ON i.id = l.catalog_item_id
      WHERE l.active = 1 AND i.active = 1
    `).all().map(l => ({
      ...l,
      skuNorm: l.sku ? normalizeSkuKey(l.sku, "") : null,
      descNorm: normalizeSkuKey(null, l.vendor_description || l.canonical_item),
      canonNorm: normalizeSkuKey(null, l.canonical_item),
    }));
  }
  return listingCache;
}

export function matchListing(sku, description, vendorIdHint) {
  const skuNorm = sku ? normalizeSkuKey(sku, "") : null;
  const descNorm = normalizeSkuKey(null, description || "");
  const pool = listings();
  const scoped = vendorIdHint ? pool.filter(l => l.vendor_id === vendorIdHint) : pool;
  for (const set of [scoped, pool]) {
    if (skuNorm) {
      const bySku = set.find(l => l.skuNorm && l.skuNorm === skuNorm);
      if (bySku) return bySku;
    }
    const byDesc = set.find(l => l.descNorm === descNorm || l.canonNorm === descNorm);
    if (byDesc) return byDesc;
    const contains = set.find(l =>
      (descNorm.length > 6 && (l.descNorm.includes(descNorm) || descNorm.includes(l.descNorm))));
    if (contains) return contains;
  }
  return null;
}

// ─── Counts: usage variance between consecutive confirmed sessions ────────────
// usage = start count + units purchased in the interval − end count
export function buildCountReport(sessionId) {
  const session = db.prepare("SELECT * FROM count_sessions WHERE id = ?").get(sessionId);
  const prev = db.prepare(`
    SELECT * FROM count_sessions WHERE status = 'confirmed' AND id != ? AND confirmed_at < ?
    ORDER BY confirmed_at DESC LIMIT 1
  `).get(sessionId, session.confirmed_at || nowISO());

  const lines = db.prepare(`
    SELECT cl.*, ci.front_name, ci.par_level, ci.count_unit
    FROM count_lines cl JOIN catalog_items ci ON ci.id = cl.catalog_item_id
    WHERE cl.count_session_id = ? AND cl.units_counted IS NOT NULL
  `).all(sessionId);

  const belowPar = lines
    .filter(l => l.par_level != null && l.units_counted < l.par_level)
    .map(l => {
      const cheapest = cheapestListingFor(l.catalog_item_id);
      return {
        catalog_item_id: l.catalog_item_id, front_name: l.front_name,
        counted: l.units_counted, par: l.par_level, unit: l.count_unit,
        cheapest_vendor: cheapest?.vendor_name || null,
        cheapest_cost_per_unit: cheapest?.cost_per_unit ?? null,
      };
    });

  let variance = [];
  if (prev) {
    const prevLines = Object.fromEntries(db.prepare(
      "SELECT catalog_item_id, units_counted FROM count_lines WHERE count_session_id = ? AND units_counted IS NOT NULL"
    ).all(prev.id).map(l => [l.catalog_item_id, l.units_counted]));

    const from = (prev.confirmed_at || "").split("T")[0];
    const to = (session.confirmed_at || nowISO()).split("T")[0];
    const purchased = purchasedUnitsByItem(from, to);

    variance = lines
      .filter(l => prevLines[l.catalog_item_id] != null)
      .map(l => {
        const start = prevLines[l.catalog_item_id];
        const bought = purchased[l.catalog_item_id] || 0;
        return {
          catalog_item_id: l.catalog_item_id, front_name: l.front_name, unit: l.count_unit,
          start, purchased: bought, end: l.units_counted,
          usage: Math.round((start + bought - l.units_counted) * 100) / 100,
        };
      })
      .sort((a, b) => b.usage - a.usage);
  }

  return {
    counted: lines.length,
    window: prev ? { from: prev.confirmed_at, to: session.confirmed_at } : null,
    below_par: belowPar,
    variance,
  };
}

// Units purchased per catalogue item between two dates (confirmed invoices)
function purchasedUnitsByItem(from, to) {
  const rows = db.prepare(`
    SELECT ili.*, i.vendor_id AS inv_vendor FROM invoice_line_items ili
    JOIN invoices i ON i.id = ili.invoice_id
    WHERE i.status = 'confirmed' AND i.invoice_date >= ? AND i.invoice_date <= ?
  `).all(from, to);
  const out = {};
  for (const line of rows) {
    const listing = matchListing(line.sku, line.description, line.inv_vendor);
    if (!listing) continue;
    const perPack = line.units_per_pack || listing.pack_qty || 1;
    out[listing.catalog_item_id] = (out[listing.catalog_item_id] || 0) + (line.qty || 0) * perPack;
  }
  return out;
}

export function cheapestListingFor(catalogItemId) {
  const rows = db.prepare(`
    SELECT l.*, v.name AS vendor_name FROM catalog_listings l
    LEFT JOIN vendors v ON v.id = l.vendor_id
    WHERE l.catalog_item_id = ? AND l.active = 1 AND l.latest_pack_price IS NOT NULL AND l.pack_qty > 0
  `).all(catalogItemId);
  let best = null;
  for (const l of rows) {
    const cpu = l.latest_pack_price / l.pack_qty;
    if (!best || cpu < best.cost_per_unit) best = { ...l, cost_per_unit: cpu };
  }
  return best;
}

// ─── Dual-source price comparison ─────────────────────────────────────────────
// Canonical items sourced from 2+ vendors: latest $/unit each side, the
// cheaper source, and the yearly saving at trailing-365d volume.
export function priceComparison() {
  const all = db.prepare(`
    SELECT l.*, v.name AS vendor_name, i.front_name FROM catalog_listings l
    LEFT JOIN vendors v ON v.id = l.vendor_id
    JOIN catalog_items i ON i.id = l.catalog_item_id
    WHERE l.active = 1 AND l.latest_pack_price IS NOT NULL AND l.pack_qty > 0
  `).all();

  const byCanon = new Map();
  for (const l of all) {
    const key = normalizeSkuKey(null, l.canonical_item);
    if (!byCanon.has(key)) byCanon.set(key, []);
    byCanon.get(key).push(l);
  }

  const yearAgo = laDateStr(new Date(Date.now() - 365 * 86400000));
  const unitsByItem = purchasedUnitsByItem(yearAgo, laDateStr());

  const out = [];
  for (const group of byCanon.values()) {
    const vendors = new Map();
    for (const l of group) vendors.set(l.vendor_id, l);
    if (vendors.size < 2) continue;
    const sides = [...vendors.values()].map(l => ({
      vendor: l.vendor_name, cost_per_unit: l.latest_pack_price / l.pack_qty,
      pack: `${l.pack_qty} ${l.order_unit || ""}`.trim(), as_of: l.latest_price_date,
    })).sort((a, b) => a.cost_per_unit - b.cost_per_unit);
    const spread = sides[sides.length - 1].cost_per_unit - sides[0].cost_per_unit;
    const unitsYtd = unitsByItem[group[0].catalog_item_id] || 0;
    out.push({
      front_name: group[0].front_name,
      canonical_item: group[0].canonical_item,
      unit: group[0].order_unit,
      sides, cheaper: sides[0].vendor,
      spread_per_unit: Math.round(spread * 10000) / 10000,
      units_ytd: Math.round(unitsYtd),
      saving_at_volume: Math.round(spread * unitsYtd * 100) / 100,
    });
  }
  return out.sort((a, b) => b.saving_at_volume - a.saving_at_volume);
}

// ─── Pastry invoice → delivery reconciliation (Oh La La) ─────────────────────
// On confirm of a pastry-vendor invoice: record what was billed per item and
// what the standing order says should have been delivered that day.
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function expectedQtyFor(description, deliveryDate) {
  const version = db.prepare(
    "SELECT id FROM standing_order_versions WHERE effective_date <= ? ORDER BY effective_date DESC, id DESC LIMIT 1"
  ).get(deliveryDate);
  if (!version) return null;
  const dow = DAY_NAMES[new Date(`${deliveryDate}T12:00:00Z`).getUTCDay()];
  const items = db.prepare(
    "SELECT item_name, qty FROM standing_order_items WHERE version_id = ? AND day_of_week = ?"
  ).all(version.id, dow);
  const norm = normalizeSkuKey(null, description);
  let hit = items.find(i => normalizeSkuKey(null, i.item_name) === norm);
  if (!hit) hit = items.find(i => {
    const n = normalizeSkuKey(null, i.item_name);
    return n.length > 4 && (norm.includes(n) || n.includes(norm));
  });
  return hit ? hit.qty : null;
}

export function reconcilePastryInvoice(invoiceId) {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
  if (!invoice?.invoice_date) return { lines: 0 };
  const lines = db.prepare("SELECT * FROM invoice_line_items WHERE invoice_id = ?").all(invoiceId);
  const run = db.transaction(() => {
    db.prepare("DELETE FROM pastry_deliveries WHERE invoice_id = ?").run(invoiceId);
    const { lastInsertRowid: deliveryId } = db.prepare(
      "INSERT INTO pastry_deliveries (invoice_id, vendor_id, delivery_date) VALUES (?, ?, ?)"
    ).run(invoiceId, invoice.vendor_id, invoice.invoice_date);
    const ins = db.prepare(
      "INSERT INTO pastry_delivery_lines (pastry_delivery_id, item_name, qty_billed, unit_price, qty_expected) VALUES (?, ?, ?, ?, ?)"
    );
    for (const l of lines) {
      ins.run(deliveryId, l.description, l.qty || 0, l.unit_price ?? null,
        expectedQtyFor(l.description, invoice.invoice_date));
    }
    return lines.length;
  });
  return { lines: run() };
}

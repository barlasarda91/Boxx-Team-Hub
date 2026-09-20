import { db } from "./db.js";
import { squareSearchOrders } from "./square.js";
import { laDateStr, laToUtcISO, addDaysStr, nowISO } from "./dates.js";

const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const STORE_OPEN_H = 7;
const EARLY_MINS = 180; // sold out before 10am

// Square POS name (name + variation) → internal standing-order name.
// Mirrors src/lib/square.js — keep the two in sync.
const SQUARE_TO_INTERNAL = {
  "Croissant (Butter)":                   "Croissant",
  "Croissant (Almond)":                   "Almond Croissant",
  "Croissant (Chocolate Almond)":         "Chocolate Almond Croissant",
  "Croissant (Ham, Cheese & Bechamel)":   "Ham & Cheese",
  "Croissant (Mushroom Bechamel)":        "Mushroom & Bechamel",
  "Croissant (Pain Au Chocalat)":         "Pain Au Chocolat",
  "Croissant (Pain au Raisin et Orange)": "Pain Au Raisin Et Orange",
  "Croissant (Pain Suisse)":              "Pain Suisse",
  "Scone (Blueberry)":                    "Blueberry Scone",
  "Scone (Maple Sea Salt)":               "Maple Sea Salt Scone",
  "Kouign Amann":                         "Kouign Amann",
  "Monkey Bread":                         "Monkey Bread",
  "Chocalate Chip Cookie (Oh La La)":     "Chocolate Chip Cookie",
};
const GENERIC_VARIATIONS = new Set(["regular", "standard", "default", "n/a"]);

// All name matching happens on a normalized key: lowercase, accents and
// punctuation stripped. Mirrors src/lib/square.js — keep the two in sync.
export function normKey(name) {
  return (name || "").toString().normalize("NFKD")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
const ALIAS_BY_NORM = new Map(Object.entries(SQUARE_TO_INTERNAL).map(([k, v]) => [normKey(k), v]));

// Ben's own mapping wins over the built-in aliases; app_item NULL = ignore.
export function loadSquareMap() {
  const map = new Map();
  for (const r of db.prepare("SELECT square_key, app_item FROM square_item_map").all()) {
    map.set(r.square_key, r.app_item);
  }
  return map;
}

export function resolveSquareName(combined, userMap) {
  const key = normKey(combined);
  if (userMap.has(key)) return userMap.get(key);     // may be null = ignore
  return ALIAS_BY_NORM.get(key) || combined;
}

function laTimeLabel(iso) {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
  return parts.toLowerCase().replace(" ", "").replace("am", "a").replace("pm", "p");
}

function minutesFromOpen(iso) {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find(p => p.type === "hour").value);
  const m = Number(parts.find(p => p.type === "minute").value);
  return (h - STORE_OPEN_H) * 60 + m;
}

async function fetchWeekOrders(mondayStr) {
  const startISO = laToUtcISO(mondayStr, 7, 0);
  const endISO = laToUtcISO(addDaysStr(mondayStr, 6), 18, 0);
  let all = [], cursor = null;
  do {
    const data = await squareSearchOrders({
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: startISO, end_at: endISO } },
          state_filter: { states: ["COMPLETED"] },
        },
        sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
      },
      limit: 500,
      ...(cursor ? { cursor } : {}),
    });
    all = all.concat(data.orders || []);
    cursor = data.cursor || null;
  } while (cursor);
  return all;
}

function flattenOrders(orders) {
  const userMap = loadSquareMap();
  const result = {};
  for (const order of orders) {
    const createdAt = order.created_at;
    if (!createdAt) continue;
    const date = laDateStr(createdAt);
    for (const li of order.line_items || []) {
      const baseName = (li.name || "Unknown").trim();
      const variationName = li.variation_name?.trim();
      const combined = variationName && !GENERIC_VARIATIONS.has(variationName.toLowerCase())
        ? `${baseName} (${variationName})` : baseName;
      const resolved = resolveSquareName(combined, userMap);
      if (resolved === null) continue;               // explicitly ignored
      const name = normKey(resolved);
      const qty = parseFloat(li.quantity || 1);
      (result[date] = result[date] || {});
      (result[date][name] = result[date][name] || { sold: 0, lastSaleAt: null });
      result[date][name].sold += qty;
      if (!result[date][name].lastSaleAt || createdAt > result[date][name].lastSaleAt)
        result[date][name].lastSaleAt = createdAt;
    }
  }
  return result;
}

function ordersForDate(dateStr) {
  const v = db.prepare(
    "SELECT id FROM standing_order_versions WHERE effective_date <= ? ORDER BY effective_date DESC, id DESC LIMIT 1"
  ).get(dateStr);
  if (!v) return { days: {}, prices: {} };
  const rows = db.prepare(
    "SELECT item_name, day_of_week, qty, unit_price FROM standing_order_items WHERE version_id = ?"
  ).all(v.id);
  const days = {}, prices = {};
  for (const r of rows) {
    (days[r.item_name] = days[r.item_name] || {});
    days[r.item_name][r.day_of_week] = r.qty;
    if (r.unit_price != null) prices[r.item_name] = r.unit_price;
  }
  return { days, prices };
}

// The published shape a past week collapses into: totals, per-item rows
// with frequency and avg sell-out, the early list, and the billing check.
export async function buildWeekReport(mondayStr) {
  const tx = flattenOrders(await fetchWeekOrders(mondayStr));

  const allItems = new Set();
  const prices = {};
  const perDate = DAY_NAMES.map((dayName, i) => {
    const date = addDaysStr(mondayStr, i);
    const o = ordersForDate(date);
    for (const item of Object.keys(o.days)) allItems.add(item);
    Object.assign(prices, o.prices);
    return { dayName, date, orders: o.days };
  });

  const items = [...allItems].map(item => {
    const days = perDate.map(({ dayName, date, orders }) => {
      const ordered = orders[item]?.[dayName] || 0;
      const t = tx[date]?.[normKey(item)];
      const sold = t?.sold || 0;
      const soldOut = ordered > 0 && sold >= ordered;
      const waste = ordered > 0 ? Math.max(0, ordered - sold) : 0;
      const lastSaleAt = soldOut ? t?.lastSaleAt : null;
      return {
        day: dayName.slice(0, 3), date, ordered, sold: Math.round(sold), waste, soldOut,
        last_sale: laTimeLabel(t?.lastSaleAt || null),
        sellout_time: laTimeLabel(lastSaleAt),
        mins_from_open: lastSaleAt ? minutesFromOpen(lastSaleAt) : null,
      };
    });
    const ordered = days.reduce((a, d) => a + d.ordered, 0);
    const sold = days.reduce((a, d) => a + d.sold, 0);
    const waste = days.reduce((a, d) => a + d.waste, 0);
    const soldOutDays = days.filter(d => d.soldOut);
    const soMins = soldOutDays.map(d => d.mins_from_open).filter(m => m != null);
    const avgMins = soMins.length ? Math.round(soMins.reduce((a, b) => a + b, 0) / soMins.length) : null;
    const avgLabel = avgMins == null ? null : (() => {
      const h = STORE_OPEN_H + Math.floor(avgMins / 60), m = avgMins % 60;
      const hh = ((h + 11) % 12) + 1;
      return `${hh}:${String(m).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
    })();
    const unitPrice = prices[item] ?? null;
    return {
      item, ordered, sold, waste,
      unit_price: unitPrice,
      waste_value: unitPrice != null ? Math.round(waste * unitPrice * 100) / 100 : null,
      efficiency: ordered > 0 ? Math.round((sold / ordered) * 100) : null,
      sold_out_days: soldOutDays.length,
      avg_sellout: avgLabel,
      avg_sellout_early: avgMins != null && avgMins < EARLY_MINS,
      days,
    };
  }).filter(r => r.ordered > 0 || r.sold > 0)
    .sort((a, b) => b.waste - a.waste);

  const early = [];
  for (const r of items) {
    const hits = r.days.filter(d => d.soldOut && d.mins_from_open != null && d.mins_from_open < EARLY_MINS);
    if (hits.length) early.push({ item: r.item, times: hits.map(d => `${d.day} ${d.sellout_time}`) });
  }
  early.sort((a, b) => b.times.length - a.times.length);

  // Billing check: pastry deliveries reconciled inside this week
  const to = addDaysStr(mondayStr, 6);
  const deliveries = db.prepare(
    "SELECT id FROM pastry_deliveries WHERE delivery_date >= ? AND delivery_date <= ?"
  ).all(mondayStr, to);
  let billed = 0, mismatches = [];
  for (const d of deliveries) {
    const lines = db.prepare("SELECT * FROM pastry_delivery_lines WHERE pastry_delivery_id = ?").all(d.id);
    for (const l of lines) {
      billed += l.qty_billed * (l.unit_price || 0);
      if (l.qty_expected != null && l.qty_expected !== l.qty_billed) {
        const dd = db.prepare("SELECT delivery_date FROM pastry_deliveries WHERE id = ?").get(d.id);
        mismatches.push({ date: dd.delivery_date, item: l.item_name, billed: l.qty_billed, expected: l.qty_expected });
      }
    }
  }

  const ordered = items.reduce((a, r) => a + r.ordered, 0);
  const sold = items.reduce((a, r) => a + r.sold, 0);
  const waste = items.reduce((a, r) => a + r.waste, 0);
  return {
    monday: mondayStr, to,
    totals: {
      ordered, sold, waste,
      waste_value: Math.round(items.reduce((a, r) => a + (r.waste_value || 0), 0) * 100) / 100,
      efficiency: ordered > 0 ? Math.round((sold / ordered) * 100) : null,
      sold_out_items: items.filter(r => r.sold_out_days > 0).length,
    },
    items, early,
    billing: { invoices: deliveries.length, billed: Math.round(billed * 100) / 100, mismatches },
  };
}

export async function publishWeekReport(mondayStr) {
  const report = await buildWeekReport(mondayStr);
  db.prepare(`
    INSERT INTO pastry_week_reports (monday, report_json, published_at) VALUES (?, ?, ?)
    ON CONFLICT(monday) DO UPDATE SET report_json = excluded.report_json, published_at = excluded.published_at
  `).run(mondayStr, JSON.stringify(report), nowISO());
  return report;
}

// Monday of the last fully completed week, LA time
export function lastCompletedMonday() {
  const today = laDateStr();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0=Sun
  const thisMonday = addDaysStr(today, -((dow + 6) % 7));
  return addDaysStr(thisMonday, -7);
}

export function mondayOf(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return addDaysStr(dateStr, -((dow + 6) % 7));
}

// Reports can reach back to the week of the earliest standing order on file.
export function earliestOrderMonday() {
  const row = db.prepare("SELECT MIN(effective_date) AS d FROM standing_order_versions").get();
  return row?.d ? mondayOf(row.d) : null;
}

export function missingReportMondays() {
  const start = earliestOrderMonday();
  if (!start) return [];
  const last = lastCompletedMonday();
  const have = new Set(db.prepare("SELECT monday FROM pastry_week_reports").all().map(r => r.monday));
  const out = [];
  for (let m = start; m <= last; m = addDaysStr(m, 7)) if (!have.has(m)) out.push(m);
  return out;
}

// Build every reachable past week. With `from`, weeks from that Monday on are
// rebuilt even if already published (a backdated order re-prices them).
let backfillRunning = false;
export const isBackfilling = () => backfillRunning;

export async function backfillReports({ from } = {}) {
  if (backfillRunning) return { started: false };
  backfillRunning = true;
  try {
    const start = from ? mondayOf(from) : earliestOrderMonday();
    if (!start) return { count: 0 };
    const last = lastCompletedMonday();
    let count = 0;
    for (let m = start; m <= last; m = addDaysStr(m, 7)) {
      if (!from && db.prepare("SELECT 1 FROM pastry_week_reports WHERE monday = ?").get(m)) continue;
      try {
        await publishWeekReport(m);
        count++;
        await new Promise(r => setTimeout(r, 250));
      } catch (err) {
        // Square down or rate-limited: stop rather than hammer; the next
        // request or Monday cron picks the backfill up again.
        console.error(`pastry backfill stopped at ${m}: ${err.message}`);
        break;
      }
    }
    return { count };
  } finally {
    backfillRunning = false;
  }
}

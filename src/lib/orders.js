import * as XLSX from "xlsx";
import { DAY_NAMES, addDaysStr, formatTime, minutesFromOpen } from "./dates.js";
import { normKey } from "./square.js";

// ─── XLSX parser ──────────────────────────────────────────────────────────────
// Tolerant of the current sheet format: an item column (Product/Item/Name),
// day columns as full names or Mon/Tue/…, an optional unit price column
// (Price / Unit Price / $), and a weekly Total column which is ignored.
export function parseVendorXLSX(arrayBuffer, vendorName) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (rows.length === 0) return {};

  const headers = Object.keys(rows[0]);
  const norm = (h) => h.toString().trim().toLowerCase();
  const dayCol = {};
  for (const day of DAY_NAMES) {
    dayCol[day] = headers.find(h => {
      const n = norm(h);
      return n === day.toLowerCase() || n === day.slice(0, 3).toLowerCase() || n.startsWith(day.toLowerCase());
    }) || null;
  }
  const nameCol = headers.find(h => ["product", "item", "name", "pastry"].includes(norm(h)))
    || headers.find(h => rows.some(r => isNaN(parseFloat(r[h])) && String(r[h]).trim()));
  const priceCol = headers.find(h => /^(unit )?price$|unit \$|\$\/|price per/i.test(norm(h))) || null;

  const money = (v) => {
    const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const items = {};
  rows.forEach(row => {
    const name = (row[nameCol] || "").toString().trim();
    if (!name || name.toLowerCase().startsWith("total") || name.toLowerCase().startsWith("week")) return;
    const daily = {};
    DAY_NAMES.forEach(day => { daily[day] = dayCol[day] ? (parseFloat(row[dayCol[day]]) || 0) : 0; });
    const entry = { vendor: vendorName, daily };
    if (priceCol) {
      const p = money(row[priceCol]);
      if (p != null) entry.unit_price = p;
    }
    items[toTitleCase(name)] = entry;
  });
  return items;
}

// Title-case a string (capitalize first letter of each word)
export function toTitleCase(str) {
  const minors = new Set(["a","an","the","and","but","or","for","nor","on","at","to","by","in","of","up"]);
  return str.trim().split(/\s+/).map((word, i) => {
    const lower = word.toLowerCase();
    if (i === 0 || !minors.has(lower)) {
      return lower.replace(/(^|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
    }
    return lower;
  }).join(" ");
}

// ─── Standing order history helpers ──────────────────────────────────────────
// History: [{ effectiveDate: "YYYY-MM-DD", orders: {...} }, ...]
// The active standing order for a date is the most recent version with
// effectiveDate <= date — resolved per-day, not per-week.
export function getActiveOrdersForDate(history, dateStr) {
  if (!history || history.length === 0) return null;
  const sorted = [...history].sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const active = sorted.find(v => v.effectiveDate <= dateStr);
  return active ? active.orders : sorted[sorted.length - 1].orders;
}

export function getActiveOrders(history, mondayStr) {
  return getActiveOrdersForDate(history, mondayStr) || {};
}

// ─── Weekly analysis ──────────────────────────────────────────────────────────
export function analyzeWeek(standingOrders, txByDate, mondayStr, history) {
  const allItems = new Set();
  DAY_NAMES.forEach((_, i) => {
    const date   = addDaysStr(mondayStr, i);
    const orders = history?.length ? (getActiveOrdersForDate(history, date) || standingOrders) : standingOrders;
    Object.keys(orders).forEach(item => allItems.add(item));
  });

  return [...allItems].map(item => {
    let vendor = standingOrders[item]?.vendor;
    const dayResults = DAY_NAMES.map((dayName, i) => {
      const date       = addDaysStr(mondayStr, i);
      const orders     = history?.length ? (getActiveOrdersForDate(history, date) || standingOrders) : standingOrders;
      const itemData   = orders[item];
      if (!vendor && itemData?.vendor) vendor = itemData.vendor;
      const ordered    = itemData?.daily?.[dayName] || 0;
      const txDay      = txByDate[date]?.[normKey(item)];
      const sold       = txDay?.sold || 0;
      const soldOut    = ordered > 0 && sold >= ordered && sold === ordered;
      const oversold   = ordered > 0 && sold > ordered;
      const lastSaleAt = (soldOut || oversold) ? txDay?.lastSaleAt : null;
      const efficiency = ordered > 0 ? Math.min(100, Math.round((sold/ordered)*100)) : null;
      const waste      = ordered > 0 ? Math.max(0, ordered - sold) : 0;
      return { dayName, date, ordered, sold, soldOut, oversold, waste,
               sellOutTime: formatTime(lastSaleAt),
               minsFromOpen: minutesFromOpen(lastSaleAt), efficiency };
    });
    const effs      = dayResults.filter(d => d.efficiency != null).map(d => d.efficiency);
    const soldOutDs = dayResults.filter(d => d.soldOut && d.minsFromOpen != null);
    const unitPrice = standingOrders[item]?.unit_price
      ?? (history?.length ? getActiveOrdersForDate(history, mondayStr)?.[item]?.unit_price : null)
      ?? null;
    return {
      item, vendor, unitPrice, dayResults,
      soldOutCount:   dayResults.filter(d => d.soldOut || d.oversold).length,
      oversoldCount:  dayResults.filter(d => d.oversold).length,
      totalSold:      dayResults.reduce((a,d) => a+d.sold, 0),
      totalOrdered:   dayResults.reduce((a,d) => a+d.ordered, 0),
      totalWaste:     dayResults.reduce((a,d) => a+d.waste, 0),
      avgEff:         effs.length ? Math.round(effs.reduce((a,b)=>a+b,0)/effs.length) : null,
      avgSellOutMins: soldOutDs.length ? Math.round(soldOutDs.reduce((a,d)=>a+d.minsFromOpen,0)/soldOutDs.length) : null,
    };
  });
}

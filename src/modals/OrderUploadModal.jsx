import { useState, useRef } from "react";
import { api } from "../lib/api.js";
import { DAY_NAMES, laDateStr } from "../lib/dates.js";
import { parseVendorXLSX } from "../lib/orders.js";
import { BX, label, tag, card, bodyText, btnPrimary, btnGhost, inputBx } from "../lib/boxx.js";
import BxModal from "../components/BxModal.jsx";

const VENDOR = "Oh La La";

// One vendor, any capture: a spreadsheet parses locally, a screenshot or
// photo goes through Claude. Either way the result lands in an editable
// review grid before anything is saved.
export default function OrderUploadModal({ onSave, onClose }) {
  const [effectiveDate, setEffectiveDate] = useState(laDateStr());
  const [rows, setRows] = useState(null);   // [{ item, daily{}, unit_price }]
  const [busy, setBusy] = useState(null);   // status text while parsing/extracting
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const fromOrders = (orders) => Object.entries(orders).map(([item, d]) => ({
    item, daily: { ...d.daily }, unit_price: d.unit_price ?? null,
  }));

  const handleFile = async (file) => {
    if (!file) return;
    setError(null);
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith(".xlsx") || name.endsWith(".csv") || name.endsWith(".xls")) {
        setBusy("Reading the sheet…");
        const buf = await file.arrayBuffer();
        const orders = parseVendorXLSX(buf, VENDOR);
        if (Object.keys(orders).length === 0) throw new Error("No items found. The sheet needs an item column and Monday to Sunday quantities.");
        setRows(fromOrders(orders));
      } else {
        setBusy("Reading the screenshot…");
        const fd = new FormData();
        fd.append("file", file);
        const { orders } = await api.upload("/api/standing-orders/extract", fd);
        setRows(fromOrders(orders));
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  };

  const setQty = (i, day, v) => setRows(rs => rs.map((r, idx) =>
    idx === i ? { ...r, daily: { ...r.daily, [day]: v === "" ? 0 : Math.max(0, Math.round(Number(v) || 0)) } } : r));
  const setPrice = (i, v) => setRows(rs => rs.map((r, idx) =>
    idx === i ? { ...r, unit_price: v === "" ? null : Number(v) || null } : r));
  const setName = (i, v) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, item: v } : r));
  const removeRow = (i) => setRows(rs => rs.filter((_, idx) => idx !== i));
  const addRow = () => setRows(rs => [...(rs || []), { item: "", daily: Object.fromEntries(DAY_NAMES.map(d => [d, 0])), unit_price: null }]);

  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return setError("Pick an effective date first.");
    const orders = {};
    for (const r of rows || []) {
      const item = r.item.trim();
      if (!item) continue;
      orders[item] = { vendor: VENDOR, daily: r.daily, ...(r.unit_price != null ? { unit_price: r.unit_price } : {}) };
    }
    if (Object.keys(orders).length === 0) return setError("Nothing to save.");
    setSaving(true);
    try { await onSave(orders, effectiveDate); }
    catch (err) { setError(err.message); setSaving(false); }
  };

  const weekQty = (r) => DAY_NAMES.reduce((a, d) => a + (r.daily[d] || 0), 0);
  const weekTotal = (rows || []).reduce((a, r) => a + (r.unit_price != null ? weekQty(r) * r.unit_price : 0), 0);
  const hasPrices = (rows || []).some(r => r.unit_price != null);

  return (
    <BxModal title={`Standing order · ${VENDOR}`} onClose={onClose} width={rows ? 860 : 560}>
      <div style={{ padding: "16px 22px", borderBottom: `1px solid ${BX.STONE}`, display: "flex",
        gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <div style={label({ fontSize: 8, marginBottom: 6 })}>EFFECTIVE DATE</div>
          <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}
            style={inputBx({ fontSize: 13 })} />
        </div>
        <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD, flexBasis: 260, flexGrow: 1 })}>
          Applies to every day on or after this date. A past date backfills history: those weeks re-price and their reports fill in.
        </span>
      </div>

      {!rows && (
        <div style={{ padding: 22 }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,image/png,image/jpeg,image/webp,application/pdf"
            style={{ display: "none" }} onChange={e => { handleFile(e.target.files[0]); e.target.value = ""; }} />
          <button onClick={() => fileRef.current.click()} disabled={!!busy}
            style={{ width: "100%", padding: "36px 20px", background: "none", cursor: "pointer",
              border: `1px dashed ${BX.LINEN}`, textAlign: "center" }}>
            <div style={label({ color: BX.INK, marginBottom: 8 })}>{busy || "Choose a file or screenshot"}</div>
            <div style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>
              xlsx or csv parses instantly. A screenshot or photo of the order grid is read by Claude and shown here for review.
            </div>
          </button>
          {error && <div style={{ marginTop: 12, color: BX.RUST, fontSize: 12 }}>{error}</div>}
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={addRow} style={btnGhost({ padding: "9px 16px", fontSize: 9 })}>Or enter by hand</button>
          </div>
        </div>
      )}

      {rows && (
        <>
          <div style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 10, alignItems: "baseline" }}>
            <span style={tag(BX.OLIVE)}>REVIEW BEFORE SAVING</span>
            <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>Check every number against the source. Nothing saves until you confirm.</span>
            <button onClick={() => { setRows(null); setError(null); }}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
                ...label({ fontSize: 8, textDecoration: "underline", color: BX.INK }) }}>
              START OVER
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BX.MONO }}>
              <thead><tr>
                {["ITEM", ...DAY_NAMES.map(d => d.slice(0, 3).toUpperCase()), "UNIT $", "WEEK", ""].map(h => (
                  <th key={h} style={{ textAlign: h === "ITEM" ? "left" : "center", padding: "9px 8px",
                    fontWeight: 400, fontSize: 8, letterSpacing: "0.14em", color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.LINEN}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: "4px 8px 4px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
                      <input value={r.item} onChange={e => setName(i, e.target.value)} placeholder="Item"
                        style={inputBx({ width: 168, padding: "6px 8px", fontSize: 12, fontFamily: BX.SERIF })} />
                    </td>
                    {DAY_NAMES.map(d => (
                      <td key={d} style={{ padding: 4, borderBottom: `1px solid ${BX.STONE}` }}>
                        <input value={r.daily[d] ?? 0} inputMode="numeric" onChange={e => setQty(i, d, e.target.value)}
                          style={inputBx({ width: 44, padding: "6px 4px", fontSize: 12, textAlign: "center" })} />
                      </td>
                    ))}
                    <td style={{ padding: 4, borderBottom: `1px solid ${BX.STONE}` }}>
                      <input value={r.unit_price ?? ""} inputMode="decimal" placeholder="·" onChange={e => setPrice(i, e.target.value)}
                        style={inputBx({ width: 60, padding: "6px 4px", fontSize: 12, textAlign: "right" })} />
                    </td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontSize: 11, fontWeight: 400, borderBottom: `1px solid ${BX.STONE}`, whiteSpace: "nowrap" }}>
                      {r.unit_price != null ? `$${(weekQty(r) * r.unit_price).toFixed(2)}` : `${weekQty(r)}`}
                    </td>
                    <td style={{ padding: 4, borderBottom: `1px solid ${BX.STONE}` }}>
                      <button onClick={() => removeRow(i)} aria-label={`Remove ${r.item || "row"}`}
                        style={{ background: "none", border: "none", cursor: "pointer", color: BX.RUST, fontSize: 13 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 22px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={addRow} style={btnGhost({ padding: "8px 14px", fontSize: 8 })}>+ Row</button>
            {hasPrices && (
              <span style={label({ fontSize: 8 })}>
                WEEK TOTAL ${weekTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
            {error && <span style={{ color: BX.RUST, fontSize: 12 }}>{error}</span>}
            <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              <button onClick={onClose} style={btnGhost({ padding: "11px 18px", fontSize: 9 })}>Cancel</button>
              <button onClick={save} disabled={saving} style={btnPrimary({ opacity: saving ? 0.5 : 1 })}>
                {saving ? "Saving…" : `Save · effective ${effectiveDate}`}
              </button>
            </span>
          </div>
        </>
      )}
    </BxModal>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { BX, label, eyebrow, tag, card, serifH, bodyText, btnPrimary, btnGhost, inputBx } from "../lib/boxx.js";

const fmtU = (n) => n == null ? "—" : `$${Number(n).toFixed(3)}`;

// Ben's catalogue: import from the master xlsx, pars, dual-source pricing,
// the reorder list, and pastry billing reconciliation.
export default function CatalogView({ isMobile }) {
  const [items, setItems] = useState(null);
  const [comparison, setComparison] = useState([]);
  const [reorder, setReorder] = useState(null);
  const [pastry, setPastry] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  const load = useCallback(async () => {
    try {
      const [i, c, r, p] = await Promise.all([
        api.get("/api/catalog/items"),
        api.get("/api/catalog/price-comparison"),
        api.get("/api/catalog/reorder"),
        api.get("/api/pastry/reconciliation"),
      ]);
      setItems(i.items); setComparison(c.comparison); setReorder(r); setPastry(p);
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const doImport = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await api.upload("/api/catalog/import", fd);
      setImportResult(result);
      load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const setPar = async (id, par) => {
    try {
      await api.patch(`/api/catalog/items/${id}`, { par_level: par === "" ? null : Number(par) });
    } catch (err) { setError(err.message); }
  };

  if (!items) return <div style={bodyText({ padding: 20 })}>{error || "Loading…"}</div>;

  const byParent = {};
  for (const it of items) (byParent[it.parent || "Other"] = byParent[it.parent || "Other"] || []).push(it);

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 300, color: BX.INK, maxWidth: 980 }}>
      {error && <div style={{ color: BX.RUST, fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {/* Import */}
      <div style={card({ padding: "14px 18px", marginBottom: 8, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" })}>
        <div>
          <div style={label({ color: BX.INK })}>Master Item Catalogue</div>
          <div style={{ fontSize: 11, color: BX.DRIFTWOOD, marginTop: 4 }}>
            {items.length} items · re-import replaces listings, keeps your pars
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }}
          onChange={e => { doImport(e.target.files[0]); e.target.value = ""; }} />
        <button onClick={() => fileRef.current.click()} disabled={busy}
          style={btnPrimary({ marginLeft: "auto", opacity: busy ? 0.5 : 1 })}>
          {busy ? "Importing…" : items.length ? "Re-import xlsx" : "Import xlsx"}
        </button>
      </div>

      {importResult && (
        <div style={card({ padding: "14px 18px", marginBottom: 8, borderColor: BX.OLIVE })}>
          <div style={eyebrow({ marginBottom: 8 })}>Import complete</div>
          <div style={bodyText({ fontSize: 12 })}>
            {importResult.items} new items · {importResult.listings} listings · {importResult.invoices} historical invoices · {importResult.observations} price points seeded.
          </div>
          {importResult.notes?.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BX.STONE}` }}>
              <div style={label({ fontSize: 8, marginBottom: 6 })}>Naming notes from the sheet — review:</div>
              {importResult.notes.map((n, i) => (
                <div key={i} style={bodyText({ fontSize: 11, marginBottom: 5 })}>
                  <span style={{ fontWeight: 400, color: BX.INK }}>{n.item}:</span> {n.says}. {n.why} {n.confirm && <span style={{ color: BX.AMBER }}>{n.confirm}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reorder list */}
      {reorder?.reorder?.length > 0 && (
        <div style={card({ marginBottom: 8, borderColor: BX.RUST })}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between" }}>
            <span style={label({ color: BX.RUST, letterSpacing: "0.22em" })}>Reorder · below par</span>
            <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>from count {new Date(reorder.as_of).toLocaleDateString()}</span>
          </div>
          {reorder.reorder.map(r => (
            <div key={r.catalog_item_id} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`,
              display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 14 }}>{r.front_name}</span>
              <span style={{ fontSize: 11, color: BX.RUST }}>{r.counted} of par {r.par} · short {r.short} {r.unit || ""}</span>
              <span style={{ fontSize: 11, color: BX.DRIFTWOOD, marginLeft: "auto" }}>
                cheapest: {r.cheapest_vendor || "?"} {r.cheapest_cost_per_unit != null && `· ${fmtU(r.cheapest_cost_per_unit)}/u`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Dual-source price comparison */}
      <div style={card({ marginBottom: 8 })}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Where to buy · dual-sourced items</span>
        </div>
        {comparison.length === 0 && <div style={bodyText({ padding: "14px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>Import the catalogue to see vendor comparisons.</div>}
        {comparison.slice(0, 12).map((c, i) => (
          <div key={i} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`,
            display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 14, minWidth: isMobile ? "100%" : 170 }}>{c.front_name}</span>
            <span style={tag(BX.OLIVE)}>{c.cheaper.toUpperCase()}</span>
            <span style={{ fontSize: 11, color: BX.GRAPHITE }}>
              {c.sides.map(s => `${s.vendor} ${fmtU(s.cost_per_unit)}`).join(" vs ")}
            </span>
            <span style={{ fontSize: 11, color: c.saving_at_volume > 50 ? BX.RUST : BX.DRIFTWOOD, marginLeft: "auto" }}>
              ${c.saving_at_volume}/yr at volume
            </span>
          </div>
        ))}
      </div>

      {/* Pastry billing */}
      <div style={card({ marginBottom: 8 })}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Pastry billing · billed vs standing order</span>
        </div>
        {(!pastry || pastry.deliveries.length === 0) && (
          <div style={bodyText({ padding: "14px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>
            No confirmed Oh La La invoices in the last 30 days.
          </div>
        )}
        {pastry?.deliveries?.map(d => (
          <div key={d.id} style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.STONE}` }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontFamily: BX.MONO, fontWeight: 400, fontSize: 10, letterSpacing: "0.1em" }}>{d.delivery_date}</span>
              <span style={{ fontSize: 11, color: BX.DRIFTWOOD }}>{d.vendor_name} · ${d.billed_total.toFixed(2)}</span>
              {d.mismatches > 0 && <span style={tag(BX.AMBER)}>{d.mismatches} MISMATCH</span>}
              {d.unmatched > 0 && <span style={tag(BX.DRIFTWOOD)}>{d.unmatched} UNMATCHED</span>}
            </div>
            {d.lines.filter(l => l.qty_expected == null || l.qty_expected !== l.qty_billed).map(l => (
              <div key={l.id} style={{ fontSize: 11, color: l.qty_expected == null ? BX.DRIFTWOOD : BX.AMBER, padding: "2px 0" }}>
                {l.item_name}: billed {l.qty_billed}{l.qty_expected != null ? `, standing order says ${l.qty_expected}` : " · not on the standing order"}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Items with pars */}
      {Object.entries(byParent).map(([parent, group]) => (
        <div key={parent} style={card({ marginBottom: 8 })}>
          <div style={{ padding: "11px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={eyebrow()}>{parent}</span>
          </div>
          {group.map(it => (
            <div key={it.id} style={{ padding: "9px 18px", borderBottom: `1px solid ${BX.STONE}`,
              display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 13, minWidth: isMobile ? "60%" : 200 }}>{it.front_name}</span>
              <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>
                {it.listings.map(l => `${l.vendor_name || "?"} ${l.cost_per_unit != null ? fmtU(l.cost_per_unit) : ""}`).join(" · ")}
              </span>
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: BX.DRIFTWOOD }}>
                PAR
                <input defaultValue={it.par_level ?? ""} inputMode="decimal"
                  onBlur={e => e.target.value !== String(it.par_level ?? "") && setPar(it.id, e.target.value)}
                  style={inputBx({ width: 64, padding: "6px 8px", fontSize: 12, textAlign: "center" })} />
              </label>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

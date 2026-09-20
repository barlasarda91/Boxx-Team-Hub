import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { BX, label, eyebrow, tag, card, bodyText, btnPrimary, inputBx } from "../lib/boxx.js";

// The Catalogue tab mirrors the master item sheet, nothing else: groups,
// vendor listings with SKUs and pack sizes, and the pars Ben counts against.
// Pricing lives in Orders; stock lives in Count.
export default function CatalogView({ isMobile }) {
  const [items, setItems] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  const load = useCallback(async () => {
    try { setItems((await api.get("/api/catalog/items")).items); }
    catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const doImport = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      setImportResult(await api.upload("/api/catalog/import", fd));
      load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const setPar = async (id, par) => {
    try { await api.patch(`/api/catalog/items/${id}`, { par_level: par === "" ? null : Number(par) }); }
    catch (err) { setError(err.message); }
  };

  if (!items) return <div style={bodyText({ padding: 20 })}>{error || "Loading…"}</div>;

  const byParent = {};
  for (const it of items) (byParent[it.parent || "Other"] = byParent[it.parent || "Other"] || []).push(it);
  const listingLine = (it) => it.listings
    .map(l => `${l.vendor_name || "?"}${l.sku ? ` #${l.sku}` : ""}${l.pack_qty ? ` · pack of ${l.pack_qty}` : ""}`)
    .join("  ·  ");

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 980 }}>
      {error && <div style={{ color: BX.RUST, fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={card({ padding: "14px 18px", marginBottom: 8, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" })}>
        <div>
          <div style={label({ color: BX.INK })}>Master Item Catalogue</div>
          <div style={{ fontSize: 11, color: BX.DRIFTWOOD, marginTop: 4 }}>
            {items.length} items · {items.reduce((a, i) => a + i.listings.length, 0)} vendor listings · re-import replaces listings, keeps your pars
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
                  <span style={{ fontWeight: 500, color: BX.INK }}>{n.item}:</span> {n.says}. {n.why} {n.confirm && <span style={{ color: BX.AMBER }}>{n.confirm}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {Object.entries(byParent).map(([parent, group]) => (
        <div key={parent} style={card({ marginBottom: 8 })}>
          <div style={{ padding: "11px 18px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between" }}>
            <span style={eyebrow()}>{parent}</span>
            <span style={label({ fontSize: 8 })}>PARENT GROUP</span>
          </div>
          {group.map(it => (
            <div key={it.id} style={{ padding: "9px 18px", borderBottom: `1px solid ${BX.STONE}`,
              display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 13, minWidth: isMobile ? "100%" : 200 }}>{it.front_name}</span>
              <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>{listingLine(it)}</span>
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
      <div style={{ margin: "4px 2px 0" }}>
        <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>
          Names, groups, SKUs and pack sizes mirror the master sheet. Pars are the only edit made here.
        </span>
      </div>
    </div>
  );
}

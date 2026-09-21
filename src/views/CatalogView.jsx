import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { BX, label, eyebrow, tag, card, bodyText, btnPrimary, btnGhost, inputBx } from "../lib/boxx.js";
import BxModal from "../components/BxModal.jsx";

// The Catalogue tab mirrors the master item sheet, plus the review queue:
// confirmed Odeko/Shoreline invoice lines that matched no listing wait here
// for Ben to link, add, or ignore. Pricing lives in Orders; stock in Count.
export default function CatalogView({ isMobile, onQueueCount }) {
  const [items, setItems] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState([]);
  const [showReview, setShowReview] = useState(false);
  const fileRef = useRef();

  const load = useCallback(async () => {
    try { setItems((await api.get("/api/catalog/items")).items); }
    catch (err) { setError(err.message); }
    try {
      const q = await api.get("/api/catalog/review-queue");
      setQueue(q.open);
      onQueueCount?.(q.count);
    } catch { /* queue is additive — the catalogue still renders without it */ }
  }, [onQueueCount]);
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

      {/* Unknown items from confirmed invoices — surface card, detail in pop-up */}
      {queue.length > 0 && (
        <div style={card({ padding: "14px 18px", marginBottom: 8, borderColor: BX.AMBER,
          display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" })}>
          <div>
            <div style={label({ color: BX.AMBER })}>
              {queue.length} invoice item{queue.length === 1 ? "" : "s"} not in the catalogue
            </div>
            <div style={{ fontSize: 11, color: BX.DRIFTWOOD, marginTop: 4 }}>
              {queue.slice(0, 3).map(q => q.description).join(" · ")}{queue.length > 3 ? " · …" : ""}
            </div>
          </div>
          <button onClick={() => setShowReview(true)} style={btnPrimary({ marginLeft: "auto", whiteSpace: "nowrap" })}>
            Review
          </button>
        </div>
      )}

      {showReview && (
        <ReviewQueueModal queue={queue} items={items} onClose={() => setShowReview(false)} onChanged={load} />
      )}

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

// One row per unknown line: link to an existing item (suggestion preselected),
// add it as a new item, or ignore it for good.
function ReviewQueueModal({ queue, items, onClose, onChanged }) {
  const [picks, setPicks] = useState(() =>
    Object.fromEntries(queue.map(q => [q.id, q.suggested_catalog_item_id || ""])));
  const [addingId, setAddingId] = useState(null);     // row in "add new item" mode
  const [draft, setDraft] = useState({ front_name: "", parent: "", count_unit: "" });
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const resolve = async (id, body) => {
    setBusyId(id); setError(null);
    try {
      await api.post(`/api/catalog/review-queue/${id}/resolve`, body);
      setAddingId(null);
      onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusyId(null); }
  };

  return (
    <BxModal title={`INVOICE ITEMS TO REVIEW · ${queue.length}`} onClose={onClose} width={760}>
      <div style={{ padding: "6px 0 14px" }}>
        {error && <div style={{ color: BX.RUST, fontSize: 12, padding: "10px 22px 0" }}>{error}</div>}
        {queue.length === 0 && (
          <div style={bodyText({ padding: "18px 22px", color: BX.DRIFTWOOD })}>All reviewed. Nothing waiting.</div>
        )}
        {queue.map(q => (
          <div key={q.id} style={{ padding: "14px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 14 }}>{q.description}</span>
              <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>
                {q.vendor_name || "?"}{q.sku ? ` · #${q.sku}` : ""}
                {q.unit_price != null ? ` · $${q.unit_price.toFixed(2)}${q.unit ? `/${q.unit}` : ""}` : ""}
              </span>
              {q.suggested_name && <span style={tag(BX.OLIVE)}>SUGGESTED: {q.suggested_name.toUpperCase()}</span>}
            </div>

            {addingId === q.id ? (
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <input value={draft.front_name} placeholder="Front-facing name" autoFocus
                  onChange={e => setDraft(d => ({ ...d, front_name: e.target.value }))}
                  style={inputBx({ fontSize: 12, padding: "8px 10px", width: 200 })} />
                <input value={draft.parent} placeholder="Group (e.g. Dairy)"
                  onChange={e => setDraft(d => ({ ...d, parent: e.target.value }))}
                  style={inputBx({ fontSize: 12, padding: "8px 10px", width: 150 })} />
                <input value={draft.count_unit} placeholder="Count unit"
                  onChange={e => setDraft(d => ({ ...d, count_unit: e.target.value }))}
                  style={inputBx({ fontSize: 12, padding: "8px 10px", width: 110 })} />
                <button disabled={busyId === q.id || !draft.front_name.trim()}
                  onClick={() => resolve(q.id, { action: "add", ...draft })}
                  style={btnPrimary({ padding: "9px 14px", fontSize: 9, opacity: !draft.front_name.trim() ? 0.4 : 1 })}>
                  Add item
                </button>
                <button onClick={() => setAddingId(null)}
                  style={btnGhost({ padding: "9px 12px", fontSize: 9, borderColor: BX.LINEN, color: BX.DRIFTWOOD })}>✕</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select value={picks[q.id]} onChange={e => setPicks(p => ({ ...p, [q.id]: e.target.value }))}
                  style={inputBx({ fontSize: 12, padding: "8px 10px", maxWidth: 260 })}>
                  <option value="">— link to catalogue item —</option>
                  {(items || []).map(it => <option key={it.id} value={it.id}>{it.front_name}</option>)}
                </select>
                <button disabled={busyId === q.id || !picks[q.id]}
                  onClick={() => resolve(q.id, { action: "link", catalog_item_id: Number(picks[q.id]) })}
                  style={btnPrimary({ padding: "9px 14px", fontSize: 9, opacity: !picks[q.id] ? 0.4 : 1 })}>
                  Link
                </button>
                <button disabled={busyId === q.id}
                  onClick={() => { setAddingId(q.id); setDraft({ front_name: q.description, parent: "", count_unit: q.unit || "" }); }}
                  style={btnGhost({ padding: "9px 14px", fontSize: 9 })}>
                  New item
                </button>
                <button disabled={busyId === q.id} onClick={() => resolve(q.id, { action: "ignore" })}
                  style={btnGhost({ padding: "9px 14px", fontSize: 9, borderColor: BX.LINEN, color: BX.DRIFTWOOD, marginLeft: "auto" })}>
                  Ignore
                </button>
              </div>
            )}
          </div>
        ))}
        <div style={bodyText({ fontSize: 10, color: BX.DRIFTWOOD, padding: "12px 22px 0" })}>
          Linked and added items become vendor listings that survive re-imports of the master sheet.
          Ignored items never come back for this vendor.
        </div>
      </div>
    </BxModal>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { BX, label, eyebrow, tag, card, bodyText, btnPrimary, btnGhost, inputBx } from "../lib/boxx.js";

// Inventory count sheet — mobile-first: Ben walks the shop with his phone.
// Lines autosave (debounced) while the count is open; Confirm builds the
// report (below par + usage variance vs the previous confirmed count).
export default function CountView({ isMobile }) {
  const [sessions, setSessions] = useState(null);
  const [active, setActive] = useState(null); // { session, lines }
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef({});
  const timer = useRef(null);

  const loadSessions = useCallback(async () => {
    try { setSessions((await api.get("/api/counts")).sessions); }
    catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  const openSession = async (id) => {
    try {
      const data = await api.get(`/api/counts/${id}`);
      setActive(data);
      setReport(data.session.report || null);
      setError(null);
    } catch (err) { setError(err.message); }
  };

  const startCount = async () => {
    try {
      const { session_id } = await api.post("/api/counts");
      openSession(session_id);
    } catch (err) { setError(err.message); }
  };

  const flush = useCallback(async (sessionId) => {
    const batch = Object.entries(pending.current)
      .map(([catalog_item_id, units_counted]) => ({ catalog_item_id: Number(catalog_item_id), units_counted }));
    if (!batch.length) return;
    pending.current = {};
    setSaving(true);
    try { await api.patch(`/api/counts/${sessionId}/lines`, { lines: batch }); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }, []);

  const setCount = (catalogItemId, value) => {
    setActive(a => ({
      ...a,
      lines: a.lines.map(l => l.catalog_item_id === catalogItemId ? { ...l, units_counted: value } : l),
    }));
    pending.current[catalogItemId] = value;
    clearTimeout(timer.current);
    const sid = active.session.id;
    timer.current = setTimeout(() => flush(sid), 700);
  };

  const confirm = async () => {
    clearTimeout(timer.current);
    await flush(active.session.id);
    try {
      const { report: r } = await api.post(`/api/counts/${active.session.id}/confirm`);
      setReport(r);
      setActive(a => ({ ...a, session: { ...a.session, status: "confirmed" } }));
      loadSessions();
    } catch (err) { setError(err.message); }
  };

  // ── Session list ────────────────────────────────────────────────────────────
  if (!active) {
    return (
      <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 720 }}>
        {error && <div style={{ color: BX.RUST, fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={card({ padding: "16px 18px", marginBottom: 8, display: "flex", alignItems: "center", gap: 14 })}>
          <div>
            <div style={label({ color: BX.INK })}>Inventory count</div>
            <div style={{ fontSize: 11, color: BX.DRIFTWOOD, marginTop: 4 }}>
              Count on hand, then Log Inventory to lock it in. The report flags below-par and usage since the last logged count.
            </div>
          </div>
          <button onClick={startCount} style={btnPrimary({ marginLeft: "auto", whiteSpace: "nowrap" })}>
            {sessions?.some(s => s.status === "open") ? "Resume count" : "Start count"}
          </button>
        </div>
        <div style={card()}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={eyebrow()}>Past counts</span>
          </div>
          {(sessions || []).length === 0 && (
            <div style={bodyText({ padding: "14px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>No counts yet.</div>
          )}
          {(sessions || []).map(s => (
            <div key={s.id} onClick={() => openSession(s.id)}
              style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer",
                display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 14 }}>
                {new Date(s.confirmed_at || s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
              <span style={{ fontSize: 11, color: BX.DRIFTWOOD }}>{s.user_name} · {s.counted}/{s.total} counted</span>
              <span style={tag(s.status === "open" ? BX.AMBER : BX.DRIFTWOOD, { marginLeft: "auto" })}>
                {s.status === "open" ? "IN PROGRESS" : "LOGGED"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Active session ──────────────────────────────────────────────────────────
  const open = active.session.status === "open";
  const counted = active.lines.filter(l => l.units_counted != null).length;
  const byParent = {};
  for (const l of active.lines) (byParent[l.parent || "Other"] = byParent[l.parent || "Other"] || []).push(l);

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 720,
      paddingBottom: open ? 90 : 0 }}>
      {error && <div style={{ color: BX.RUST, fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => { setActive(null); setReport(null); loadSessions(); }}
          style={btnGhost({ padding: "8px 14px", fontSize: 9 })}>← Counts</button>
        <span style={{ fontFamily: BX.SERIF, fontSize: 17 }}>
          {open ? "Count in progress" : `Count · ${new Date(active.session.confirmed_at).toLocaleDateString()}`}
        </span>
        {!open && <span style={tag(BX.DRIFTWOOD)}>LOGGED · LOCKED</span>}
        <span style={{ fontSize: 10, color: BX.DRIFTWOOD, marginLeft: "auto" }}>
          {counted}/{active.lines.length}{saving ? " · saving…" : ""}
        </span>
      </div>

      {/* Report (after confirm, or reopening a confirmed count) */}
      {report && (
        <>
          <div style={card({ marginBottom: 8, borderColor: report.below_par?.length ? BX.RUST : BX.LINEN })}>
            <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
              <span style={label({ color: report.below_par?.length ? BX.RUST : BX.INK, letterSpacing: "0.22em" })}>
                Below par · {report.below_par?.length || 0} items
              </span>
            </div>
            {(report.below_par || []).map((b, i) => (
              <div key={i} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`,
                display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontFamily: BX.SERIF, fontSize: 14 }}>{b.front_name}</span>
                <span style={{ fontSize: 11, color: BX.RUST }}>{b.counted} of par {b.par}</span>
                <span style={{ fontSize: 11, color: BX.DRIFTWOOD, marginLeft: "auto" }}>
                  {b.cheapest_vendor ? `order from ${b.cheapest_vendor}` : ""}
                  {b.cheapest_cost_per_unit != null && ` · $${b.cheapest_cost_per_unit.toFixed(3)}/u`}
                </span>
              </div>
            ))}
            {!(report.below_par || []).length && (
              <div style={bodyText({ padding: "12px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>Everything at or above par.</div>
            )}
          </div>
          {(report.variance || []).length > 0 && (
            <div style={card({ marginBottom: 8 })}>
              <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
                <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>
                  Usage since {report.window?.from ? new Date(report.window.from).toLocaleDateString() : "last count"}
                </span>
              </div>
              {report.variance.map((v, i) => (
                <div key={i} style={{ padding: "9px 18px", borderBottom: `1px solid ${BX.STONE}`,
                  display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: 11 }}>
                  <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{v.front_name}</span>
                  <span style={{ color: BX.DRIFTWOOD, marginLeft: "auto" }}>
                    had {v.start} + bought {v.purchased} − now {v.end} = used {v.usage} {v.unit || ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Count sheet */}
      {Object.entries(byParent).map(([parent, lines]) => (
        <div key={parent} style={card({ marginBottom: 8 })}>
          <div style={{ padding: "11px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={eyebrow()}>{parent}</span>
          </div>
          {lines.map(l => (
            <div key={l.id} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`,
              display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: BX.SERIF, fontSize: isMobile ? 14 : 13 }}>{l.front_name}</div>
                <div style={{ fontSize: 9, color: BX.DRIFTWOOD, marginTop: 2, letterSpacing: "0.08em" }}>
                  {l.count_unit ? l.count_unit.toUpperCase() : "UNITS"}{l.par_level != null && ` · PAR ${l.par_level}`}
                </div>
              </div>
              {open ? (
                <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  <button onClick={() => setCount(l.catalog_item_id, Math.max(0, (Number(l.units_counted) || 0) - 1))}
                    style={btnGhost({ padding: 0, width: 40, height: 40, fontSize: 16, borderColor: BX.LINEN })}>−</button>
                  <input value={l.units_counted ?? ""} inputMode="decimal" placeholder="—"
                    onChange={e => {
                      const v = e.target.value;
                      if (v === "" ) return setCount(l.catalog_item_id, null);
                      if (!isNaN(Number(v))) setCount(l.catalog_item_id, Number(v));
                    }}
                    style={inputBx({ width: 56, height: 40, padding: 0, textAlign: "center",
                      borderLeft: "none", borderRight: "none",
                      color: l.units_counted != null && l.par_level != null && l.units_counted < l.par_level ? BX.RUST : BX.INK })} />
                  <button onClick={() => setCount(l.catalog_item_id, (Number(l.units_counted) || 0) + 1)}
                    style={btnGhost({ padding: 0, width: 40, height: 40, fontSize: 16, borderColor: BX.LINEN })}>+</button>
                </div>
              ) : (
                <span style={{ fontFamily: BX.MONO, fontWeight: 500, fontSize: 14,
                  color: l.units_counted != null && l.par_level != null && l.units_counted < l.par_level ? BX.RUST : BX.INK }}>
                  {l.units_counted ?? "—"}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}

      {/* Sticky confirm bar while counting */}
      {open && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: isMobile ? 58 : 0,
          background: BX.PARCHMENT, borderTop: `1px solid ${BX.LINEN}`, padding: "12px 18px",
          display: "flex", alignItems: "center", gap: 12, zIndex: 40 }}>
          <span style={{ fontFamily: BX.MONO, fontSize: 10, color: BX.DRIFTWOOD, letterSpacing: "0.12em" }}>
            {counted} OF {active.lines.length} COUNTED
          </span>
          <button onClick={confirm} disabled={counted === 0}
            style={btnPrimary({ marginLeft: "auto", opacity: counted === 0 ? 0.4 : 1 })}>
            Log inventory
          </button>
        </div>
      )}
    </div>
  );
}

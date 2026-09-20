import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api.js";
import { BX, label, eyebrow, tag, card, bodyText, btnPrimary, btnGhost, inputBx, fmtAgo } from "../../lib/boxx.js";

const KIND_META = {
  decision: ["DECISION", BX.AMBER],
  overdue:  ["OVERDUE", BX.RUST],
  upcoming: ["DUE SOON", BX.DRIFTWOOD],
  check_in: ["CHECK-IN", BX.DRIFTWOOD],
  action:   ["CARRIED", BX.DRIFTWOOD],
  added:    ["ADDED", BX.OLIVE],
};

// Weekly 1:1 agenda. "Create Agenda" is deterministic: it freezes what
// already needs attention plus anything anyone free-added. No LLM.
export default function OneOnOneTab({ domainId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState("");
  const [created, setCreated] = useState(null); // agenda snapshot just created

  const load = useCallback(() => {
    api.get(`/api/domains/${domainId}/agenda`).then(setData).catch(e => setError(e.message));
  }, [domainId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const addItem = async () => {
    if (!draft.trim()) return;
    try { await api.post(`/api/domains/${domainId}/agenda`, { text: draft.trim() }); setDraft(""); load(); }
    catch (err) { setError(err.message); }
  };
  const resolve = async (id) => {
    try { await api.post(`/api/agenda-items/${id}/resolve`); load(); }
    catch (err) { setError(err.message); }
  };
  const createAgenda = async () => {
    try {
      const r = await api.post(`/api/domains/${domainId}/one-on-ones`);
      setCreated(r.agenda); load();
    } catch (err) { setError(err.message); }
  };

  const kindTag = (kind) => {
    const [lbl2, color] = KIND_META[kind] || ["ITEM", BX.DRIFTWOOD];
    return <span style={tag(color, { flexShrink: 0 })}>{lbl2}</span>;
  };

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 300, color: BX.INK, maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={label()}>WEEKLY 1:1 · ONE HOUR · AGENDA BUILDS ITSELF FROM WHAT NEEDS ATTENTION</span>
        <button onClick={createAgenda} style={btnPrimary({ marginLeft: "auto" })}>Create Agenda</button>
      </div>

      {created && (
        <div style={card({ padding: "14px 18px", marginBottom: 8, borderColor: BX.OLIVE })}>
          <div style={eyebrow({ marginBottom: 8 })}>Agenda created · {created.length} items</div>
          {created.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "4px 0" }}>
              {kindTag(a.source)}<span style={bodyText({ fontSize: 12 })}>{a.text}</span>
            </div>
          ))}
        </div>
      )}

      <div style={card({ marginBottom: 8 })}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Needs attention · automatic</span>
        </div>
        {data.suggestions.length === 0 && (
          <div style={bodyText({ padding: "14px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>Nothing outstanding. Clean slate.</div>
        )}
        {data.suggestions.map((s, i) => (
          <div key={i} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 10, alignItems: "baseline" }}>
            {kindTag(s.kind)}<span style={bodyText({ fontSize: 12 })}>{s.text}</span>
          </div>
        ))}
      </div>

      <div style={card({ marginBottom: 8 })}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Added by hand · anyone can add</span>
        </div>
        {data.items.map(it => (
          <div key={it.id} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={() => resolve(it.id)} aria-label={`Resolve: ${it.text}`}
              style={{ width: 18, height: 18, background: "transparent", border: `1px solid ${BX.DRIFTWOOD}`, cursor: "pointer", flexShrink: 0 }} />
            <span style={bodyText({ fontSize: 13, flexGrow: 1 })}>{it.text}</span>
            <span style={{ fontSize: 9, color: BX.DRIFTWOOD, flexShrink: 0 }}>{it.added_by_name?.toUpperCase()} · {fmtAgo(it.created_at)}</span>
          </div>
        ))}
        <div style={{ padding: "12px 18px", display: "flex", gap: 8 }}>
          <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem()}
            placeholder="Add an item for this week's 1:1" style={inputBx({ flexGrow: 1, fontSize: 12 })} />
          <button onClick={addItem} style={btnGhost({ padding: "10px 16px", fontSize: 9 })}>Add</button>
        </div>
      </div>

      {data.history.length > 0 && (
        <div style={card()}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Past agendas</span>
          </div>
          {data.history.map(h => (
            <div key={h.id} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 10, alignItems: "baseline" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{new Date(h.held_at).toLocaleDateString()}</span>
              <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>{h.agenda.length} items · {h.agenda.slice(0, 2).map(a => a.text).join(" · ").slice(0, 90)}…</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

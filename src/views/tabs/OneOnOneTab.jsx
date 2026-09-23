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

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const fmt12 = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
};
// Next calendar date for the slot's weekday (today counts)
const nextDateFor = (dayName) => {
  const target = DAYS.indexOf(dayName);
  if (target < 0) return null;
  const d = new Date();
  const cur = (d.getDay() + 6) % 7;   // Monday-indexed
  d.setDate(d.getDate() + ((target - cur + 7) % 7));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// Weekly 1:1 agenda. "Create Agenda" is deterministic: it freezes what
// already needs attention plus anything anyone free-added. No LLM.
export default function OneOnOneTab({ domainId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState("");
  const [created, setCreated] = useState(null); // agenda snapshot just created
  const [editSlot, setEditSlot] = useState(false);
  const [slotDraft, setSlotDraft] = useState({ day: "", time: "" });
  const [logKind, setLogKind] = useState("decision");
  const [logDraft, setLogDraft] = useState("");

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

  const logIt = async () => {
    if (!logDraft.trim()) return;
    try {
      await api.post(`/api/domains/${domainId}/meeting-log`, { kind: logKind, text: logDraft.trim() });
      setLogDraft(""); load();
    } catch (err) { setError(err.message); }
  };
  const toggleAction = async (id) => {
    try { await api.post(`/api/actions/${id}/toggle`); load(); }
    catch (err) { setError(err.message); }
  };

  const saveSlot = async () => {
    try {
      await api.put(`/api/domains/${domainId}/one-on-one-slot`, slotDraft);
      setEditSlot(false); load();
    } catch (err) { setError(err.message); }
  };
  const slot = data.slot || {};

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={label()}>WEEKLY 1:1 · ONE HOUR · AGENDA BUILDS ITSELF FROM WHAT NEEDS ATTENTION</span>
        <button onClick={createAgenda} style={btnPrimary({ marginLeft: "auto" })}>Create Agenda</button>
      </div>

      {/* Standing meeting time */}
      <div style={card({ padding: "11px 18px", marginBottom: 12, display: "flex", gap: 12,
        alignItems: "center", flexWrap: "wrap", borderColor: slot.day ? BX.LINEN : BX.AMBER })}>
        {!editSlot ? (
          <>
            {slot.day ? (
              <>
                <span style={label({ color: BX.OLIVE, letterSpacing: "0.2em" })}>Meets {slot.day}s · {fmt12(slot.time)}</span>
                <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>next: {nextDateFor(slot.day)}</span>
              </>
            ) : (
              <span style={label({ color: BX.AMBER })}>NO MEETING TIME SET YET</span>
            )}
            <button onClick={() => { setSlotDraft({ day: slot.day || "Monday", time: slot.time || "15:00" }); setEditSlot(true); }}
              style={btnGhost({ marginLeft: "auto", padding: "7px 12px", fontSize: 8 })}>
              {slot.day ? "Change" : "Set time"}
            </button>
          </>
        ) : (
          <>
            <select value={slotDraft.day} onChange={e => setSlotDraft(s => ({ ...s, day: e.target.value }))}
              style={inputBx({ fontSize: 12, padding: "8px 10px" })}>
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <input type="time" value={slotDraft.time} onChange={e => setSlotDraft(s => ({ ...s, time: e.target.value }))}
              style={inputBx({ fontSize: 12, padding: "7px 10px" })} />
            <button onClick={saveSlot} style={btnPrimary({ padding: "9px 14px", fontSize: 9 })}>Save</button>
            <button onClick={() => setEditSlot(false)}
              style={btnGhost({ padding: "9px 12px", fontSize: 9, borderColor: BX.LINEN, color: BX.DRIFTWOOD })}>✕</button>
          </>
        )}
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

      {/* Meeting log: decisions are the permanent record, actions are the
          checklist — unfinished actions carry into the next agenda by themselves. */}
      <div style={card({ marginBottom: 8 })}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Meeting log</span>
          <span style={label({ fontSize: 8 })}>OPEN ACTIONS CARRY INTO THE NEXT AGENDA</span>
        </div>
        <div style={{ padding: "12px 18px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ display: "flex" }}>
            {[["decision", "Decision"], ["action", "Action"]].map(([k, t]) => (
              <button key={k} onClick={() => setLogKind(k)}
                style={{ fontFamily: BX.MONO, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase",
                  padding: "8px 12px", cursor: "pointer",
                  border: `1px solid ${logKind === k ? BX.INK : BX.LINEN}`, borderRight: k === "decision" ? "none" : undefined,
                  background: logKind === k ? BX.INK : "transparent", color: logKind === k ? BX.PARCHMENT : BX.DRIFTWOOD }}>
                {t}
              </button>
            ))}
          </span>
          <input value={logDraft} onChange={e => setLogDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && logIt()}
            placeholder={logKind === "decision" ? "What was decided" : "Who does what by when"}
            style={inputBx({ flexGrow: 1, minWidth: 180, fontSize: 12 })} />
          <button onClick={logIt} style={btnPrimary({ padding: "10px 16px", fontSize: 9, opacity: logDraft.trim() ? 1 : 0.4 })}>Log</button>
        </div>

        {(data.actions || []).length > 0 && (
          <div style={{ borderTop: `1px solid ${BX.STONE}` }}>
            <div style={{ padding: "9px 18px 2px" }}><span style={label({ fontSize: 8 })}>CHECKLIST</span></div>
            {data.actions.map(a => (
              <div key={a.id} style={{ padding: "8px 18px", display: "flex", gap: 12, alignItems: "center",
                opacity: a.done_at ? 0.55 : 1 }}>
                <button onClick={() => toggleAction(a.id)} aria-label={a.done_at ? "Reopen" : "Done"}
                  style={{ width: 17, height: 17, flexShrink: 0, cursor: "pointer", background: "transparent",
                    border: `1px solid ${a.done_at ? BX.LINEN : BX.INK}`, color: BX.INK, fontSize: 11,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: BX.MONO }}>
                  {a.done_at ? "✓" : ""}
                </button>
                <span style={bodyText({ fontSize: 12, textDecoration: a.done_at ? "line-through" : "none" })}>{a.text}</span>
              </div>
            ))}
          </div>
        )}

        {(data.decisions || []).length > 0 && (
          <div style={{ borderTop: `1px solid ${BX.STONE}`, paddingBottom: 6 }}>
            <div style={{ padding: "9px 18px 2px" }}><span style={label({ fontSize: 8, color: BX.OLIVE })}>DECISIONS · PERMANENT RECORD</span></div>
            {data.decisions.map(dcn => (
              <div key={dcn.id} style={{ padding: "8px 18px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={bodyText({ fontSize: 12, color: BX.INK })}>{dcn.text}</span>
                <span style={{ marginLeft: "auto", fontSize: 9, color: BX.DRIFTWOOD, flexShrink: 0 }}>
                  {dcn.created_by_name?.toUpperCase()} · {new Date(dcn.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        )}
        {(data.actions || []).length === 0 && (data.decisions || []).length === 0 && (
          <div style={bodyText({ padding: "0 18px 14px", fontSize: 11, color: BX.DRIFTWOOD })}>
            Nothing logged yet — decisions and action items from your meetings land here.
          </div>
        )}
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

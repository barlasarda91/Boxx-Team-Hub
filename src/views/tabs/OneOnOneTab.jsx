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
const fmtDate = (d) => d
  ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })
  : "";
const fmtShort = (d) => d
  ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  : "";
const fmtTime = (iso) => iso
  ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })
  : "";

// The 1:1 meeting lifecycle: items collect in a draft all week, publishing
// locks the agenda and notifies the owner, outcomes attach to that meeting,
// closing archives the record. One card per stage — never all at once.
export default function OneOnOneTab({ domainId, me }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState("");
  const [editSlot, setEditSlot] = useState(false);
  const [slotDraft, setSlotDraft] = useState({ day: "", time: "" });
  const [logKind, setLogKind] = useState("decision");
  const [logDraft, setLogDraft] = useState("");
  const [openHistory, setOpenHistory] = useState(null);  // expanded past-meeting id

  const isOwner = me?.role === "owner";
  const load = useCallback(() => {
    api.get(`/api/domains/${domainId}/agenda`).then(setData).catch(e => setError(e.message));
  }, [domainId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const meeting = data.meeting;
  const slot = data.slot || {};
  const suggestions = data.suggestions || [];
  const draftItems = data.draft_items || [];
  const publishCount = suggestions.length + draftItems.length;
  const lastClosed = (data.history || [])[0] || null;

  const addItem = async () => {
    if (!draft.trim()) return;
    try { await api.post(`/api/domains/${domainId}/agenda`, { text: draft.trim() }); setDraft(""); load(); }
    catch (err) { setError(err.message); }
  };
  const resolve = async (id) => {
    try { await api.post(`/api/agenda-items/${id}/resolve`); load(); }
    catch (err) { setError(err.message); }
  };
  const publish = async () => {
    try { await api.post(`/api/domains/${domainId}/publish-agenda`); load(); }
    catch (err) { setError(err.message); }
  };
  const closeMeeting = async () => {
    try { await api.post(`/api/domains/${domainId}/close-meeting`); load(); }
    catch (err) { setError(err.message); }
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

  const kindTag = (kind) => {
    const [lbl2, color] = KIND_META[kind] || ["ITEM", BX.DRIFTWOOD];
    return <span style={tag(color, { flexShrink: 0 })}>{lbl2}</span>;
  };
  const agendaRow = (a, i, dim = false) => (
    <div key={i} style={{ padding: "9px 18px", borderBottom: `1px solid ${BX.STONE}`,
      display: "flex", gap: 10, alignItems: "baseline", opacity: dim ? 0.65 : 1 }}>
      {kindTag(a.source ?? a.kind)}<span style={bodyText({ fontSize: 12 })}>{a.text}</span>
    </div>
  );

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 760 }}>
      <div style={{ marginBottom: 8 }}>
        <span style={label()}>WEEKLY 1:1 · ITEMS COLLECT ALL WEEK · PUBLISH LOCKS THE AGENDA · OUTCOMES ATTACH TO THE MEETING</span>
      </div>

      {/* Standing meeting time */}
      <div style={card({ padding: "11px 18px", marginBottom: 12, display: "flex", gap: 12,
        alignItems: "center", flexWrap: "wrap", borderColor: slot.day ? BX.LINEN : BX.AMBER })}>
        {!editSlot ? (
          <>
            {slot.day ? (
              <>
                <span style={label({ color: BX.OLIVE, letterSpacing: "0.2em" })}>Meets {slot.day}s · {fmt12(slot.time)}</span>
                {meeting?.meeting_date && <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>next: {fmtShort(meeting.meeting_date)}</span>}
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

      {/* ── DRAFT: building next meeting's agenda ── */}
      {meeting?.status === "draft" && (
        <div style={card({ marginBottom: 8 })}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex",
            gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>
              Next meeting{meeting.meeting_date ? ` · ${fmtDate(meeting.meeting_date)}` : ""}
            </span>
            <span style={tag(BX.DRIFTWOOD, { marginLeft: "auto" })}>UNPUBLISHED</span>
          </div>

          {draftItems.map(it => (
            <div key={it.id} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 12, alignItems: "center" }}>
              <button onClick={() => resolve(it.id)} aria-label={`Remove: ${it.text}`}
                style={{ width: 18, height: 18, background: "transparent", border: `1px solid ${BX.DRIFTWOOD}`, cursor: "pointer", flexShrink: 0 }} />
              <span style={bodyText({ fontSize: 13, flexGrow: 1 })}>{it.text}</span>
              <span style={{ fontSize: 9, color: BX.DRIFTWOOD, flexShrink: 0 }}>{it.added_by_name?.toUpperCase()} · {fmtAgo(it.created_at)}</span>
            </div>
          ))}
          {draftItems.length === 0 && (
            <div style={bodyText({ padding: "12px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>
              No items yet — anything on your mind this week goes here.
            </div>
          )}
          <div style={{ padding: "12px 18px", display: "flex", gap: 8, borderBottom: `1px solid ${BX.LINEN}` }}>
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem()}
              placeholder="Add an agenda item" style={inputBx({ flexGrow: 1, fontSize: 12 })} />
            <button onClick={addItem} style={btnGhost({ padding: "10px 16px", fontSize: 9 })}>Add</button>
          </div>

          {suggestions.length > 0 && (
            <>
              <div style={{ padding: "10px 18px 4px" }}>
                <span style={label({ fontSize: 8 })}>ADDED AUTOMATICALLY WHEN YOU PUBLISH</span>
              </div>
              {suggestions.map((s, i) => agendaRow(s, i, true))}
            </>
          )}

          <div style={{ padding: "13px 18px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={publish} style={btnPrimary({ padding: "10px 18px", fontSize: 9 })}>
              Publish agenda · {publishCount} item{publishCount === 1 ? "" : "s"}
            </button>
            <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>
              Publishing locks the agenda and notifies {isOwner ? "you both" : "Arda"}. Unpublished agendas publish themselves at meeting time.
            </span>
          </div>
        </div>
      )}

      {/* ── PUBLISHED: locked agenda, prep, then outcomes ── */}
      {meeting?.status === "published" && (
        <div style={card({ marginBottom: 8, borderColor: BX.OLIVE })}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex",
            gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>
              This meeting{meeting.meeting_date ? ` · ${fmtDate(meeting.meeting_date)}` : ""}
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {meeting.auto_published && <span style={tag(BX.AMBER)}>AUTO</span>}
              <span style={tag(BX.OLIVE)}>PUBLISHED{meeting.published_at ? ` · ${fmtTime(meeting.published_at)}` : ""}</span>
            </span>
          </div>

          {(meeting.agenda || []).map((a, i) => agendaRow(a, i))}
          {(meeting.agenda || []).length === 0 && (
            <div style={bodyText({ padding: "12px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>Published empty — nothing was queued.</div>
          )}
          <div style={bodyText({ padding: "9px 18px", fontSize: 10, color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.LINEN}` })}>
            The agenda is locked. New items land in next week's draft.
          </div>

          {/* Owner prep: what the last meeting left behind */}
          {isOwner && lastClosed && (lastClosed.decisions.length > 0 || lastClosed.actions.some(a => !a.done_at)) && (
            <div style={{ borderBottom: `1px solid ${BX.LINEN}`, background: "rgba(107,110,74,0.06)" }}>
              <div style={{ padding: "10px 18px 4px" }}>
                <span style={label({ fontSize: 8, color: BX.OLIVE })}>PREP · WHERE THE LAST MEETING LEFT OFF ({fmtShort(lastClosed.meeting_date)})</span>
              </div>
              {lastClosed.decisions.map(dcn => (
                <div key={`d${dcn.id}`} style={{ padding: "6px 18px", display: "flex", gap: 10, alignItems: "baseline" }}>
                  {kindTag("decision")}<span style={bodyText({ fontSize: 12 })}>{dcn.text}</span>
                </div>
              ))}
              {lastClosed.actions.filter(a => !a.done_at).map(a => (
                <div key={`a${a.id}`} style={{ padding: "6px 18px", display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={tag(BX.RUST, { flexShrink: 0 })}>STILL OPEN</span>
                  <span style={bodyText({ fontSize: 12 })}>{a.text}</span>
                </div>
              ))}
              <div style={{ height: 8 }} />
            </div>
          )}

          {/* Outcomes: decisions are the permanent record, actions the checklist */}
          <div style={{ padding: "10px 18px 4px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span style={label({ fontSize: 8 })}>AFTER THE MEETING · LOG WHAT IT PRODUCED</span>
            <span style={label({ fontSize: 8 })}>OPEN ACTIONS CARRY INTO THE NEXT AGENDA</span>
          </div>
          <div style={{ padding: "8px 18px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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

          {(meeting.decisions || []).map(dcn => (
            <div key={`md${dcn.id}`} style={{ padding: "7px 18px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              {kindTag("decision")}
              <span style={bodyText({ fontSize: 12 })}>{dcn.text}</span>
              <span style={{ marginLeft: "auto", fontSize: 9, color: BX.DRIFTWOOD, flexShrink: 0 }}>{dcn.created_by_name?.toUpperCase()}</span>
            </div>
          ))}
          {(meeting.actions || []).map(a => (
            <div key={`ma${a.id}`} style={{ padding: "7px 18px", display: "flex", gap: 12, alignItems: "center", opacity: a.done_at ? 0.55 : 1 }}>
              <button onClick={() => toggleAction(a.id)} aria-label={a.done_at ? "Reopen" : "Done"}
                style={{ width: 17, height: 17, flexShrink: 0, cursor: "pointer", background: "transparent",
                  border: `1px solid ${a.done_at ? BX.LINEN : BX.INK}`, color: BX.INK, fontSize: 11,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: BX.MONO }}>
                {a.done_at ? "✓" : ""}
              </button>
              <span style={bodyText({ fontSize: 12, textDecoration: a.done_at ? "line-through" : "none" })}>{a.text}</span>
            </div>
          ))}

          <div style={{ padding: "12px 18px", borderTop: `1px solid ${BX.LINEN}`, display: "flex", gap: 12,
            alignItems: "center", flexWrap: "wrap" }}>
            {isOwner ? (
              <button onClick={closeMeeting} style={btnPrimary({ padding: "10px 18px", fontSize: 9 })}>Close meeting</button>
            ) : (
              <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>Arda closes the meeting once everything's logged.</span>
            )}
            <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>
              Closing archives this record and opens next week's draft. Meetings left open close themselves the next morning.
            </span>
          </div>
        </div>
      )}

      {/* ── History: one record per meeting ── */}
      {(data.history || []).length > 0 && (
        <div style={card()}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Past meetings</span>
          </div>
          {data.history.map(h => {
            const open = openHistory === h.id;
            const openActs = h.actions.filter(a => !a.done_at).length;
            return (
              <div key={h.id} style={{ borderBottom: `1px solid ${BX.STONE}` }}>
                <button onClick={() => setOpenHistory(open ? null : h.id)}
                  style={{ width: "100%", padding: "10px 18px", display: "flex", gap: 10, alignItems: "baseline",
                    background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: BX.MONO, color: BX.INK }}>
                  <span style={{ fontFamily: BX.SERIF, fontSize: 13, flexShrink: 0 }}>{fmtDate(h.meeting_date)}</span>
                  {h.auto_published && <span style={tag(BX.AMBER, { flexShrink: 0 })}>AUTO</span>}
                  <span style={{ fontSize: 11, color: BX.DRIFTWOOD }}>
                    {h.agenda.length}-item agenda · {h.decisions.length} decision{h.decisions.length === 1 ? "" : "s"} · {h.actions.length} action{h.actions.length === 1 ? "" : "s"}{openActs ? ` (${openActs} open)` : ""}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: BX.DRIFTWOOD }}>{open ? "▴" : "▾"}</span>
                </button>
                {open && (
                  <div style={{ padding: "0 18px 12px" }}>
                    {h.agenda.length > 0 && <div style={label({ fontSize: 8, margin: "6px 0 4px" })}>AGENDA</div>}
                    {h.agenda.map((a, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0" }}>
                        {kindTag(a.source ?? a.kind)}<span style={bodyText({ fontSize: 12 })}>{a.text}</span>
                      </div>
                    ))}
                    {h.decisions.length > 0 && <div style={label({ fontSize: 8, margin: "8px 0 4px", color: BX.OLIVE })}>DECISIONS</div>}
                    {h.decisions.map(dcn => (
                      <div key={dcn.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0" }}>
                        <span style={bodyText({ fontSize: 12 })}>{dcn.text}</span>
                        <span style={{ marginLeft: "auto", fontSize: 9, color: BX.DRIFTWOOD }}>{dcn.created_by_name?.toUpperCase()}</span>
                      </div>
                    ))}
                    {h.actions.length > 0 && <div style={label({ fontSize: 8, margin: "8px 0 4px" })}>ACTIONS</div>}
                    {h.actions.map(a => (
                      <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "3px 0", opacity: a.done_at ? 0.55 : 1 }}>
                        <button onClick={() => toggleAction(a.id)} aria-label={a.done_at ? "Reopen" : "Done"}
                          style={{ width: 15, height: 15, flexShrink: 0, cursor: "pointer", background: "transparent",
                            border: `1px solid ${a.done_at ? BX.LINEN : BX.INK}`, color: BX.INK, fontSize: 10,
                            display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: BX.MONO }}>
                          {a.done_at ? "✓" : ""}
                        </button>
                        <span style={bodyText({ fontSize: 12, textDecoration: a.done_at ? "line-through" : "none" })}>{a.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

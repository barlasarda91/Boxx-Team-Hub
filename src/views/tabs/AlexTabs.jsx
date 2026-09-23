import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api.js";
import { BX, label, tag, card, bodyText, btnPrimary, btnGhost, inputBx } from "../../lib/boxx.js";
import { useRoster } from "../../lib/useRoster.js";
const checkBox = (done, onClick, text) => (
  <button onClick={onClick} style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer",
    background: "none", border: `1px solid ${BX.LINEN}`, padding: "12px 14px", flexGrow: 1 }}>
    <span style={{ width: 15, height: 15, display: "inline-flex", alignItems: "center", justifyContent: "center",
      border: `1px solid ${done ? BX.INK : BX.DRIFTWOOD}`, fontSize: 11, color: BX.INK, flexShrink: 0 }}>
      {done ? "✓" : " "}
    </span>
    <span style={bodyText({ fontSize: 12, color: done ? BX.DRIFTWOOD : BX.INK })}>{text}</span>
  </button>
);

// Alex: birthdays pin at T-30 with three checkboxes until all resolved.
export function BirthdaysTab({ isMobile }) {
  const { members: MEMBERS } = useRoster();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({});

  const load = useCallback(() => {
    api.get("/api/wellness").then(setData).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const toggle = async (id, field) => {
    try { await api.post(`/api/wellness/tasks/${id}/toggle`, { field }); load(); }
    catch (err) { setError(err.message); }
  };
  // Take whatever shape people type — 10-14, 10/14, 10.14, 1014, 5 3 — and
  // normalize to MM-DD before validating.
  const normalizeBirthday = (raw) => {
    const parts = String(raw || "").trim().split(/[^0-9]+/).filter(Boolean);
    let mm, dd;
    if (parts.length === 2) [mm, dd] = parts;
    else if (parts.length === 1 && parts[0].length >= 3 && parts[0].length <= 4) {
      const s = parts[0].padStart(4, "0");
      mm = s.slice(0, 2); dd = s.slice(2);
    } else return null;
    mm = mm.padStart(2, "0"); dd = dd.padStart(2, "0");
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
    return `${mm}-${dd}`;
  };
  const saveBirthday = async (member) => {
    const bd = normalizeBirthday(drafts[member]);
    if (!bd) return setError("Enter a month and day, like 10-14");
    try {
      await api.put(`/api/wellness/birthdays/${member}`, { birth_date: bd });
      setError(null);
      setDrafts(d => ({ ...d, [member]: bd }));
      load();
    } catch (err) { setError(err.message); }
  };
  const bdayOf = (m) => data.birthdays.find(b => b.member_name === m)?.birth_date || "";

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 860 }}>
      {data.pins.map(p => (
        <div key={p.id} style={card({ marginBottom: 8, borderColor: p.all_done ? BX.LINEN : BX.AMBER })}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={label({ color: p.all_done ? BX.INK : BX.AMBER, letterSpacing: "0.2em" })}>
              Pinned · {p.member_name}'s birthday
            </span>
            <span style={label({ fontSize: 8 })}>PINNED AT T-30 · CLEARS WHEN ALL THREE DONE</span>
          </div>
          <div style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "baseline", marginBottom: 12 }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 18 }}>
                {new Date(`${p.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              </span>
              <span style={bodyText({ fontSize: 12 })}>
                {p.days_out > 0 ? `${p.days_out} days out` : p.days_out === 0 ? "today" : `${-p.days_out} days ago`}
              </span>
              {p.all_done && <span style={tag(BX.OLIVE)}>ALL SET</span>}
            </div>
            <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
              {checkBox(p.cake_done_at, () => toggle(p.id, "cake"), "Cake order")}
              {checkBox(p.event_done_at, () => toggle(p.id, "event"), "Event planning")}
              {checkBox(p.gift_done_at, () => toggle(p.id, "gift"), "Gift planning")}
            </div>
          </div>
        </div>
      ))}
      {data.pins.length === 0 && (
        <div style={card({ padding: "16px 18px", marginBottom: 8 })}>
          <span style={bodyText({ fontSize: 12, color: BX.DRIFTWOOD })}>No birthdays inside the 30-day window.</span>
        </div>
      )}

      <div style={card()}>
        <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.2em" })}>Birthdays on file</span>
        </div>
        {MEMBERS.map(m => (
          <div key={m} style={{ padding: "9px 16px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 13, width: 90 }}>{m}</span>
            <input value={drafts[m] ?? bdayOf(m)} placeholder="MM-DD" inputMode="numeric"
              onChange={e => setDrafts(d => ({ ...d, [m]: e.target.value.replace(/[^0-9\-/. ]/g, "") }))}
              onKeyDown={e => e.key === "Enter" && drafts[m] && saveBirthday(m)}
              style={inputBx({ width: 90, padding: "7px 10px", fontSize: 12, textAlign: "center" })} />
            {drafts[m] && drafts[m] !== bdayOf(m) && (
              <button onClick={() => saveBirthday(m)} style={btnGhost({ padding: "7px 12px", fontSize: 8 })}>Save</button>
            )}
            {!bdayOf(m) && <span style={label({ fontSize: 8, color: BX.AMBER })}>NOT SET</span>}
          </div>
        ))}
        <div style={{ padding: "9px 16px" }}>
          <span style={bodyText({ fontSize: 10, color: BX.DRIFTWOOD })}>
            A birthday pins its card 30 days ahead with the three checkboxes, and stays pinned until all three are done.
          </span>
        </div>
      </div>
    </div>
  );
}

// Alex: one team event every month, birthdays or not.
export function TeamEventsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({ title: "", event_date: "", notes: "" });

  const load = useCallback(() => {
    api.get("/api/wellness").then(setData).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const thisMonth = data.team_events.filter(e => e.month === data.this_month && e.status !== "cancelled");
  const add = async () => {
    if (!draft.title) return;
    try {
      await api.post("/api/wellness/team-events", { ...draft, month: (draft.event_date || data.this_month + "-15").slice(0, 7) });
      setDraft({ title: "", event_date: "", notes: "" });
      load();
    } catch (err) { setError(err.message); }
  };
  const setStatus = async (id, status) => {
    try { await api.patch(`/api/wellness/team-events/${id}`, { status }); load(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 760 }}>
      <div style={card({ marginBottom: 8, borderColor: thisMonth.length === 0 ? BX.AMBER : BX.LINEN })}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: thisMonth.length === 0 ? BX.AMBER : BX.INK, letterSpacing: "0.2em" })}>
            This month · one team event, birthdays or not
          </span>
        </div>
        {thisMonth.length === 0 ? (
          <div style={{ padding: "12px 16px", display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={bodyText({ fontSize: 12, color: BX.AMBER })}>Nothing planned yet for {data.this_month}.</span>
          </div>
        ) : thisMonth.map(e => (
          <div key={e.id} style={{ padding: "11px 16px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 14 }}>{e.title}</span>
            <span style={bodyText({ fontSize: 11 })}>{e.event_date || "date tbd"}{e.notes ? ` · ${e.notes}` : ""}</span>
            <span style={{ marginLeft: "auto" }}>
              {e.status === "done"
                ? <span style={tag(BX.OLIVE)}>DONE</span>
                : <button onClick={() => setStatus(e.id, "done")} style={btnGhost({ padding: "7px 12px", fontSize: 8 })}>Mark done</button>}
            </span>
          </div>
        ))}
      </div>

      <div style={card({ marginBottom: 8 })}>
        <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.2em" })}>Plan one</span>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={draft.title} onChange={e => setDraft(s => ({ ...s, title: e.target.value }))} placeholder="Beach bonfire, bowling…"
            style={inputBx({ fontSize: 12, flexGrow: 1, flexBasis: 200 })} />
          <input type="date" value={draft.event_date} onChange={e => setDraft(s => ({ ...s, event_date: e.target.value }))}
            style={inputBx({ fontSize: 12 })} />
          <input value={draft.notes} onChange={e => setDraft(s => ({ ...s, notes: e.target.value }))} placeholder="Notes"
            style={inputBx({ fontSize: 12, flexGrow: 1, flexBasis: 160 })} />
          <button onClick={add} style={btnPrimary({ padding: "10px 18px", fontSize: 9 })}>Add</button>
        </div>
      </div>

      <div style={card()}>
        <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.2em" })}>Past months</span>
        </div>
        {data.team_events.filter(e => e.month !== data.this_month).map(e => (
          <div key={e.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 10, alignItems: "baseline" }}>
            <span style={label({ fontSize: 8, color: BX.INK })}>{e.month}</span>
            <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{e.title}</span>
            <span style={{ marginLeft: "auto" }}>
              <span style={tag(e.status === "done" ? BX.OLIVE : e.status === "cancelled" ? BX.RUST : BX.DRIFTWOOD)}>{e.status.toUpperCase()}</span>
            </span>
          </div>
        ))}
        {data.team_events.filter(e => e.month !== data.this_month).length === 0 && (
          <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>History builds from here.</div>
        )}
      </div>
    </div>
  );
}

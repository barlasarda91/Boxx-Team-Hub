import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api.js";
import { BX, label, tag, card, bodyText, btnPrimary, btnGhost, inputBx } from "../../lib/boxx.js";
import BxModal from "../../components/BxModal.jsx";

const STATUS_TAG = { hold: ["HOLD", BX.AMBER], confirmed: ["CONFIRMED", BX.DRIFTWOOD], done: ["DONE", BX.OLIVE], cancelled: ["CANCELLED", BX.RUST] };

// Brandon's events: pace of two per month on the surface, everything else
// in the event pop-up.
export default function EventsTab({ isMobile }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);   // event id or 'new'

  const load = useCallback(() => {
    api.get("/api/events").then(setData).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const upcoming = data.events.filter(e => e.event_date >= data.today && e.status !== "cancelled");
  const past = data.events.filter(e => e.event_date < data.today || e.status === "cancelled");
  const atRisk = data.month_count < data.target;
  const daysLeft = (() => {
    const d = new Date(`${data.month}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return Math.max(0, Math.round((d - new Date(`${data.today}T12:00:00Z`)) / 86400000));
  })();
  const openEvent = open === "new" ? null : data.events.find(e => e.id === open);

  const row = (e) => (
    <div key={e.id} onClick={() => setOpen(e.id)}
      style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer",
        display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
      <span style={{ fontFamily: BX.SERIF, fontSize: 14 }}>{e.title}</span>
      <span style={bodyText({ fontSize: 11 })}>{e.event_date}{e.venue ? ` · ${e.venue}` : ""}</span>
      <span style={{ marginLeft: "auto" }}>
        {(() => { const [l, c] = STATUS_TAG[e.status] || [e.status.toUpperCase(), BX.DRIFTWOOD]; return <span style={tag(c)}>{l}</span>; })()}
      </span>
    </div>
  );

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 300, color: BX.INK, maxWidth: 900 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 2fr", gap: 8 }}>
        <div>
          <div style={card({ padding: "16px 18px", marginBottom: 8, borderColor: atRisk ? BX.AMBER : BX.LINEN })}>
            <div style={label({ fontSize: 8, marginBottom: 8 })}>THIS MONTH · TARGET {data.target}</div>
            <div style={{ fontFamily: BX.SERIF, fontSize: 32, color: atRisk ? BX.AMBER : BX.INK }}>
              {data.month_count} <span style={{ fontSize: 17, color: BX.DRIFTWOOD }}>of {data.target}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              {atRisk
                ? <span style={tag(BX.AMBER)}>PACE AT RISK · {daysLeft} DAYS LEFT</span>
                : <span style={tag(BX.OLIVE)}>ON PACE</span>}
            </div>
          </div>
          <div style={card({ padding: "16px 18px" })}>
            <div style={label({ fontSize: 8, marginBottom: 8 })}>YEAR TO DATE</div>
            <div style={{ fontFamily: BX.SERIF, fontSize: 32 }}>{data.ytd}</div>
            <div style={{ marginTop: 6 }}>{<span style={label({ fontSize: 8 })}>EVENTS</span>}</div>
          </div>
        </div>
        <div>
          <div style={card({ marginBottom: 8 })}>
            <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={label({ color: BX.INK, letterSpacing: "0.2em" })}>Upcoming</span>
              <button onClick={() => setOpen("new")} style={btnPrimary({ padding: "8px 14px", fontSize: 8 })}>+ Event</button>
            </div>
            {upcoming.length === 0 && <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>Nothing booked yet.</div>}
            {upcoming.map(row)}
          </div>
          <div style={card()}>
            <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
              <span style={label({ color: BX.INK, letterSpacing: "0.2em" })}>Past</span>
            </div>
            {past.slice(0, 10).map(row)}
            {past.length === 0 && <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>None yet.</div>}
          </div>
        </div>
      </div>

      {open != null && (
        <EventModal event={openEvent} onClose={() => { setOpen(null); load(); }} onError={setError} />
      )}
    </div>
  );
}

function EventModal({ event, onClose, onError }) {
  const [f, setF] = useState({
    title: event?.title || "", event_date: event?.event_date || "", time_text: event?.time_text || "",
    venue: event?.venue || "", status: event?.status || "hold", staffing: event?.staffing || "",
    setup: event?.setup || "", budget_note: event?.budget_note || "", recap: event?.recap || "",
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const save = async () => {
    try {
      if (event) await api.patch(`/api/events/${event.id}`, f);
      else await api.post("/api/events", f);
      onClose();
    } catch (err) { onError(err.message); }
  };
  const fieldRow = (l, node) => (
    <div style={{ display: "flex", gap: 14, padding: "9px 22px", borderBottom: `1px solid ${BX.STONE}`, alignItems: "center" }}>
      <span style={{ width: 92, flexShrink: 0, ...label({ fontSize: 8 }) }}>{l}</span>{node}
    </div>
  );
  return (
    <BxModal title={event ? event.title : "New event"} onClose={onClose} width={640}>
      {fieldRow("TITLE", <input value={f.title} onChange={e => set("title", e.target.value)} style={inputBx({ fontSize: 12, flexGrow: 1 })} />)}
      {fieldRow("WHEN", <>
        <input type="date" value={f.event_date} onChange={e => set("event_date", e.target.value)} style={inputBx({ fontSize: 12 })} />
        <input value={f.time_text} onChange={e => set("time_text", e.target.value)} placeholder="5:00p · 10:00p" style={inputBx({ fontSize: 12, flexGrow: 1 })} />
      </>)}
      {fieldRow("WHERE", <input value={f.venue} onChange={e => set("venue", e.target.value)} style={inputBx({ fontSize: 12, flexGrow: 1 })} />)}
      {fieldRow("STATUS", (
        <span style={{ display: "flex", gap: 6 }}>
          {["hold", "confirmed", "done", "cancelled"].map(s => (
            <button key={s} onClick={() => set("status", s)}
              style={{ cursor: "pointer", padding: "6px 12px", background: f.status === s ? BX.INK : "transparent",
                border: `1px solid ${f.status === s ? BX.INK : BX.LINEN}`,
                ...label({ fontSize: 8, color: f.status === s ? BX.PARCHMENT : BX.DRIFTWOOD }) }}>{s.toUpperCase()}</button>
          ))}
        </span>
      ))}
      {fieldRow("STAFF", <input value={f.staffing} onChange={e => set("staffing", e.target.value)} placeholder="Who works it (Travis's shifts count toward his hours)" style={inputBx({ fontSize: 12, flexGrow: 1 })} />)}
      {fieldRow("SETUP", <input value={f.setup} onChange={e => set("setup", e.target.value)} placeholder="Cart, grinder, kegs…" style={inputBx({ fontSize: 12, flexGrow: 1 })} />)}
      {fieldRow("BUDGET", <input value={f.budget_note} onChange={e => set("budget_note", e.target.value)} placeholder="Stall fee, supplies, comps…" style={inputBx({ fontSize: 12, flexGrow: 1 })} />)}
      <div style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
        <div style={label({ fontSize: 8, marginBottom: 6 })}>RECAP · AFTER THE EVENT</div>
        <textarea value={f.recap} onChange={e => set("recap", e.target.value)} rows={3} placeholder="Cups, revenue, what to do differently."
          style={{ width: "100%", boxSizing: "border-box", fontFamily: BX.MONO, fontWeight: 300, fontSize: 12,
            color: BX.INK, background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`, padding: 10, resize: "vertical" }} />
      </div>
      <div style={{ padding: "12px 22px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={save} style={btnPrimary()}>Save</button>
      </div>
    </BxModal>
  );
}

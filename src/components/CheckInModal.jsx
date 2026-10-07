import { useState } from "react";
import { api } from "../lib/api.js";
import { BX, label, serifH, btnPrimary, inputBx } from "../lib/boxx.js";

// The weekly pulse: a color and a line, nothing else. Pure signal — it paints
// the member's card and the owner's dashboard. Decisions and private matters
// go to the Direct line; meeting topics go to the 1:1 agenda.
export default function CheckInModal({ domainId, onDone, onClose }) {
  const [status, setStatus] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!status) return;
    setBusy(true); setError(null);
    try {
      const body = { status, note };
      if (domainId) body.domain_id = domainId;
      await api.post("/api/check-ins", body);
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const statuses = [
    { key: "green",  title: "On track",  sub: "Nothing needs the owner" },
    { key: "yellow", title: "Attention", sub: "Something to watch" },
    { key: "red",    title: "Flag",      sub: "Needs a decision or help" },
  ];
  const colors = { green: BX.DRIFTWOOD, yellow: BX.AMBER, red: BX.RUST };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,25,22,0.5)", zIndex: 300,
      display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: BX.PARCHMENT, borderTop: `1px solid ${BX.LINEN}`, width: "100%", maxWidth: 560,
        maxHeight: "92vh", overflow: "auto", padding: "22px 20px 28px", boxSizing: "border-box",
        fontFamily: BX.MONO, fontWeight: 400 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={serifH(20)}>Weekly pulse</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", ...label() }}>Close</button>
        </div>
        <div style={{ fontSize: 10, color: BX.DRIFTWOOD, marginBottom: 16, lineHeight: 1.5 }}>
          A color and a line, once a week — pure signal, it paints your card and Arda's dashboard.
          Need Arda? <span style={{ color: BX.OLIVE }}>Direct line.</span> Topic for the meeting?{" "}
          <span style={{ color: BX.OLIVE }}>1:1 agenda.</span> Team thing? <span style={{ color: BX.OLIVE }}>Board.</span>
        </div>

        <div style={label({ marginBottom: 8 })}>How is your domain?</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 18 }}>
          {statuses.map(s => (
            <button key={s.key} onClick={() => setStatus(s.key)}
              style={{ padding: "14px 6px", background: status === s.key ? BX.INK : BX.PARCHMENT,
                border: `1px solid ${status === s.key ? BX.INK : colors[s.key]}`,
                cursor: "pointer", textAlign: "center", minHeight: 44 }}>
              <div style={{ fontFamily: BX.MONO, fontWeight: 400, fontSize: 10, letterSpacing: "0.14em",
                textTransform: "uppercase", color: status === s.key ? BX.PARCHMENT : colors[s.key] }}>{s.title}</div>
              <div style={{ fontSize: 9, color: status === s.key ? BX.LINEN : BX.DRIFTWOOD, marginTop: 4 }}>{s.sub}</div>
            </button>
          ))}
        </div>

        <label htmlFor="ci-note" style={label({ display: "block", marginBottom: 6 })}>What moved this week · 2-3 lines</label>
        <textarea id="ci-note" value={note} onChange={e => setNote(e.target.value)} rows={3}
          placeholder="Status only — what moved, what slipped, what's next. Nobody has to answer this."
          style={inputBx({ width: "100%", resize: "vertical", lineHeight: 1.6 })} />

        {error && <div style={{ marginTop: 12, color: BX.RUST, fontSize: 12 }}>{error}</div>}

        <button onClick={submit} disabled={!status || busy}
          style={btnPrimary({ width: "100%", marginTop: 18, padding: "16px 0", opacity: !status || busy ? 0.5 : 1 })}>
          {busy ? "Sending…" : "Send pulse"}
        </button>
      </div>
    </div>
  );
}

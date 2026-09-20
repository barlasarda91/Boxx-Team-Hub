import { useState } from "react";
import { api } from "../lib/api.js";
import { BX, label, serifH, btnPrimary, btnGhost, inputBx, bodyText } from "../lib/boxx.js";

// Weekly check-in: status + short note + asks (things needing the owner's
// decision — each ask becomes an item in the decision queue).
export default function CheckInModal({ domainId, onDone, onClose }) {
  const [status, setStatus] = useState(null);
  const [note, setNote] = useState("");
  const [asks, setAsks] = useState([]);
  const [askDraft, setAskDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!status) return;
    setBusy(true); setError(null);
    try {
      const body = { status, note, asks: asks.map(t => ({ title: t })) };
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
          <div style={serifH(20)}>Weekly check-in</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", ...label() }}>Close</button>
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

        <label htmlFor="ci-note" style={label({ display: "block", marginBottom: 6 })}>What happened · 2-3 lines</label>
        <textarea id="ci-note" value={note} onChange={e => setNote(e.target.value)} rows={3}
          placeholder="Short and plain. What moved, what slipped, what's next."
          style={inputBx({ width: "100%", resize: "vertical", lineHeight: 1.6 })} />

        <div style={label({ margin: "16px 0 6px" })}>Needs the owner's decision · optional</div>
        {asks.map((a, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0",
            borderBottom: `1px solid ${BX.STONE}` }}>
            <span style={bodyText({ fontSize: 12, flexGrow: 1 })}>{a}</span>
            <button onClick={() => setAsks(list => list.filter((_, idx) => idx !== i))} aria-label={`Remove ask: ${a}`}
              style={{ background: "none", border: "none", color: BX.RUST, cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={askDraft} onChange={e => setAskDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && askDraft.trim()) { setAsks(a => [...a, askDraft.trim()]); setAskDraft(""); } }}
            placeholder="e.g. Quote is over my limit: [$ AMOUNT]"
            style={inputBx({ flexGrow: 1, fontSize: 12 })} />
          <button onClick={() => { if (askDraft.trim()) { setAsks(a => [...a, askDraft.trim()]); setAskDraft(""); } }}
            style={btnGhost({ padding: "10px 16px" })}>Add</button>
        </div>

        {error && <div style={{ marginTop: 12, color: BX.RUST, fontSize: 12 }}>{error}</div>}

        <button onClick={submit} disabled={!status || busy}
          style={btnPrimary({ width: "100%", marginTop: 18, padding: "16px 0", opacity: !status || busy ? 0.5 : 1 })}>
          {busy ? "Submitting…" : "Submit check-in"}
        </button>
      </div>
    </div>
  );
}

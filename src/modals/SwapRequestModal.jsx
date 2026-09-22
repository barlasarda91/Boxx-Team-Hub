import { useState } from "react";
import { api } from "../lib/api.js";
import { BX, label, tag, bodyText, btnPrimary, btnGhost, inputBx } from "../lib/boxx.js";
import BxModal from "../components/BxModal.jsx";

// Any employee, from their own card: swap shifts with a teammate on a chosen
// day — any future week works, since the schedule repeats weekly. The request
// goes straight to Travis (his Swap Check list + a board mention); nothing
// changes on the schedule until it's approved.
const MEMBERS = ["Alex", "Amin", "Ben", "Brandon", "Manny", "Travis", "Vicky"];

export default function SwapRequestModal({ me, onClose }) {
  const [partner, setPartner] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);   // verdict after sending

  const today = new Date().toISOString().slice(0, 10);
  const ready = partner && date && date >= today;

  const send = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post("/api/swap-request", { partner, date, note: note || undefined });
      setResult(r.verdict);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <BxModal title="SWAP SHIFT" onClose={onClose} width={520}>
      <div style={{ padding: "18px 22px" }}>
        {!result ? (
          <>
            <div style={bodyText({ fontSize: 12, marginBottom: 16 })}>
              You and your swap partner trade shifts for one day. Travis gets the request
              automatically and checks it against overtime before anything changes.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <label>
                <div style={label({ fontSize: 8, marginBottom: 6 })}>SWAP WITH</div>
                <select value={partner} onChange={e => setPartner(e.target.value)}
                  style={inputBx({ fontSize: 12, padding: "9px 10px", minWidth: 140 })}>
                  <option value="">— teammate —</option>
                  {MEMBERS.filter(n => n !== me.user.name).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>
                <div style={label({ fontSize: 8, marginBottom: 6 })}>WHICH DAY</div>
                <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)}
                  style={inputBx({ fontSize: 12, padding: "8px 10px" })} />
              </label>
            </div>
            <label style={{ display: "block", marginBottom: 16 }}>
              <div style={label({ fontSize: 8, marginBottom: 6 })}>NOTE · OPTIONAL</div>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Dentist, family thing…"
                style={inputBx({ fontSize: 12, padding: "9px 10px", width: "100%" })} />
            </label>
            {error && <div style={{ color: BX.RUST, fontSize: 12, marginBottom: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={btnGhost({ fontSize: 9, padding: "10px 16px" })}>Cancel</button>
              <button onClick={send} disabled={!ready || busy}
                style={btnPrimary({ fontSize: 9, padding: "10px 18px", opacity: !ready || busy ? 0.4 : 1 })}>
                {busy ? "Sending…" : "Send to Travis"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <span style={tag(BX.OLIVE)}>SENT TO TRAVIS</span>
            </div>
            <div style={bodyText({ fontSize: 12, marginBottom: 10 })}>
              Your request is in his Swap Check list and he's been pinged on the board.
            </div>
            {result.creates_ot && (
              <div style={bodyText({ fontSize: 12, color: BX.AMBER, marginBottom: 10 })}>
                Heads up: this swap creates overtime, so it also needs the owner's approval after Travis reviews it.
              </div>
            )}
            {(result.notes || []).length > 0 && (
              <div style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD, marginBottom: 12 })}>
                {result.notes.join(" · ")}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={onClose} style={btnPrimary({ fontSize: 9, padding: "10px 18px" })}>Done</button>
            </div>
          </>
        )}
      </div>
    </BxModal>
  );
}

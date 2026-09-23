import { useState } from "react";
import { api } from "../lib/api.js";
import { BX, label, tag, bodyText, btnPrimary, btnGhost, inputBx } from "../lib/boxx.js";
import BxModal from "../components/BxModal.jsx";
import { useRoster } from "../lib/useRoster.js";

// Any employee, from their own card: swap shifts with a teammate on a chosen
// day — any future week works, since the schedule repeats weekly. The request
// goes straight to Travis (his Swap Check list + a board mention); nothing
// changes on the schedule until it's approved.
export default function SwapRequestModal({ me, onClose }) {
  const { members: MEMBERS } = useRoster();
  const [mode, setMode] = useState("cover");    // 'cover' | 'switch'
  const [partner, setPartner] = useState("");
  const [giveDate, setGiveDate] = useState("");
  const [takeDate, setTakeDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);   // verdict after sending

  const today = new Date().toISOString().slice(0, 10);
  const ready = partner && giveDate >= today && giveDate &&
    (mode === "cover" || (takeDate && takeDate >= today));

  const send = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post("/api/swap-request", {
        mode, partner, give_date: giveDate,
        take_date: mode === "switch" ? takeDate : undefined,
        note: note || undefined,
      });
      setResult(r.verdict);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const modeTag = (id, text) => (
    <button key={id} onClick={() => setMode(id)}
      style={{ cursor: "pointer", padding: "5px 12px", fontFamily: BX.MONO, fontWeight: 400, fontSize: 8,
        letterSpacing: "0.16em", textTransform: "uppercase",
        background: mode === id ? BX.INK : "transparent",
        color: mode === id ? BX.PARCHMENT : BX.DRIFTWOOD,
        border: `1px solid ${mode === id ? BX.INK : BX.LINEN}` }}>
      {text}
    </button>
  );

  return (
    <BxModal title="SWAP SHIFT" onClose={onClose} width={540}>
      <div style={{ padding: "18px 22px" }}>
        {!result ? (
          <>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
              <span style={label({ fontSize: 8 })}>TYPE:</span>
              {modeTag("cover", "Cover")}
              {modeTag("switch", "Switch")}
            </div>
            <div style={bodyText({ fontSize: 12, marginBottom: 16 })}>
              {mode === "cover"
                ? "You give one of your shifts away — they work it, you're off. "
                : "You give one of your shifts away and take one of theirs in return. "}
              Travis gets the request automatically and checks it against overtime before anything changes.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <label>
                <div style={label({ fontSize: 8, marginBottom: 6 })}>{mode === "cover" ? "WHO COVERS" : "SWITCH WITH"}</div>
                <select value={partner} onChange={e => setPartner(e.target.value)}
                  style={inputBx({ fontSize: 12, padding: "9px 10px", minWidth: 140 })}>
                  <option value="">— teammate —</option>
                  {MEMBERS.filter(n => n !== me.user.name).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>
                <div style={label({ fontSize: 8, marginBottom: 6 })}>YOUR SHIFT · THE DAY YOU GIVE</div>
                <input type="date" value={giveDate} min={today} onChange={e => setGiveDate(e.target.value)}
                  style={inputBx({ fontSize: 12, padding: "8px 10px" })} />
              </label>
              {mode === "switch" && (
                <label>
                  <div style={label({ fontSize: 8, marginBottom: 6 })}>THEIR SHIFT · THE DAY YOU TAKE</div>
                  <input type="date" value={takeDate} min={today} onChange={e => setTakeDate(e.target.value)}
                    style={inputBx({ fontSize: 12, padding: "8px 10px" })} />
                </label>
              )}
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

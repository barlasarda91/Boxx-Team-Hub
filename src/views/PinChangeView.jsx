import { useState } from "react";
import { api } from "../lib/api.js";
import { BX, label, serifH, btnPrimary, inputBx, bodyText } from "../lib/boxx.js";

// Forced on first sign-in (and after an owner PIN reset): pick your own PIN
// before entering the app. Also used voluntarily from Settings.
export default function PinChangeView({ userName, currentPin, onDone, forced = true }) {
  const [current, setCurrent] = useState(currentPin || "");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin1.length < 4) return setError("PIN must be 4-6 digits");
    if (pin1 !== pin2) return setError("PINs don't match");
    setBusy(true); setError(null);
    try {
      await api.post("/api/auth/change-pin", { current_pin: current, new_pin: pin1 });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const pinInput = (id, val, set, lbl, auto) => (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={label({ display: "block", marginBottom: 6 })}>{lbl}</label>
      <input id={id} type="password" inputMode="numeric" autoComplete="off" autoFocus={auto}
        value={val} maxLength={6}
        onChange={e => set(e.target.value.replace(/\D/g, ""))}
        onKeyDown={e => e.key === "Enter" && submit()}
        style={inputBx({ width: "100%", fontSize: 20, letterSpacing: "0.4em", textAlign: "center", padding: "12px" })} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: BX.PARCHMENT, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 20, fontFamily: BX.MONO, fontWeight: 300 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div style={serifH(24)}>Set your PIN</div>
          <div style={bodyText({ fontSize: 12, marginTop: 10, color: BX.DRIFTWOOD })}>
            {forced
              ? `${userName ? userName + ", the" : "The"} starting PIN is temporary. Pick your own before continuing.`
              : "Change your PIN."}
          </div>
        </div>
        {!currentPin && pinInput("cur", current, setCurrent, "Current PIN", true)}
        {pinInput("np1", pin1, setPin1, "New PIN · 4-6 digits", !!currentPin)}
        {pinInput("np2", pin2, setPin2, "New PIN again")}
        <button onClick={submit} disabled={busy || pin1.length < 4 || pin2.length < 4 || (!currentPin && current.length < 4)}
          style={btnPrimary({ width: "100%", padding: "16px 0", opacity: busy || pin1.length < 4 ? 0.5 : 1 })}>
          {busy ? "Saving…" : "Save PIN"}
        </button>
        {error && <div style={{ marginTop: 12, color: BX.RUST, fontSize: 12, textAlign: "center" }}>{error}</div>}
      </div>
    </div>
  );
}

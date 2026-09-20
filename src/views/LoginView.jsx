import { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import { BX, label, serifH, btnPrimary, inputBx } from "../lib/boxx.js";

// Name picker + PIN, mobile-first, per the Boxx tenets.
export default function LoginView({ onLogin }) {
  const [names, setNames] = useState([]);
  const [name, setName] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/auth/roster").then(d => setNames(d.names || [])).catch(e => setError(e.message));
  }, []);

  const submit = async () => {
    if (!name || !pin) return;
    setBusy(true); setError(null);
    try {
      const d = await api.post("/api/auth/login", { name, pin });
      onLogin(d.user, { mustChangePin: d.must_change_pin, pinUsed: pin });
    } catch (err) {
      setError(err.message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: BX.PARCHMENT, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 20, fontFamily: BX.MONO, fontWeight: 400 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={serifH(30)}>Boxx Hub</div>
          <div style={label({ marginTop: 8, letterSpacing: "0.24em" })}>Coffee Roasters Co.</div>
        </div>

        {!name ? (
          <div>
            <div style={label({ marginBottom: 12, textAlign: "center" })}>Who are you?</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {names.map(n => (
                <button key={n} onClick={() => setName(n)}
                  style={{ padding: "16px 8px", background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`,
                    fontFamily: BX.SERIF, fontSize: 16, color: BX.INK, cursor: "pointer", minHeight: 44 }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={serifH(18)}>{name}</span>
              <button onClick={() => { setName(null); setPin(""); setError(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", ...label({ textDecoration: "underline" }) }}>
                Not you?
              </button>
            </div>
            <label htmlFor="pin" style={label({ display: "block", marginBottom: 6 })}>PIN</label>
            <input id="pin" type="password" inputMode="numeric" autoComplete="off" autoFocus
              value={pin} maxLength={6}
              onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={e => e.key === "Enter" && submit()}
              style={inputBx({ width: "100%", fontSize: 22, letterSpacing: "0.4em", textAlign: "center", padding: "14px 12px" })} />
            <button onClick={submit} disabled={busy || pin.length < 4}
              style={btnPrimary({ width: "100%", marginTop: 12, padding: "16px 0", opacity: busy || pin.length < 4 ? 0.5 : 1 })}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        )}

        {error && <div style={{ marginTop: 14, color: BX.RUST, fontSize: 12, textAlign: "center" }}>{error}</div>}
      </div>
    </div>
  );
}

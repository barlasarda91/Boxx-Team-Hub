import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api.js";
import { BX, label, tag, card, bodyText, btnPrimary, btnGhost, inputBx } from "../../lib/boxx.js";

const DOSE_URL = "https://boxx-dose.up.railway.app/";

// Brandon's coffee ordering. The order itself happens on Boxx Dose — this tab
// opens it and keeps a one-tap log so the hub knows when coffee was last
// ordered. Once Boxx Dose sends confirmation emails, the log fills itself.
export default function CoffeeTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState("");
  const [logging, setLogging] = useState(false);
  const [armed, setArmed] = useState(null); // order id armed for delete (two-tap)

  const load = useCallback(() => {
    api.get("/api/coffee-orders").then(setData).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const logOrder = async () => {
    setLogging(true); setError(null);
    try {
      await api.post("/api/coffee-orders", { note });
      setNote("");
      load();
    } catch (err) { setError(err.message); }
    finally { setLogging(false); }
  };

  const remove = async (id) => {
    if (armed !== id) { setArmed(id); setTimeout(() => setArmed(a => a === id ? null : a), 3000); return; }
    setArmed(null);
    try { await api.del(`/api/coffee-orders/${id}`); load(); }
    catch (err) { setError(err.message); }
  };

  if (error && !data) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const last = data.orders[0];
  const daysSince = last
    ? Math.round((new Date(`${data.today}T12:00:00Z`) - new Date(`${last.ordered_date}T12:00:00Z`)) / 86400000)
    : null;
  const fmtD = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US",
    { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 760 }}>
      {error && <div style={bodyText({ color: BX.RUST, marginBottom: 12 })}>{error}</div>}

      <div style={{ ...card({ padding: "22px 24px", borderColor: BX.INK }), display: "flex", gap: 20,
        alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: BX.SERIF, fontSize: 18, marginBottom: 6 }}>Coffee ordering</div>
          <div style={bodyText({ fontSize: 12, maxWidth: "46ch" })}>
            Orders are placed on <span style={{ color: BX.AMBER, fontWeight: 500 }}>Boxx Dose</span> —
            the button opens it in a new tab. Place the order there, then log it below so the hub
            knows when coffee was last ordered.
          </div>
        </div>
        <a href={DOSE_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
          <button style={btnPrimary({ padding: "15px 28px" })}>
            Order coffee&nbsp;&nbsp;↗
            <div style={{ fontSize: 8, letterSpacing: 1.5, color: BX.LINEN, marginTop: 5, fontWeight: 300 }}>OPENS BOXX DOSE</div>
          </button>
        </a>
      </div>

      <div style={card({ padding: 0 })}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px",
          borderBottom: `1px solid ${BX.LINEN}`, flexWrap: "wrap" }}>
          <span style={label({ fontSize: 9, flex: 1, minWidth: 90 })}>ORDER LOG</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
            onKeyDown={e => { if (e.key === "Enter" && !logging) logOrder(); }}
            style={inputBx({ fontSize: 11, padding: "8px 11px", width: 220, maxWidth: "100%" })} />
          <button onClick={logOrder} disabled={logging} style={btnGhost({ fontSize: 8, padding: "9px 14px", opacity: logging ? 0.5 : 1 })}>
            {logging ? "Logging…" : "+ Log today's order"}
          </button>
        </div>

        {last && (
          <div style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.LINEN}`, background: "#F0E9DA" }}>
            <span style={label({ fontSize: 8 })}>
              LAST ORDER{" "}
              <span style={{ color: daysSince >= 7 ? BX.AMBER : BX.OLIVE }}>
                {daysSince === 0 ? "TODAY" : daysSince === 1 ? "YESTERDAY" : `${daysSince} DAYS AGO`}
              </span>
              {" "}· {fmtD(last.ordered_date).toUpperCase()}
            </span>
          </div>
        )}

        {data.orders.length === 0 ? (
          <div style={bodyText({ padding: "18px", color: BX.DRIFTWOOD, fontSize: 12 })}>
            No orders logged yet — after placing one on Boxx Dose, tap "+ Log today's order".
          </div>
        ) : data.orders.map(o => (
          <div key={o.id} style={{ display: "flex", gap: 14, padding: "10px 18px",
            borderBottom: `1px solid ${BX.STONE}`, fontSize: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ color: BX.AMBER, fontSize: 11, minWidth: 100 }}>{fmtD(o.ordered_date)}</span>
            <span style={{ color: BX.GRAPHITE, flex: 1, minWidth: 0 }}>{o.note || "—"}</span>
            <span style={{ fontSize: 9, color: BX.DRIFTWOOD, letterSpacing: 1, textTransform: "uppercase" }}>{o.logged_by}</span>
            <button onClick={() => remove(o.id)} title={armed === o.id ? "Tap again to remove" : "Remove entry"}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 11,
                color: armed === o.id ? BX.RUST : BX.LINEN, padding: "0 2px" }}>
              {armed === o.id ? "sure?" : "✕"}
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, fontSize: 9, lineHeight: 1.8, letterSpacing: 0.5, color: BX.DRIFTWOOD, maxWidth: "76ch" }}>
        COMING LATER · ONCE BOXX DOSE SENDS ORDER-CONFIRMATION EMAILS, THE HUB WILL LOG THEM AUTOMATICALLY AND THE TAP BECOMES OPTIONAL.
      </div>
    </div>
  );
}

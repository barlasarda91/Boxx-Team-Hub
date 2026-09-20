import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api.js";
import { BX, label, tag, card, bodyText, btnPrimary, btnGhost } from "../../lib/boxx.js";

// Swap checker: Claude reads the request, code decides. The verdict is
// deterministic from the standing schedule and CA overtime rules.
export default function SwapTab({ isMobile }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { parsed, verdict, id }
  const [checks, setChecks] = useState([]);
  const [error, setError] = useState(null);

  const loadChecks = useCallback(() => {
    api.get("/api/labor/swap-checks").then(d => setChecks(d.checks)).catch(() => {});
  }, []);
  useEffect(() => { loadChecks(); }, [loadChecks]);

  const check = async () => {
    if (!text.trim()) return;
    setBusy(true); setError(null); setResult(null);
    try { setResult(await api.post("/api/labor/swap-check", { text })); loadChecks(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const sendToOwner = async () => {
    try { await api.post(`/api/labor/swap-checks/${result.id}/send`); setResult(r => ({ ...r, sent: true })); loadChecks(); }
    catch (err) { setError(err.message); }
  };

  const verdictCard = (v, parsed, sent, canSend) => (
    <div style={card({ borderColor: v.creates_ot || !v.ok ? BX.RUST : BX.LINEN, marginBottom: 8 })}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
        <span style={label({ color: v.creates_ot || !v.ok ? BX.RUST : BX.INK, letterSpacing: "0.22em" })}>
          Verdict · deterministic · CA OT rules
        </span>
      </div>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ marginBottom: 10 }}>
          {!v.ok ? <span style={tag(BX.RUST)}>CANNOT CHECK</span>
            : v.creates_ot ? <span style={tag(BX.RUST)}>CREATES OVERTIME</span>
            : <span style={tag(BX.OLIVE)}>NO OT CREATED</span>}
        </div>
        {parsed?.summary && <div style={bodyText({ fontSize: 12, marginBottom: 8 })}>{parsed.summary}</div>}
        {v.notes?.map((n, i) => <div key={i} style={bodyText({ fontSize: 12, color: BX.RUST, marginBottom: 4 })}>{n}</div>)}
        {v.ok && <div style={bodyText({ fontSize: 12 })}>{v.verdict_text}</div>}
        {v.ok && v.creates_ot && canSend && (
          <div style={{ marginTop: 12 }}>
            {sent
              ? <span style={tag()}>SENT TO THE OWNER'S QUEUE</span>
              : <button onClick={sendToOwner} style={btnPrimary({ padding: "10px 18px", fontSize: 9 })}>Send to owner</button>}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 980 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
        <div>
          <div style={card({ marginBottom: 8 })}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
              <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Paste the swap request</span>
            </div>
            <div style={{ padding: "14px 16px" }}>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
                placeholder="e.g. Can I take Manny's Friday close this week? He'd take my Sunday mid."
                style={{ width: "100%", boxSizing: "border-box", fontFamily: BX.MONO, fontWeight: 400, fontSize: 13,
                  color: BX.INK, background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`, padding: 12, resize: "vertical" }} />
              <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                <button onClick={check} disabled={busy} style={btnPrimary({ opacity: busy ? 0.5 : 1 })}>
                  {busy ? "Checking…" : "Check swap"}
                </button>
                <button onClick={() => { setText(""); setResult(null); setError(null); }} style={btnGhost({ fontSize: 9 })}>Clear</button>
              </div>
              {error && <div style={{ marginTop: 10, color: BX.RUST, fontSize: 12 }}>{error}</div>}
            </div>
          </div>

          {result?.parsed?.legs?.length > 0 && (
            <div style={card({ marginBottom: 8 })}>
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between" }}>
                <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>What Claude read</span>
                <span style={label({ fontSize: 8 })}>PARSED · CODE DECIDES</span>
              </div>
              {result.parsed.legs.map((l, i) => (
                <div key={i} style={{ padding: "10px 16px", borderBottom: `1px solid ${BX.STONE}` }}>
                  <span style={bodyText({ fontSize: 12 })}>
                    <span style={{ fontFamily: BX.SERIF, color: BX.INK }}>{l.taker}</span> takes{" "}
                    <span style={{ fontFamily: BX.SERIF, color: BX.INK }}>{l.giver}</span>'s {l.day} shift
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          {result?.verdict && verdictCard(result.verdict, result.parsed, result.sent, true)}
          <div style={card()}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
              <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Previous checks</span>
            </div>
            {checks.length === 0 && <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>None yet.</div>}
            {checks.map(c => (
              <div key={c.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${BX.STONE}`,
                display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={bodyText({ fontSize: 12 })}>{c.parsed?.summary || c.text.slice(0, 60)}</span>
                <span style={{ marginLeft: "auto" }}>
                  {c.verdict?.creates_ot
                    ? <span style={tag(BX.AMBER)}>OT{c.decision_id ? " · SENT" : ""}</span>
                    : c.verdict?.ok ? <span style={tag()}>NO OT</span> : <span style={tag(BX.RUST)}>INVALID</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { BX, label, tag, bodyText, btnGhost } from "../lib/boxx.js";
import BxModal from "./BxModal.jsx";

// Pay-period hours, split the way payroll pays them: regular, overtime
// (1.5x) and double time (2x) per member, under California rules. Pages
// through every stored period, newest first.
const hrs = (m) => m == null ? "·" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const usd = (c) => c == null ? null : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtP = (d) => d ? d.slice(5).replace("-", "/") : "";

export default function PayrollBreakdown({ onClose }) {
  const [reports, setReports] = useState(null);
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/api/payroll/reports").then(d => setReports(d.reports)).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const r = reports?.[idx];
  const hasSplit = r && r.members.some(m => m.reg_min != null);
  const hasPay = r && r.members.some(m => (m.pay_cents || 0) > 0);

  // Hours on top, dollars beneath — the way Square's own report reads
  const duo = (min, cents, color) => (
    <>
      <div style={{ color: color && min > 0 ? color : undefined,
        opacity: min === 0 ? 0.45 : 1 }}>{hrs(min)}</div>
      {hasPay && <div style={{ fontSize: 10, color: BX.DRIFTWOOD, marginTop: 2,
        opacity: (cents || 0) === 0 ? 0.55 : 1 }}>{usd(cents || 0)}</div>}
    </>
  );

  const rebuild = async () => {
    setBusy(true); setError(null);
    try {
      await api.post("/api/payroll/run", { start: r.start, end: r.end });
      load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const th = { ...label({ fontSize: 8 }), padding: "9px 16px", borderBottom: `1px solid ${BX.LINEN}`, textAlign: "right" };
  const cell = { padding: "8px 16px", borderBottom: `1px solid ${BX.STONE}`, fontSize: 12, textAlign: "right",
    fontVariantNumeric: "tabular-nums" };
  const left = { textAlign: "left" };

  return (
    <BxModal title="PAY-PERIOD HOURS" onClose={onClose} width={720}>
      <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, padding: "0 0 16px" }}>
        <div style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex",
          gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center" }}>
            <button onClick={() => setIdx(i => Math.min((reports?.length || 1) - 1, i + 1))}
              style={{ fontFamily: BX.MONO, fontSize: 12, padding: "5px 11px", background: "transparent",
                border: `1px solid ${BX.LINEN}`, color: BX.GRAPHITE, cursor: "pointer",
                opacity: idx >= (reports?.length || 1) - 1 ? 0.4 : 1 }}>‹</button>
            <span style={{ ...label({ fontSize: 9 }), color: BX.INK, padding: "0 12px", minWidth: 130, textAlign: "center" }}>
              {r ? `${fmtP(r.start)} → ${fmtP(r.end)}` : "—"}
            </span>
            <button onClick={() => setIdx(i => Math.max(0, i - 1))}
              style={{ fontFamily: BX.MONO, fontSize: 12, padding: "5px 11px", background: "transparent",
                border: `1px solid ${BX.LINEN}`, color: BX.GRAPHITE, cursor: "pointer", opacity: idx === 0 ? 0.4 : 1 }}>›</button>
          </span>
          <span style={{ fontSize: 9, color: BX.DRIFTWOOD }}>
            CA RULES · OVER 8H = OT · OVER 12H = 2× · 7TH STRAIGHT DAY STARTS AT OT · PAST 40H/WEEK = OT
          </span>
        </div>

        {error && <div style={bodyText({ color: BX.RUST, fontSize: 12, padding: "12px 22px" })}>{error}</div>}
        {!reports && !error && <div style={bodyText({ padding: "14px 22px", color: BX.DRIFTWOOD })}>Loading…</div>}
        {reports && reports.length === 0 && (
          <div style={bodyText({ padding: "16px 22px", color: BX.DRIFTWOOD })}>
            No periods stored yet — the first lands at 8pm on the next 12th or 28th.
          </div>
        )}

        {r && !hasSplit && (
          <div style={{ margin: "12px 22px", padding: "10px 14px", border: `1px solid ${BX.AMBER}`,
            display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={bodyText({ fontSize: 12, flex: 1, minWidth: 200 })}>
              This period was stored before the regular/overtime/double split existed — rebuild it to get the full breakdown.
            </span>
            <button onClick={rebuild} disabled={busy} style={btnGhost({ fontSize: 8, padding: "8px 13px", opacity: busy ? 0.5 : 1 })}>
              {busy ? "Pulling…" : "Rebuild this period"}
            </button>
          </div>
        )}

        {r && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, ...left }}>MEMBER</th>
              <th style={th}>REGULAR</th><th style={th}>OVERTIME 1.5×</th><th style={th}>DOUBLE 2×</th>
              <th style={th}>{hasPay ? "PAID" : "TOTAL"}</th><th style={th}>DAYS</th>
            </tr></thead>
            <tbody>
              {r.members.map(m => (
                <tr key={m.name}>
                  <td style={{ ...cell, ...left, fontFamily: BX.SERIF, fontSize: 13, verticalAlign: "top" }}>
                    {m.name}
                    {m.open_shifts > 0 && <span style={tag(BX.RUST, { marginLeft: 8 })}>{m.open_shifts} ON CLOCK</span>}
                    {m.unmatched && <span style={tag(BX.DRIFTWOOD, { marginLeft: 8 })}>NOT ON ROSTER</span>}
                    {hasPay && (m.pay_cents || 0) === 0 && <span style={tag(BX.AMBER, { marginLeft: 8 })}>NO WAGE ON FILE</span>}
                  </td>
                  <td style={cell}>{duo(m.reg_min, m.reg_cents)}</td>
                  <td style={cell}>{duo(m.ot_min, m.ot_cents, BX.AMBER)}</td>
                  <td style={cell}>{duo(m.dt_min, m.dt_cents, BX.RUST)}</td>
                  <td style={{ ...cell, fontWeight: 500 }}>
                    <div>{hrs(m.minutes)}</div>
                    {hasPay && <div style={{ fontSize: 10, color: BX.GRAPHITE, marginTop: 2, fontWeight: 500 }}>{usd(m.pay_cents || 0)}</div>}
                  </td>
                  <td style={{ ...cell, verticalAlign: "top" }}>{m.days}</td>
                </tr>
              ))}
            </tbody>
            {hasSplit && (
              <tfoot><tr>
                <td style={{ ...cell, ...left, borderBottom: "none", ...label({ fontSize: 8 }) }}>TEAM</td>
                <td style={{ ...cell, borderBottom: "none", fontWeight: 500 }}>{duo(r.total_reg_min, r.members.reduce((a, m) => a + (m.reg_cents || 0), 0))}</td>
                <td style={{ ...cell, borderBottom: "none", fontWeight: 500 }}>{duo(r.total_ot_min, r.members.reduce((a, m) => a + (m.ot_cents || 0), 0), BX.AMBER)}</td>
                <td style={{ ...cell, borderBottom: "none", fontWeight: 500 }}>{duo(r.total_dt_min, r.members.reduce((a, m) => a + (m.dt_cents || 0), 0), BX.RUST)}</td>
                <td style={{ ...cell, borderBottom: "none", fontWeight: 500 }}>
                  <div>{hrs(r.total_minutes)}</div>
                  {hasPay && <div style={{ fontSize: 10, color: BX.GRAPHITE, marginTop: 2 }}>{usd(r.total_pay_cents || 0)}</div>}
                </td>
                <td style={{ ...cell, borderBottom: "none" }} />
              </tr></tfoot>
            )}
          </table>
        )}
        {r && (
          <div style={{ padding: "10px 22px 0", fontSize: 9, color: BX.DRIFTWOOD }}>
            GENERATED {new Date(r.generated_at).toLocaleString()} · SQUARE TIMECARDS AND WAGES, UNPAID BREAKS DEDUCTED ·
            OT PAYS 1.5×, DOUBLE PAYS 2× · WORKWEEKS RUN MON–SUN, SO A WEEK CUT BY THE PERIOD STILL COUNTS ITS FULL 40H
          </div>
        )}
      </div>
    </BxModal>
  );
}

import { useState, useEffect } from "react";
import { api } from "../../lib/api.js";
import { BX, label, tag, card, bodyText } from "../../lib/boxx.js";

const fmt$ = (n) => n == null ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const fmtU = (n) => n == null ? "—" : `$${Number(n).toFixed(3)}`;

// Orders: the Odeko & Shoreline watchdog. Every confirmed invoice line is
// matched against prior invoices; price movement surfaces here.
export default function OrdersWatchTab({ isMobile }) {
  const [changes, setChanges] = useState(null);
  const [comparison, setComparison] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [spend, setSpend] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get("/api/catalog/price-changes"),
      api.get("/api/catalog/price-comparison"),
      api.get("/api/invoices"),
      api.get("/api/expenses/summary"),
    ]).then(([pc, cmp, inv, sp]) => {
      setChanges(pc.changes);
      setComparison(cmp.comparison);
      setInvoices((inv.invoices || []).filter(i => i.vendor_kind !== "pastry").slice(0, 6));
      setSpend(sp);
    }).catch(e => setError(e.message));
  }, []);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!changes) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const chColor = (pct) => pct > 7 ? BX.RUST : pct > 0 ? BX.AMBER : BX.OLIVE;

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 300, color: BX.INK, maxWidth: 980 }}>
      <div style={{ marginBottom: 12 }}>
        <span style={label()}>ODEKO &amp; SHORELINE · SCANNED FROM BILLING@BOXXCOFFEE.COM · EVERY LINE MATCHED AGAINST PRIOR INVOICES</span>
      </div>

      <div style={card({ marginBottom: 8, borderColor: changes.length ? BX.RUST : BX.LINEN })}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: changes.length ? BX.RUST : BX.INK, letterSpacing: "0.22em" })}>
            Price changes · last 90 days
          </span>
        </div>
        {changes.length === 0 && (
          <div style={bodyText({ padding: "14px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>
            No price movement on confirmed invoices yet.
          </div>
        )}
        {changes.slice(0, 8).map((c, i) => (
          <div key={i} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`,
            display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 14, minWidth: isMobile ? "100%" : 170 }}>{c.item}</span>
            <span style={tag()}>{c.vendor?.toUpperCase()}</span>
            <span style={{ fontSize: 12, color: chColor(c.pct) }}>
              {fmt$(c.from_price)} → {fmt$(c.to_price)}{c.unit ? ` per ${c.unit}` : ""} · {c.pct > 0 ? "+" : ""}{c.pct}%
            </span>
            <span style={{ fontSize: 10, color: BX.DRIFTWOOD, marginLeft: "auto" }}>{c.observed_date}</span>
          </div>
        ))}
      </div>

      <div style={card({ marginBottom: 8 })}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Where to buy · dual-sourced items</span>
        </div>
        {comparison.length === 0 && <div style={bodyText({ padding: "14px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>Import the catalogue to compare vendors.</div>}
        {comparison.slice(0, 8).map((c, i) => (
          <div key={i} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`,
            display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 14, minWidth: isMobile ? "100%" : 170 }}>{c.front_name}</span>
            <span style={tag(BX.OLIVE)}>{c.cheaper?.toUpperCase()}</span>
            <span style={{ fontSize: 11, color: BX.GRAPHITE }}>
              {c.sides.map(s => `${s.vendor} ${fmtU(s.cost_per_unit)}`).join(" vs ")}
            </span>
            <span style={{ fontSize: 11, color: c.saving_at_volume > 50 ? BX.RUST : BX.DRIFTWOOD, marginLeft: "auto" }}>
              ${c.saving_at_volume}/yr at volume
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr", gap: 8 }}>
        <div style={card()}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Recent invoices</span>
          </div>
          {invoices.length === 0 && <div style={bodyText({ padding: "14px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>Nothing yet.</div>}
          {invoices.map(inv => (
            <div key={inv.id} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`,
              display: "flex", gap: 10, alignItems: "baseline" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{inv.vendor_name || "?"} {inv.invoice_number || ""}</span>
              <span style={{ fontSize: 11, color: BX.DRIFTWOOD }}>{inv.invoice_date || "·"} · {fmt$(inv.total)}</span>
              <span style={{ marginLeft: "auto" }}>
                {inv.status === "pending_review"
                  ? <span style={tag(BX.AMBER)}>NEEDS REVIEW</span>
                  : <span style={tag()}>{(inv.status || "").toUpperCase()}</span>}
              </span>
            </div>
          ))}
        </div>
        <div style={card()}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Spend · last 30 days</span>
          </div>
          {(spend?.by_vendor || []).slice(0, 5).map((v, i) => (
            <div key={i} style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`,
              display: "flex", alignItems: "baseline" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{v.vendor}</span>
              <span style={{ marginLeft: "auto", fontSize: 12 }}>{fmt$(v.total)} · {v.invoices} inv</span>
            </div>
          ))}
          {spend && (() => {
            const prev = (spend.by_vendor_prev || []).reduce((a, v) => a + (v.total || 0), 0);
            const cur = spend.total_spend || 0;
            return (
              <div style={{ padding: "10px 18px", display: "flex", alignItems: "baseline" }}>
                <span style={bodyText({ fontSize: 11 })}>total {fmt$(cur)}</span>
                {prev > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: 11, color: cur > prev ? BX.AMBER : BX.OLIVE }}>
                    {cur > prev ? "+" : ""}{Math.round(((cur - prev) / prev) * 100)}% vs prior 30d
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

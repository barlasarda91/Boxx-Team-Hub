import { useState, useEffect } from "react";
import { api } from "../../lib/api.js";
import { BX, label, tag, card, bodyText } from "../../lib/boxx.js";
import BxModal from "../../components/BxModal.jsx";

const fmt$ = (n) => n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtU = (n) => n == null ? "—" : `$${Number(n).toFixed(3)}`;

// The verdict behind one "where to buy" row: each vendor's actual product,
// its price history, and what was really bought over the last year.
function DualSourceModal({ item, isMobile, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get(`/api/catalog/price-comparison/detail?item=${encodeURIComponent(item)}`)
      .then(setD).catch(e => setError(e.message));
  }, [item]);

  return (
    <BxModal title="WHERE TO BUY — THE EVIDENCE" onClose={onClose} width={780}>
      <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, padding: "16px 22px 20px" }}>
        {error && <div style={bodyText({ color: BX.RUST })}>{error}</div>}
        {!d && !error && <div style={bodyText({ color: BX.DRIFTWOOD })}>Loading…</div>}
        {d && (() => {
          const best = d.sides[0];
          const pctMore = (s) => best.cost_per_unit > 0
            ? Math.round(((s.cost_per_unit - best.cost_per_unit) / best.cost_per_unit) * 100) : 0;
          return (
            <>
              <div style={{ fontFamily: BX.SERIF, fontSize: 22, marginBottom: 2 }}>{d.front_name}</div>
              <div style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD, marginBottom: 14 })}>
                Listed in the catalogue as "{d.canonical_item}"
              </div>

              <div style={{ border: `1px solid ${BX.OLIVE}`, padding: "12px 16px", marginBottom: 14,
                display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={tag(BX.OLIVE)}>BUY FROM {d.cheaper?.toUpperCase()}</span>
                <span style={{ fontSize: 12 }}>
                  {fmtU(best.cost_per_unit)} per {d.unit || "unit"} — cheapest of {d.sides.length} vendors
                </span>
                {d.saving_at_volume > 0 && (
                  <span style={{ fontSize: 11, color: d.saving_at_volume > 50 ? BX.RUST : BX.DRIFTWOOD, marginLeft: "auto" }}>
                    ≈ ${d.saving_at_volume}/yr at last year's volume ({d.units_12m} {d.unit || "units"})
                  </span>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${Math.min(d.sides.length, 2)}, 1fr)`, gap: 10 }}>
                {d.sides.map((s, i) => (
                  <div key={i} style={{ border: `1px solid ${i === 0 ? BX.OLIVE : BX.LINEN}`,
                    background: i === 0 ? "#F0EEDF" : "transparent" }}>
                    <div style={{ padding: "11px 15px", borderBottom: `1px solid ${i === 0 ? BX.OLIVE : BX.LINEN}`,
                      display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: BX.SERIF, fontSize: 15 }}>{s.vendor}</span>
                      {i === 0
                        ? <span style={tag(BX.OLIVE, { marginLeft: "auto" })}>BUY HERE</span>
                        : <span style={tag(BX.RUST, { marginLeft: "auto" })}>+{pctMore(s)}% PER UNIT</span>}
                    </div>
                    <div style={{ padding: "12px 15px", display: "flex", flexDirection: "column", gap: 9, fontSize: 11 }}>
                      <div>
                        <div style={label({ fontSize: 7, marginBottom: 3 })}>THEIR PRODUCT</div>
                        <div style={{ color: BX.GRAPHITE, lineHeight: 1.5 }}>
                          {s.vendor_description || s.purchases_12m?.last_description || d.canonical_item}
                        </div>
                        {s.sku && <div style={{ color: BX.DRIFTWOOD, fontSize: 10, marginTop: 2 }}>SKU {s.sku}</div>}
                      </div>
                      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                        <div>
                          <div style={label({ fontSize: 7, marginBottom: 3 })}>PACK</div>
                          <div>{s.pack_qty} {s.order_unit || ""} · {fmt$(s.latest_pack_price)}</div>
                        </div>
                        <div>
                          <div style={label({ fontSize: 7, marginBottom: 3 })}>PER {(d.unit || "unit").toUpperCase()}</div>
                          <div style={{ fontFamily: BX.SERIF, fontSize: 16, color: i === 0 ? BX.OLIVE : BX.INK }}>
                            {fmtU(s.cost_per_unit)}
                          </div>
                        </div>
                        {s.as_of && (
                          <div>
                            <div style={label({ fontSize: 7, marginBottom: 3 })}>PRICED</div>
                            <div style={{ color: BX.DRIFTWOOD }}>{s.as_of}</div>
                          </div>
                        )}
                      </div>
                      <div>
                        <div style={label({ fontSize: 7, marginBottom: 3 })}>BOUGHT · LAST 12 MONTHS</div>
                        {s.purchases_12m ? (
                          <div style={{ color: BX.GRAPHITE }}>
                            {s.purchases_12m.packs} packs across {s.purchases_12m.orders} invoice line{s.purchases_12m.orders === 1 ? "" : "s"} · {fmt$(s.purchases_12m.spend)} spent
                            {s.purchases_12m.last_date && <span style={{ color: BX.DRIFTWOOD }}> · last {s.purchases_12m.last_date}</span>}
                          </div>
                        ) : (
                          <div style={{ color: BX.DRIFTWOOD }}>Nothing on confirmed invoices — price is from the catalogue.</div>
                        )}
                      </div>
                      {s.history.length > 1 && (
                        <div>
                          <div style={label({ fontSize: 7, marginBottom: 3 })}>PRICE HISTORY</div>
                          {s.history.map((h, j) => (
                            <div key={j} style={{ display: "flex", gap: 10, padding: "2px 0", color: j === 0 ? BX.INK : BX.DRIFTWOOD }}>
                              <span style={{ minWidth: 80 }}>{h.observed_date}</span>
                              <span>{fmt$(h.unit_price)}{h.unit ? ` per ${h.unit}` : ""}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, fontSize: 9, lineHeight: 1.8, letterSpacing: 0.5, color: BX.DRIFTWOOD }}>
                PER-UNIT = LATEST PACK PRICE ÷ PACK SIZE, SO DIFFERENT PACK SIZES COMPARE FAIRLY ·
                YEARLY SAVING = PRICE GAP × UNITS ACTUALLY BOUGHT IN THE LAST 12 MONTHS ·
                PRICES COME FROM CONFIRMED INVOICES AND THE IMPORTED CATALOGUE
              </div>
            </>
          );
        })()}
      </div>
    </BxModal>
  );
}

// Orders: the Odeko & Shoreline watchdog. Every confirmed invoice line is
// matched against prior invoices; price movement surfaces here.
export default function OrdersWatchTab({ isMobile }) {
  const [changes, setChanges] = useState(null);
  const [comparison, setComparison] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [spend, setSpend] = useState(null);
  const [error, setError] = useState(null);
  const [detailItem, setDetailItem] = useState(null); // canonical_item for the modal
  const [showAll, setShowAll] = useState(false);      // full dual-sourced list

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
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 980 }}>
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
        <div onClick={() => comparison.length > 0 && setShowAll(true)}
          style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex",
            alignItems: "baseline", gap: 10, cursor: comparison.length > 0 ? "pointer" : "default" }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Where to buy · dual-sourced items</span>
          {comparison.length > 0 && (
            <span style={{ marginLeft: "auto", fontSize: 10, color: BX.DRIFTWOOD, letterSpacing: 1 }}>
              ALL {comparison.length} ›
            </span>
          )}
        </div>
        {comparison.length === 0 && <div style={bodyText({ padding: "14px 18px", fontSize: 12, color: BX.DRIFTWOOD })}>Import the catalogue to compare vendors.</div>}
        {comparison.slice(0, 8).map((c, i) => (
          <div key={i} onClick={() => setDetailItem(c.canonical_item)}
            style={{ padding: "10px 18px", borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer",
              display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 14, minWidth: isMobile ? "100%" : 170 }}>{c.front_name}</span>
            <span style={tag(BX.OLIVE)}>{c.cheaper?.toUpperCase()}</span>
            <span style={{ fontSize: 11, color: BX.GRAPHITE }}>
              {c.sides.map(s => `${s.vendor} ${fmtU(s.cost_per_unit)}`).join(" vs ")}
            </span>
            <span style={{ fontSize: 11, color: c.saving_at_volume > 50 ? BX.RUST : BX.DRIFTWOOD, marginLeft: "auto" }}>
              ${c.saving_at_volume}/yr at volume
            </span>
            <span style={{ fontSize: 11, color: BX.DRIFTWOOD }}>›</span>
          </div>
        ))}
      </div>

      {showAll && (
        <BxModal title={`WHERE TO BUY · ALL ${comparison.length} DUAL-SOURCED ITEMS`} onClose={() => setShowAll(false)} width={760}>
          <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, paddingBottom: 8 }}>
            {comparison.map((c, i) => (
              <div key={i} onClick={() => setDetailItem(c.canonical_item)}
                style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer",
                  display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontFamily: BX.SERIF, fontSize: 14, minWidth: isMobile ? "100%" : 170 }}>{c.front_name}</span>
                <span style={tag(BX.OLIVE)}>{c.cheaper?.toUpperCase()}</span>
                <span style={{ fontSize: 11, color: BX.GRAPHITE }}>
                  {c.sides.map(s => `${s.vendor} ${fmtU(s.cost_per_unit)}`).join(" vs ")}
                </span>
                <span style={{ fontSize: 11, color: c.saving_at_volume > 50 ? BX.RUST : BX.DRIFTWOOD, marginLeft: "auto" }}>
                  ${c.saving_at_volume}/yr at volume
                </span>
                <span style={{ fontSize: 11, color: BX.DRIFTWOOD }}>›</span>
              </div>
            ))}
            <div style={{ padding: "12px 22px 6px", fontSize: 9, letterSpacing: 0.5, color: BX.DRIFTWOOD, lineHeight: 1.8 }}>
              SORTED BY YEARLY SAVING AT LAST YEAR'S VOLUME · TAP AN ITEM FOR BOTH VENDORS' PRODUCTS, PRICE HISTORY AND THE FULL MATH
            </div>
          </div>
        </BxModal>
      )}
      {detailItem && <DualSourceModal item={detailItem} isMobile={isMobile} onClose={() => setDetailItem(null)} />}

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

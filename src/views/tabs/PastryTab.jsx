import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api } from "../../lib/api.js";
import { DAY_NAMES, laDateStr, addDaysStr, getCurrentMonday, minsToLabel } from "../../lib/dates.js";
import { squareFetchOrders, flattenOrders } from "../../lib/square.js";
import { analyzeWeek, getActiveOrdersForDate } from "../../lib/orders.js";
import { BX, label, eyebrow, tag, card, bodyText, btnPrimary, btnGhost } from "../../lib/boxx.js";
import BxModal from "../../components/BxModal.jsx";
import OrderUploadModal from "../../modals/OrderUploadModal.jsx";
import ItemDeepDive from "./ItemDeepDive.jsx";
const EARLY_MINS = 180;

const statTile = (l, v, sub, color = BX.INK) => (
  <div key={l} style={card({ padding: "13px 15px" })}>
    <div style={label({ fontSize: 8, marginBottom: 7 })}>{l}</div>
    <div style={{ fontFamily: BX.SERIF, fontSize: 24, color }}>{v}</div>
    <div style={label({ fontSize: 7, marginTop: 5 })}>{sub}</div>
  </div>
);

const cardHead = (title, right = null, color = BX.INK) => (
  <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}`,
    display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
    <span style={label({ color, letterSpacing: "0.2em" })}>{title}</span>{right}
  </div>
);

function selloutHits(s) {
  return s.dayResults.filter(d => (d.soldOut || d.oversold) && d.sellOutTime);
}
const timeSpan = (d) => (
  <span key={d.date} style={{ color: d.minsFromOpen != null && d.minsFromOpen < EARLY_MINS ? BX.AMBER : BX.GRAPHITE }}>
    {d.dayName.slice(0, 3)} {d.sellOutTime}
  </span>
);

// ─── The Pastry tab: live current week, sell-outs, standing order, reports ────
export default function PastryTab({ isMobile }) {
  const monday = getCurrentMonday();
  const today = laDateStr();
  const [history, setHistory] = useState(null);
  const [weekData, setWeekData] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportsMeta, setReportsMeta] = useState(null);
  const [recon, setRecon] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // {type:'sellouts'|'waste'|'day'|'item'|'report'|'upload'|'mapping', ...}
  const [report, setReport] = useState(null);
  const [sqError, setSqError] = useState(null);
  const [mapping, setMapping] = useState(null); // /api/square-map payload

  const load = useCallback(async () => {
    try {
      const h = await api.get("/api/standing-orders/history");
      const hist = (h.versions || []).map(v => ({ effectiveDate: v.effectiveDate, orders: v.orders }));
      setHistory(hist);
      const [reps, rec] = await Promise.all([
        api.get("/api/pastry/reports").catch(() => ({ reports: [] })),
        api.get("/api/pastry/reconciliation").catch(() => null),
      ]);
      setReports(reps.reports || []);
      setReportsMeta({ backfilling: reps.backfilling, missing: reps.missing });
      setRecon(rec);
      if (hist.length === 0) { setWeekData([]); return; }
      let userMap = null;
      try {
        const m = await api.get("/api/square-map");
        setMapping(m);
        userMap = Object.fromEntries(m.rows
          .filter(r => r.status === "mapped" || r.status === "ignored")
          .map(r => [r.key, r.app_item]));
      } catch { /* mapping screen degrades; tracker still runs on aliases */ }
      try {
        const raw = await squareFetchOrders(monday);
        const tx = flattenOrders(raw, userMap);
        const active = getActiveOrdersForDate(hist, today) || {};
        setWeekData(analyzeWeek(active, tx, monday, hist));
        setSqError(null);
      } catch (err) {
        setSqError(err.message);
        setWeekData([]);
      }
    } catch (err) { setError(err.message); }
  }, [monday, today]);
  useEffect(() => { load(); }, [load]);

  // While past weeks are building server-side, refresh the list until done
  useEffect(() => {
    if (!reportsMeta?.backfilling) return;
    let tries = 0;
    const t = setInterval(async () => {
      tries += 1;
      try {
        const reps = await api.get("/api/pastry/reports");
        setReports(reps.reports || []);
        setReportsMeta({ backfilling: reps.backfilling, missing: reps.missing });
        if (!reps.backfilling || tries >= 12) clearInterval(t);
      } catch { clearInterval(t); }
    }, 7000);
    return () => clearInterval(t);
  }, [reportsMeta?.backfilling]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (weekData == null) return <div style={bodyText({ padding: 20 })}>Pulling this week from Square…</div>;

  const activeOrders = history?.length ? (getActiveOrdersForDate(history, today) || {}) : {};
  const currentVersion = history?.find(v => v.effectiveDate <= today);

  // Tiles: completed days count for waste/efficiency; today stays live
  const completed = (d) => d.date < today;
  const soFar = (d) => d.date <= today;
  const orderedSoFar = weekData.reduce((a, s) => a + s.dayResults.filter(soFar).reduce((x, d) => x + d.ordered, 0), 0);
  const soldSoFar = weekData.reduce((a, s) => a + s.totalSold, 0);
  const wasteDone = weekData.reduce((a, s) => a + s.dayResults.filter(completed).reduce((x, d) => x + d.waste, 0), 0);
  const orderedDone = weekData.reduce((a, s) => a + s.dayResults.filter(completed).reduce((x, d) => x + d.ordered, 0), 0);
  const soldDone = weekData.reduce((a, s) => a + s.dayResults.filter(completed).reduce((x, d) => x + d.sold, 0), 0);
  const eff = orderedDone > 0 ? Math.round((soldDone / orderedDone) * 100) : null;
  const soldOutItems = weekData.filter(s => s.soldOutCount > 0);

  const daily = DAY_NAMES.map((day, i) => {
    const date = addDaysStr(monday, i);
    return {
      day: day.slice(0, 3) + (date === today ? " · LIVE" : ""), dayIndex: i, date,
      Ordered: weekData.reduce((a, s) => a + (s.dayResults[i]?.ordered || 0), 0),
      Sold: weekData.reduce((a, s) => a + (s.dayResults[i]?.sold || 0), 0),
    };
  });

  const byWaste = [...weekData].filter(s => (s.totalWaste || 0) > 0).sort((a, b) => b.totalWaste - a.totalWaste);
  const bySellout = [...soldOutItems].sort((a, b) => b.soldOutCount - a.soldOutCount);
  const daysElapsed = Math.min(7, Math.round((new Date(today) - new Date(monday)) / 86400000));
  const top = bySellout[0];
  const topEarly = top ? selloutHits(top).filter(d => d.minsFromOpen != null && d.minsFromOpen < EARLY_MINS).length : 0;

  const openReport = async (mondayStr) => {
    setModal({ type: "report" }); setReport(null);
    try { setReport((await api.get(`/api/pastry/reports/${mondayStr}`)).report); }
    catch (err) { setError(err.message); setModal(null); }
  };

  const saveOrders = async (orders, effectiveDate) => {
    await api.post("/api/standing-orders", { effective_date: effectiveDate, orders });
    setModal(null);
    load();
  };

  const itemRow = (s, right) => (
    <div key={s.item} style={{ padding: "10px 16px", borderBottom: `1px solid ${BX.STONE}`,
      display: "flex", gap: 10, alignItems: "baseline", cursor: "pointer" }}
      onClick={() => setModal({ type: "item", item: s.item })}>
      <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{s.item}</span>
      <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 500 }}>{right}</span>
    </div>
  );

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 1050 }}>
      {/* Week strip */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: BX.SERIF, fontSize: 17 }}>
          This week · {monday.slice(5).replace("-", "/")} to {addDaysStr(monday, 6).slice(5).replace("-", "/")}
        </span>
        <span style={tag(BX.OLIVE)}>IN PROGRESS · LIVE FROM SQUARE</span>
        {currentVersion && <span style={tag()}>{`STANDING ORDER · EFFECTIVE ${currentVersion.effectiveDate}`}</span>}
      </div>

      {sqError && (
        <div style={card({ padding: "12px 16px", marginBottom: 8, borderColor: BX.AMBER })}>
          <span style={bodyText({ fontSize: 12, color: BX.AMBER })}>
            Square is not reachable, so the live week cannot load ({sqError}). The standing order and past reports still work below.
          </span>
        </div>
      )}
      {history?.length === 0 ? (
        <div style={card({ padding: "20px 18px", marginBottom: 8 })}>
          <span style={bodyText({ fontSize: 13 })}>No standing order yet. Upload the current one below to start the tracker.</span>
        </div>
      ) : weekData.length === 0 ? null : (
        <>
          {/* Tiles */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5, 1fr)", gap: 8, marginBottom: 8 }}>
            {statTile("ITEMS TRACKED", weekData.length, "OH LA LA")}
            {statTile("TOTAL SOLD", Math.round(soldSoFar), `OF ${orderedSoFar} ORDERED SO FAR`)}
            {statTile("EFFICIENCY", eff != null ? `${eff}%` : "—", "COMPLETED DAYS")}
            {statTile("WASTE", wasteDone, orderedDone ? `UNITS · ${Math.round((wasteDone / orderedDone) * 100)}% OF ORDERED` : "UNITS", wasteDone > 0 ? BX.RUST : BX.INK)}
            {statTile("SOLD-OUT ITEMS", soldOutItems.length, "≥1 DAY SOLD OUT")}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr", gap: 8, marginBottom: 8 }}>
            {/* Chart */}
            <div style={card()}>
              {cardHead("Daily sold vs ordered", <span style={label({ fontSize: 8 })}>TAP A DAY FOR DETAIL</span>)}
              <div style={{ padding: "14px 12px 6px" }}>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={daily} barGap={3} style={{ cursor: "pointer" }}
                    onClick={e => e?.activePayload && setModal({ type: "day", dayIndex: e.activePayload[0]?.payload?.dayIndex ?? 0 })}>
                    <CartesianGrid stroke={BX.STONE} strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="day" stroke={BX.DRIFTWOOD} tick={{ fill: BX.DRIFTWOOD, fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis stroke={BX.DRIFTWOOD} tick={{ fill: BX.DRIFTWOOD, fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: `${BX.STONE}80` }} contentStyle={{ background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`, fontFamily: BX.MONO, fontSize: 11 }} />
                    <Bar dataKey="Ordered" fill={BX.STONE} />
                    <Bar dataKey="Sold" fill={BX.GRAPHITE} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              {/* Most waste */}
              <div style={card({ marginBottom: 8, borderColor: byWaste.length ? BX.RUST : BX.LINEN })}>
                {cardHead("Most waste", null, byWaste.length ? BX.RUST : BX.INK)}
                {byWaste.length === 0 && <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>No waste on completed days.</div>}
                {byWaste.slice(0, 3).map(s => itemRow(s,
                  <span style={{ color: BX.RUST }}>
                    {s.totalWaste} units{s.unitPrice ? ` · $${(s.totalWaste * s.unitPrice).toFixed(2)}` : ""}
                  </span>))}
                {byWaste.length > 3 && (
                  <button onClick={() => setModal({ type: "waste" })}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 16px",
                      ...label({ fontSize: 8, color: BX.INK, textDecoration: "underline" }) }}>
                    VIEW ALL · {byWaste.length} ITEMS →
                  </button>
                )}
              </div>

              {/* Sell-outs */}
              <div style={card()}>
                {cardHead("Sell-outs")}
                {top ? (
                  <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.STONE}` }}>
                    <span style={bodyText({ fontSize: 11, color: BX.AMBER })}>
                      {top.item} sold out {top.soldOutCount} of {daysElapsed} days{topEarly > 0 ? `, ${topEarly} time${topEarly > 1 ? "s" : ""} before 10a.` : "."}
                    </span>
                  </div>
                ) : (
                  <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>Nothing sold out yet this week.</div>
                )}
                {bySellout.slice(0, 3).map(s => itemRow(s, `${s.soldOutCount} of ${daysElapsed} days`))}
                {bySellout.length > 0 && (
                  <button onClick={() => setModal({ type: "sellouts" })}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 16px",
                      ...label({ fontSize: 8, color: BX.INK, textDecoration: "underline" }) }}>
                    VIEW ALL · {bySellout.length} ITEMS →
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Past weeks */}
      <div style={card({ marginBottom: 8 })}>
        {cardHead("Past weeks", <span style={label({ fontSize: 8 })}>SIMPLIFIED REPORT · PUBLISHED MONDAY 6:00A · BACK TO THE EARLIEST ORDER ON FILE</span>)}
        {reportsMeta?.backfilling && (
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${BX.STONE}` }}>
            <span style={bodyText({ fontSize: 11, color: BX.OLIVE })}>
              Building {reportsMeta.missing} past week{reportsMeta.missing === 1 ? "" : "s"} from Square… they appear here as they finish.
            </span>
          </div>
        )}
        {reports.length === 0 && !reportsMeta?.backfilling && <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>The first report publishes when this week closes.</div>}
        {reports.map(r => (
          <div key={r.monday} style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.STONE}`,
            display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{r.monday} · {r.to}</span>
            <span style={bodyText({ fontSize: 11 })}>
              sold {r.totals.sold} of {r.totals.ordered} · efficiency {r.totals.efficiency}%
            </span>
            <span style={{ fontSize: 11, color: BX.RUST }}>waste {r.totals.waste}</span>
            <button onClick={() => openReport(r.monday)} style={{ ...btnGhost({ padding: "8px 14px", fontSize: 8 }), marginLeft: "auto" }}>View report</button>
          </div>
        ))}
      </div>

      {/* Standing order */}
      <div style={card({ marginBottom: 8 })}>
        {cardHead("Standing order",
          <button onClick={() => setModal({ type: "upload" })} style={btnPrimary({ padding: "9px 16px", fontSize: 9 })}>Upload new version</button>)}
        {Object.keys(activeOrders).length === 0 ? (
          <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>
            No version yet. Upload an xlsx or csv with a Product column and Monday to Sunday quantities.
            Pick a past effective date to backfill history: those weeks re-price and their reports fill in.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {(() => {
              const entries = Object.entries(activeOrders);
              const hasPrices = entries.some(([, d]) => d.unit_price != null);
              const weekQty = (d) => DAY_NAMES.reduce((a, day) => a + (d.daily?.[day] || 0), 0);
              const weekTotal = entries.reduce((a, [, d]) => a + (d.unit_price != null ? weekQty(d) * d.unit_price : 0), 0);
              const cols = ["ITEM", ...DAY_NAMES.map(d => d.slice(0, 3).toUpperCase()), ...(hasPrices ? ["UNIT", "WEEK"] : [])];
              return (
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BX.MONO }}>
                  <thead><tr>
                    {cols.map(h => (
                      <th key={h} style={{ textAlign: h === "ITEM" ? "left" : h === "UNIT" || h === "WEEK" ? "right" : "center", padding: "9px 12px",
                        fontWeight: 400, fontSize: 8, letterSpacing: "0.16em", color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.LINEN}` }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {entries.map(([item, data]) => (
                      <tr key={item} style={{ cursor: "pointer" }} onClick={() => setModal({ type: "item", item })}>
                        <td style={{ padding: "7px 12px", fontFamily: BX.SERIF, fontSize: 12, borderBottom: `1px solid ${BX.STONE}`, whiteSpace: "nowrap" }}>{item}</td>
                        {DAY_NAMES.map(d => (
                          <td key={d} style={{ padding: "7px 8px", textAlign: "center", fontSize: 11, borderBottom: `1px solid ${BX.STONE}` }}>
                            {data.daily?.[d] || 0}
                          </td>
                        ))}
                        {hasPrices && (
                          <>
                            <td style={{ padding: "7px 12px", textAlign: "right", fontSize: 10, color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.STONE}` }}>
                              {data.unit_price != null ? `$${data.unit_price.toFixed(2)}` : "·"}
                            </td>
                            <td style={{ padding: "7px 12px", textAlign: "right", fontSize: 11, fontWeight: 500, borderBottom: `1px solid ${BX.STONE}` }}>
                              {data.unit_price != null ? `$${(weekQty(data) * data.unit_price).toFixed(2)}` : "·"}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                    {hasPrices && (
                      <tr>
                        <td colSpan={8} style={{ padding: "9px 12px", fontSize: 8, letterSpacing: "0.16em", fontWeight: 400, color: BX.DRIFTWOOD }}>WEEK TOTAL</td>
                        <td></td>
                        <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, fontWeight: 500 }}>
                          ${weekTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              );
            })()}
          </div>
        )}
        {history?.length > 0 && (
          <div style={{ padding: "10px 16px", display: "flex", gap: 14, flexWrap: "wrap" }}>
            {history.slice(0, 4).map((v, i) => (
              <span key={v.effectiveDate} style={label({ fontSize: 8 })}>
                {i === 0 && v === currentVersion ? "CURRENT · " : ""}EFFECTIVE {v.effectiveDate}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Square item mapping */}
      {mapping && (
        <div style={card({ marginBottom: 8, borderColor: mapping.unmapped > 0 ? BX.AMBER : BX.LINEN })}>
          {cardHead("Square mapping",
            <button onClick={() => setModal({ type: "mapping" })} style={btnGhost({ padding: "8px 14px", fontSize: 8 })}>
              Open mapping
            </button>,
            mapping.unmapped > 0 ? BX.AMBER : BX.INK)}
          <div style={{ padding: "11px 16px", display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            {mapping.unmapped > 0
              ? <span style={bodyText({ fontSize: 12, color: BX.AMBER })}>
                  {mapping.unmapped} Square item{mapping.unmapped > 1 ? "s" : ""} not recognized. Sales on those are invisible until mapped.
                </span>
              : <span style={bodyText({ fontSize: 12, color: BX.DRIFTWOOD })}>
                  Every pastry and Grab n Go item in Square resolves to an app item.
                </span>}
            <span style={{ marginLeft: "auto", ...label({ fontSize: 8 }) }}>
              {mapping.rows.length} SQUARE ITEMS · {mapping.rows.filter(r => r.status === "mapped").length} MAPPED BY HAND · {mapping.rows.filter(r => r.status === "ignored").length} IGNORED
            </span>
          </div>
        </div>
      )}

      {/* Billing vs standing order */}
      <div style={card()}>
        {cardHead("Billing vs standing order · last 30 days", null, recon?.deliveries?.some(d => d.mismatches > 0) ? BX.AMBER : BX.INK)}
        {(!recon || recon.deliveries.length === 0) && (
          <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>No confirmed Oh La La invoices in the last 30 days.</div>
        )}
        {recon?.deliveries?.map(d => (
          <div key={d.id} style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.STONE}` }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={label({ color: BX.INK })}>{d.delivery_date}</span>
              <span style={bodyText({ fontSize: 11 })}>{d.vendor_name} · ${d.billed_total.toFixed(2)}</span>
              {d.mismatches > 0 ? <span style={tag(BX.AMBER)}>{d.mismatches} MISMATCH</span> : <span style={tag()}>MATCHES</span>}
              {d.unmatched > 0 && <span style={tag()}>{d.unmatched} NOT ON ORDER</span>}
            </div>
            {d.lines.filter(l => l.qty_expected != null && l.qty_expected !== l.qty_billed).map(l => (
              <div key={l.id} style={{ fontSize: 11, color: BX.AMBER, paddingTop: 4 }}>
                {l.item_name}: billed {l.qty_billed}, standing order says {l.qty_expected}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Pop-ups ── */}
      {modal?.type === "sellouts" && (
        <BxModal title="Sell-outs · this week" onClose={() => setModal(null)}>
          {top && (
            <div style={{ padding: "12px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
              <span style={bodyText({ fontSize: 11 })}>
                <span style={{ color: BX.AMBER }}>{top.item} sold out {top.soldOutCount} of {daysElapsed} days{topEarly ? `, ${topEarly} before 10a` : ""}.</span>
                {" "}Times are each day's last sale from Square.
              </span>
            </div>
          )}
          {bySellout.map(s => (
            <div key={s.item} style={{ padding: "12px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
              <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                <span style={{ fontFamily: BX.SERIF, fontSize: 14, cursor: "pointer" }}
                  onClick={() => setModal({ type: "item", item: s.item })}>{s.item}</span>
                <span style={{ fontSize: 11, fontWeight: 500 }}>{s.soldOutCount} of {daysElapsed} days</span>
                {selloutHits(s).filter(d => d.minsFromOpen < EARLY_MINS).length >= 2 && (
                  <span style={{ marginLeft: "auto" }}>{<span style={tag(BX.AMBER)}>RAISE ORDER?</span>}</span>
                )}
              </div>
              <div style={{ marginTop: 5, fontSize: 11, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {selloutHits(s).map(timeSpan)}
              </div>
            </div>
          ))}
        </BxModal>
      )}

      {modal?.type === "waste" && (
        <BxModal title="Waste · this week" onClose={() => setModal(null)}>
          {byWaste.map(s => (
            <div key={s.item} style={{ padding: "11px 22px", borderBottom: `1px solid ${BX.STONE}`,
              display: "flex", gap: 12, alignItems: "baseline", cursor: "pointer" }}
              onClick={() => setModal({ type: "item", item: s.item })}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 14 }}>{s.item}</span>
              <span style={bodyText({ fontSize: 11 })}>
                {s.dayResults.filter(d => completed(d) && d.waste > 0).map(d => `${d.dayName.slice(0, 3)} ${d.waste}`).join(" · ")}
              </span>
              <span style={{ marginLeft: "auto", color: BX.RUST, fontSize: 12 }}>
                {s.totalWaste} units{s.unitPrice ? ` · $${(s.totalWaste * s.unitPrice).toFixed(2)}` : ""}
              </span>
            </div>
          ))}
        </BxModal>
      )}

      {modal?.type === "day" && (() => {
        const i = modal.dayIndex;
        const date = addDaysStr(monday, i);
        const rows = weekData.map(s => ({ item: s.item, ...s.dayResults[i] }))
          .filter(r => r.ordered > 0 || r.sold > 0)
          .sort((a, b) => b.sold - a.sold);
        return (
          <BxModal title={`${DAY_NAMES[i]} · ${date}${date === today ? " · LIVE" : ""}`} onClose={() => setModal(null)} width={680}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BX.MONO }}>
              <thead><tr>
                {["ITEM", "ORD", "SOLD", "WASTE", "LAST SALE", ""].map(h => (
                  <th key={h} style={{ textAlign: h === "ITEM" ? "left" : "right", padding: "9px 14px", fontWeight: 400,
                    fontSize: 8, letterSpacing: "0.16em", color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.LINEN}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.item} style={{ cursor: "pointer" }} onClick={() => setModal({ type: "item", item: r.item })}>
                    <td style={{ padding: "8px 14px", fontFamily: BX.SERIF, fontSize: 13, borderBottom: `1px solid ${BX.STONE}` }}>{r.item}</td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontSize: 12, borderBottom: `1px solid ${BX.STONE}` }}>{r.ordered}</td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontSize: 12, borderBottom: `1px solid ${BX.STONE}` }}>{Math.round(r.sold)}</td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontSize: 12, color: r.waste > 0 && date < today ? BX.RUST : BX.DRIFTWOOD, borderBottom: `1px solid ${BX.STONE}` }}>
                      {date < today ? r.waste : "·"}
                    </td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontSize: 11, color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.STONE}` }}>{r.sellOutTime || "·"}</td>
                    <td style={{ padding: "8px 14px", textAlign: "right", borderBottom: `1px solid ${BX.STONE}` }}>
                      {r.oversold ? <span style={tag(BX.RUST)}>OVERSOLD</span>
                        : r.soldOut ? <span style={tag()}>SOLD OUT</span>
                        : date < today && r.ordered > 0 && r.waste > 0 ? <span style={tag(BX.RUST)}>{r.waste} LEFT</span>
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </BxModal>
        );
      })()}

      {modal?.type === "item" && (
        <ItemDeepDive item={modal.item} current={weekData.find(w => w.item === modal.item) || null}
          daysElapsed={daysElapsed} today={today} onClose={() => setModal(null)} />
      )}

      {modal?.type === "report" && (
        <BxModal title={report ? `Week of ${report.monday} · ${report.to} · published report` : "Report"} onClose={() => { setModal(null); setReport(null); }} width={760}>
          {!report ? <div style={bodyText({ padding: 20 })}>Loading…</div> : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, padding: 14 }}>
                {statTile("TOTAL SOLD", report.totals.sold, `OF ${report.totals.ordered} ORDERED`)}
                {statTile("EFFICIENCY", `${report.totals.efficiency}%`, "SELL-THROUGH")}
                {statTile("WASTE", report.totals.waste,
                  report.totals.waste_value ? `UNITS · $${report.totals.waste_value.toFixed(2)}` : "UNITS",
                  report.totals.waste > 0 ? BX.RUST : BX.INK)}
                {statTile("SOLD OUT", report.totals.sold_out_items, "ITEMS ≥1 DAY")}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BX.MONO }}>
                <thead><tr>
                  {["ITEM", "ORD", "SOLD", "WASTE", "EFF", "SO DAYS", "AVG SELL-OUT"].map(h => (
                    <th key={h} style={{ textAlign: h === "ITEM" ? "left" : "right", padding: "8px 14px", fontWeight: 400,
                      fontSize: 8, letterSpacing: "0.16em", color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.LINEN}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {report.items.map(r => (
                    <tr key={r.item}>
                      <td style={{ padding: "7px 14px", fontFamily: BX.SERIF, fontSize: 13, borderBottom: `1px solid ${BX.STONE}` }}>{r.item}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right", fontSize: 12, borderBottom: `1px solid ${BX.STONE}` }}>{r.ordered}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right", fontSize: 12, borderBottom: `1px solid ${BX.STONE}` }}>{r.sold}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right", fontSize: 12, color: r.waste > 0 ? BX.RUST : BX.DRIFTWOOD, borderBottom: `1px solid ${BX.STONE}` }}>{r.waste}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right", fontSize: 12, borderBottom: `1px solid ${BX.STONE}` }}>{r.efficiency != null ? `${r.efficiency}%` : "·"}</td>
                      <td style={{ padding: "7px 14px", textAlign: "right", fontSize: 12, color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.STONE}` }}>{r.sold_out_days} / 7</td>
                      <td style={{ padding: "7px 14px", textAlign: "right", fontSize: 12, color: r.avg_sellout_early ? BX.AMBER : BX.DRIFTWOOD, borderBottom: `1px solid ${BX.STONE}` }}>{r.avg_sellout || "·"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.early.length > 0 && (
                <div style={{ padding: "12px 14px 0" }}>
                  <div style={{ border: `1px solid ${BX.AMBER}` }}>
                    <div style={{ padding: "10px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
                      <span style={label({ color: BX.AMBER, letterSpacing: "0.2em" })}>Sold out before 10am · the raise-the-order signal</span>
                    </div>
                    {report.early.map(e => (
                      <div key={e.item} style={{ padding: "9px 16px", display: "flex", gap: 12, alignItems: "baseline" }}>
                        <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{e.item}</span>
                        <span style={bodyText({ fontSize: 11 })}>{e.times.join(" · ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ padding: "12px 14px 16px" }}>
                <div style={{ border: `1px solid ${BX.LINEN}` }}>
                  <div style={{ padding: "10px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
                    <span style={label({ color: BX.INK, letterSpacing: "0.2em" })}>Billing check · Oh La La</span>
                  </div>
                  <div style={{ padding: "9px 16px" }}>
                    <span style={bodyText({ fontSize: 11 })}>
                      {report.billing.invoices} invoices · ${report.billing.billed.toFixed(2)} billed
                      {report.billing.mismatches.length === 0 ? " · every line matched the standing order" : ""}
                    </span>
                    {report.billing.mismatches.map((m, i) => (
                      <div key={i} style={{ fontSize: 11, color: BX.AMBER, paddingTop: 4 }}>
                        {m.date}: {m.item} billed {m.billed}, standing order says {m.expected}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </BxModal>
      )}

      {modal?.type === "upload" && (
        <OrderUploadModal onSave={saveOrders} onClose={() => setModal(null)} />
      )}

      {modal?.type === "mapping" && mapping && (
        <BxModal title="Square mapping · pastry & Grab n Go" onClose={() => { setModal(null); load(); }} width={760}>
          {mapping.square_error && (
            <div style={{ padding: "12px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
              <span style={bodyText({ fontSize: 12, color: BX.RUST })}>Square catalog unavailable: {mapping.square_error}</span>
            </div>
          )}
          <div style={{ padding: "12px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
            <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>
              Every pastry and Grab n Go item Square sells, and the app item its sales count toward.
              Auto means the names already match; pick an item to override, or Ignore for things the tracker should skip.
              New Square items appear here on their own, no code changes needed.
            </span>
          </div>
          {mapping.rows.map(r => (
            <div key={r.key} style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.STONE}`,
              display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ minWidth: 240 }}>
                <div style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{r.label}</div>
                <div style={{ fontSize: 9, color: BX.DRIFTWOOD, marginTop: 2, letterSpacing: "0.08em" }}>{r.category.toUpperCase()}</div>
              </div>
              {r.status === "unmapped" && <span style={tag(BX.AMBER)}>NOT RECOGNIZED</span>}
              {r.status === "auto" && <span style={tag()}>AUTO</span>}
              {r.status === "mapped" && <span style={tag(BX.OLIVE)}>MAPPED</span>}
              {r.status === "ignored" && <span style={tag()}>IGNORED</span>}
              <select
                value={r.status === "ignored" ? "__ignore" : r.status === "auto" ? "__auto" : (r.app_item || "")}
                onChange={async (e) => {
                  const v = e.target.value;
                  const app_item = v === "__auto" ? "" : v === "__ignore" ? null : v;
                  try {
                    await api.post("/api/square-map", { square_label: r.label, app_item });
                    const m = await api.get("/api/square-map");
                    setMapping(m);
                  } catch (err) { setError(err.message); }
                }}
                style={{ marginLeft: "auto", fontFamily: BX.MONO, fontWeight: 400, fontSize: 12,
                  color: BX.INK, background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`, padding: "8px 10px" }}>
                <option value="__auto">{r.status === "auto" && r.app_item ? `Auto · ${r.app_item}` : "Auto · match by name"}</option>
                {(mapping.app_items || []).map(i => <option key={i} value={i}>{i}</option>)}
                <option value="__ignore">Ignore · not tracked</option>
              </select>
            </div>
          ))}
          {mapping.rows.length === 0 && !mapping.square_error && (
            <div style={bodyText({ padding: "14px 22px", fontSize: 12, color: BX.DRIFTWOOD })}>
              No pastry or Grab n Go categories found in the Square catalog.
            </div>
          )}
          <div style={{ padding: "12px 22px" }}>
            <span style={bodyText({ fontSize: 10, color: BX.DRIFTWOOD })}>
              Changes apply to the live week immediately and to rebuilt reports. Closing this refreshes the tracker.
            </span>
          </div>
        </BxModal>
      )}
    </div>
  );
}

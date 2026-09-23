import { useState, useEffect, useMemo } from "react";
import { api } from "../../lib/api.js";
import { BX, label, tag, bodyText, inputBx } from "../../lib/boxx.js";
import BxModal from "../../components/BxModal.jsx";

// Per-item deep dive over the published weekly reports: week-on-week trend
// with standing-order-change markers, waste-by-weekday heatmap, demand density
// from every sale's timestamp, and per-weekday order suggestions measured
// against Ben's ideal sell-out time. All arithmetic, no LLM.

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const OPEN_MIN = 420, CLOSE_MIN = 1140;   // 7:00a – 7:00p
const RANGES = [2, 3, 4];
const EARLY_GRACE = 30;                   // "before ideal" = 30+ min early

const fmtT = (m) => {
  if (m == null) return "—";
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}${mm ? ":" + String(mm).padStart(2, "0") : ""}${h >= 12 ? "p" : "a"}`;
};
const selloutMin = (d) => d.mins_from_open != null ? OPEN_MIN + d.mins_from_open : null;

export default function ItemDeepDive({ item, current, daysElapsed, today, onClose }) {
  const [hist, setHist] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState(4);
  const [ideal, setIdeal] = useState(1020);   // 5:00p default until fetch lands

  useEffect(() => {
    api.get(`/api/pastry/item-history?item=${encodeURIComponent(item)}`)
      .then(d => { setHist(d); if (d.ideal_sellout_min != null) setIdeal(d.ideal_sellout_min); })
      .catch(e => setError(e.message));
  }, [item]);

  const saveIdeal = async (min) => {
    setIdeal(min);
    try { await api.put("/api/pastry/item-settings", { item, ideal_sellout_min: min }); }
    catch (err) { setError(err.message); }
  };

  const ws = useMemo(() => hist ? hist.weeks.slice(-range) : [], [hist, range]);
  const price = hist?.unit_price ?? null;

  const calc = useMemo(() => {
    if (!ws.length) return null;
    const n = ws.length;
    let ordered = 0, sold = 0, waste = 0, sellouts = 0, early = 0;
    const soldDaily = [];
    for (const w of ws) for (const d of w.days) {
      ordered += d.ordered; sold += d.sold; waste += d.waste;
      if (d.ordered > 0) soldDaily.push(d.sold);
      const sm = selloutMin(d);
      if (sm != null) { sellouts++; if (sm < ideal - EARLY_GRACE) early++; }
    }
    const mean = soldDaily.length ? soldDaily.reduce((a, b) => a + b, 0) / soldDaily.length : 0;
    const sd = soldDaily.length ? Math.sqrt(soldDaily.reduce((a, b) => a + (b - mean) ** 2, 0) / soldDaily.length) : 0;
    const cv = mean ? sd / mean : 0;
    const soTimes = ws.flatMap(w => w.days.map(selloutMin).filter(m => m != null));
    const avgSellout = soTimes.length ? Math.round(soTimes.reduce((a, b) => a + b, 0) / soTimes.length) : null;

    // per-weekday rows (reports store days Mon..Sun in order)
    const byDay = DAYS.map((day, i) => {
      const rows = ws.map(w => w.days[i]).filter(Boolean);
      const cur = rows.length ? rows[rows.length - 1].ordered : 0;
      const avgSold = rows.length ? rows.reduce((a, r) => a + r.sold, 0) / rows.length : 0;
      const so = rows.filter(r => selloutMin(r) != null).length;
      const soEarly = rows.filter(r => { const m = selloutMin(r); return m != null && m < ideal - EARLY_GRACE; }).length;
      const avgWaste = rows.length ? rows.reduce((a, r) => a + r.waste, 0) / rows.length : 0;
      let suggest = cur;
      if (rows.length >= 2) {
        if (soEarly >= Math.ceil(rows.length * 0.4)) suggest = cur + 1;
        else if (avgWaste >= 1.5 && soEarly === 0) suggest = Math.max(1, Math.round(avgSold + 0.5));
      }
      return { day: day, i, cur, avgSold, so, soEarly, count: rows.length, avgWaste,
        suggest, delta: price != null ? (cur - suggest) * price : 0 };
    });
    const netSave = byDay.reduce((a, s) => a + s.delta, 0);

    // demand density: hourly bins summed per weekday over the range
    const hourly = DAYS.map((_, i) => {
      const bins = new Array(12).fill(0);
      for (const w of ws) {
        const d = w.days[i];
        if (d?.hourly) d.hourly.forEach((v, b) => { bins[b] += v; });
      }
      return bins;
    });
    const allBins = new Array(12).fill(0);
    hourly.forEach(bins => bins.forEach((v, b) => { allBins[b] += v; }));
    let best = 0, bestAt = 0;
    for (let b = 0; b <= 9; b++) {
      const s = allBins[b] + allBins[b + 1] + allBins[b + 2];
      if (s > best) { best = s; bestAt = b; }
    }
    const totalSales = allBins.reduce((a, b) => a + b, 0);
    return {
      n, ordered, sold, waste, sellouts, early, cv, avgSellout, byDay, netSave, hourly,
      peak: totalSales ? { from: OPEN_MIN + bestAt * 60, to: OPEN_MIN + (bestAt + 3) * 60,
        share: Math.round(best / totalSales * 100) } : null,
      eff: ordered ? Math.round(sold / ordered * 100) : null,
    };
  }, [ws, ideal, price]);

  const statTile = (l, big, sub, color = BX.INK) => (
    <div key={l} style={{ border: `1px solid ${BX.LINEN}`, padding: "11px 13px" }}>
      <div style={label({ fontSize: 7 })}>{l}</div>
      <div style={{ fontFamily: BX.SERIF, fontSize: 19, margin: "5px 0 2px", color }}>{big}</div>
      <div style={{ fontSize: 9, color: BX.DRIFTWOOD }}>{sub}</div>
    </div>
  );

  // ── Trend SVG ──────────────────────────────────────────────────────────────
  const trend = () => {
    const W = Math.max(520, ws.length * 110), H = 170, padL = 32, padR = 10, padT = 24, padB = 24;
    const wk = ws.map(w => ({
      monday: w.monday,
      ordered: w.days.reduce((a, d) => a + d.ordered, 0),
      sold: w.days.reduce((a, d) => a + d.sold, 0),
      waste: w.days.reduce((a, d) => a + d.waste, 0),
    }));
    const maxY = Math.max(1, ...wk.map(w => w.ordered)) * 1.15;
    const x = (i) => padL + (W - padL - padR) * (wk.length === 1 ? 0.5 : i / (wk.length - 1));
    const y = (v) => padT + (H - padT - padB) * (1 - v / maxY);
    const pts = (key) => wk.map((w, i) => `${x(i)},${y(w[key])}`).join(" ");
    const changes = (hist?.order_changes || [])
      .map(c => ({ ...c, idx: wk.findIndex(w => w.monday >= c.effective_date) }))
      .filter(c => c.idx >= 0);
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {[0, 0.5, 1].map(t => {
          const v = Math.round(maxY * t);
          return <g key={t}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={BX.STONE} />
            <text x={padL - 4} y={y(v) + 3} fontSize="8" fill={BX.DRIFTWOOD} textAnchor="end">{v}</text>
          </g>;
        })}
        {wk.map((w, i) => (
          <g key={w.monday}>
            <rect x={x(i) - 8} y={y(w.waste)} width={16} height={H - padB - y(w.waste)} fill={BX.AMBER} opacity="0.55" />
            <text x={x(i)} y={H - 8} fontSize="8" fill={BX.DRIFTWOOD} textAnchor="middle">{w.monday.slice(5).replace("-", "/")}</text>
          </g>
        ))}
        <polyline fill="none" stroke={BX.DRIFTWOOD} strokeWidth="1.5" strokeDasharray="4 3" points={pts("ordered")} />
        <polyline fill="none" stroke={BX.INK} strokeWidth="1.5" points={pts("sold")} />
        {changes.map((c, i) => (
          <g key={i}>
            <line x1={x(c.idx)} y1={padT - 4} x2={x(c.idx)} y2={H - padB} stroke={BX.OLIVE} strokeDasharray="3 3" />
            <text x={x(c.idx)} y={padT - 8} fontSize="8" fill={BX.OLIVE} textAnchor="middle" letterSpacing="1">
              ▲ ORDER {c.from}→{c.to}/WK
            </text>
          </g>
        ))}
        <g fontSize="8" fill={BX.GRAPHITE}>
          <text x={padL} y={11}>— SOLD</text>
          <text x={padL + 52} y={11} fill={BX.DRIFTWOOD}>- - ORDERED</text>
          <text x={padL + 130} y={11} fill={BX.AMBER}>▮ WASTE</text>
        </g>
      </svg>
    );
  };

  // ── Demand density SVG ─────────────────────────────────────────────────────
  const density = () => {
    const W = 440, rowH = 28, padL = 40, padR = 12, padT = 16;
    const H = padT + rowH * 7 + 20;
    const x = (m) => padL + (W - padL - padR) * (m - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN);
    const binW = (W - padL - padR) / 12;
    const maxBin = Math.max(1, ...calc.hourly.flat());
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }}>
        {DAYS.map((day, i) => {
          const yTop = padT + rowH * i + 4, bandH = rowH - 9, yy = yTop + bandH / 2;
          return (
            <g key={day}>
              {calc.hourly[i].map((v, b) => v > 0 && (
                <rect key={b} x={padL + b * binW} y={yTop} width={binW} height={bandH}
                  fill={BX.OLIVE} opacity={(0.06 + (v / maxBin) * 0.42).toFixed(2)} />
              ))}
              <text x={padL - 5} y={yy + 3} fontSize="9" fill={BX.GRAPHITE} textAnchor="end">{day.toUpperCase()}</text>
              {ws.map(w => {
                const m = w.days[i] ? selloutMin(w.days[i]) : null;
                return m != null && (
                  <circle key={w.monday} cx={x(m)} cy={yy} r="3.3"
                    fill={m < ideal - EARLY_GRACE ? BX.AMBER : BX.INK} opacity="0.85" />
                );
              })}
            </g>
          );
        })}
        <line x1={x(ideal)} y1={padT - 4} x2={x(ideal)} y2={H - 16} stroke={BX.INK} strokeWidth="1.4" strokeDasharray="4 3" />
        <text x={x(ideal)} y={padT - 6} fontSize="8" fill={BX.INK} textAnchor="middle" letterSpacing="1">
          IDEAL {fmtT(ideal).toUpperCase()}
        </text>
        {[480, 660, 840, 1020].map(m => (
          <text key={m} x={x(m)} y={H - 4} fontSize="8" fill={BX.DRIFTWOOD} textAnchor="middle">{fmtT(m)}</text>
        ))}
      </svg>
    );
  };

  const th = { ...label({ fontSize: 8 }), padding: "8px 12px", borderBottom: `1px solid ${BX.LINEN}`, textAlign: "right" };
  const cell = { padding: "7px 12px", borderBottom: `1px solid ${BX.STONE}`, fontSize: 11, textAlign: "right" };
  const maxHeat = calc ? Math.max(1, ...ws.flatMap(w => w.days.map(d => d.waste))) : 1;
  const heatBg = (v) => {
    if (v === 0) return "transparent";
    const a = v / maxHeat;
    return a < 0.5 ? `rgba(138,90,31,${0.15 + a * 0.7})` : `rgba(142,59,44,${0.25 + (a - 0.5) * 0.9})`;
  };

  return (
    <BxModal title={`${item.toUpperCase()} · DEEP DIVE`} onClose={onClose} width={880}>
      <div style={{ padding: "12px 20px 18px", fontFamily: BX.MONO, fontWeight: 400, color: BX.INK }}>
        {error && <div style={{ color: BX.RUST, fontSize: 12, marginBottom: 10 }}>{error}</div>}

        {/* Controls */}
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={label({ fontSize: 8 })}>RANGE</span>
            <span style={{ display: "flex" }}>
              {RANGES.map(r => (
                <button key={r} onClick={() => setRange(r)}
                  style={{ fontFamily: BX.MONO, fontSize: 9, letterSpacing: "0.14em", padding: "6px 12px",
                    cursor: "pointer", border: `1px solid ${range === r ? BX.INK : BX.LINEN}`, borderRight: r === 4 ? undefined : "none",
                    background: range === r ? BX.INK : "transparent", color: range === r ? BX.PARCHMENT : BX.DRIFTWOOD }}>
                  {r}W
                </button>
              ))}
            </span>
          </span>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={label({ fontSize: 8 })}>IDEAL SELL-OUT</span>
            <select value={ideal} onChange={e => saveIdeal(Number(e.target.value))}
              style={inputBx({ fontSize: 12, padding: "6px 8px" })}>
              {[900, 930, 960, 990, 1020, 1050, 1080, 1110].map(m => (
                <option key={m} value={m}>{fmtT(m)}</option>
              ))}
            </select>
          </span>
          <span style={{ fontSize: 10, color: BX.DRIFTWOOD, flex: "1 1 240px", minWidth: 200 }}>
            Selling out before the ideal counts as lost sales; never reaching it shows as waste. Saved per item.
          </span>
        </div>

        {/* This week, live */}
        {current && (
          <div style={{ border: `1px solid ${BX.LINEN}`, padding: "9px 14px", marginBottom: 10,
            display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={label({ fontSize: 8, color: BX.OLIVE })}>THIS WEEK SO FAR</span>
            <span style={{ fontSize: 11 }}>{Math.round(current.sold)} sold of {current.ordered} ordered</span>
            <span style={{ fontSize: 11, color: current.waste > 0 ? BX.AMBER : BX.GRAPHITE }}>{current.waste} waste</span>
            <span style={{ fontSize: 11, color: BX.DRIFTWOOD }}>sold out {current.soldOutCount} of {daysElapsed} days</span>
          </div>
        )}

        {!hist && !error && <div style={bodyText({ padding: 16, color: BX.DRIFTWOOD })}>Loading history…</div>}
        {hist && !calc && (
          <div style={bodyText({ padding: 16, color: BX.DRIFTWOOD })}>
            No completed weeks with this item in the published reports yet. History fills in as weeks close
            (and rebuilds automatically after this update).
          </div>
        )}

        {calc && <>
          {/* Tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap: 8, marginBottom: 10 }}>
            {statTile("AVG WEEKLY WASTE",
              `${(calc.waste / calc.n).toFixed(1)}${price != null ? ` · $${(calc.waste / calc.n * price).toFixed(0)}` : ""}`,
              "units · dollars / week", calc.waste / calc.n >= 3 ? BX.AMBER : BX.INK)}
            {statTile("EFFICIENCY", calc.eff != null ? `${calc.eff}%` : "—", `${calc.sold} sold of ${calc.ordered}`)}
            {statTile("SOLD OUT", `${calc.sellouts}`, `days in ${calc.n} week${calc.n === 1 ? "" : "s"}`)}
            {statTile("BEFORE IDEAL", `${calc.early}`, `sell-outs before ${fmtT(ideal)}`, calc.early > 0 ? BX.AMBER : BX.INK)}
            {statTile("AVG SELL-OUT", fmtT(calc.avgSellout), calc.avgSellout ? (calc.avgSellout < ideal ? "earlier than ideal" : "at or past ideal") : "rarely sells out")}
            {statTile("DEMAND", calc.cv < 0.25 ? "STEADY" : calc.cv < 0.45 ? "MODERATE" : "VOLATILE",
              `day-to-day swing ±${Math.round(calc.cv * 100)}%`, calc.cv >= 0.45 ? BX.AMBER : BX.INK)}
          </div>

          {/* Trend */}
          <div style={{ border: `1px solid ${BX.LINEN}`, marginBottom: 10 }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Week on week</span>
              <span style={label({ fontSize: 7 })}>▲ = STANDING ORDER CHANGED</span>
            </div>
            <div style={{ overflowX: "auto", padding: "8px 6px 2px" }}>{trend()}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 8, marginBottom: 10 }}>
            {/* Heatmap */}
            <div style={{ border: `1px solid ${BX.LINEN}` }}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${BX.LINEN}` }}>
                <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Waste by weekday</span>
              </div>
              <div style={{ overflowX: "auto", padding: "10px 12px" }}>
                <table style={{ borderCollapse: "collapse", minWidth: 290 }}>
                  <thead><tr>
                    <th style={{ ...th, textAlign: "left", paddingLeft: 0 }}>WEEK</th>
                    {DAYS.map(d => <th key={d} style={{ ...th, textAlign: "center", padding: "8px 2px" }}>{d.toUpperCase()}</th>)}
                  </tr></thead>
                  <tbody>
                    {ws.map(w => (
                      <tr key={w.monday}>
                        <td style={{ ...cell, textAlign: "left", paddingLeft: 0, color: BX.DRIFTWOOD, fontSize: 10 }}>{w.monday.slice(5).replace("-", "/")}</td>
                        {DAYS.map((_, i) => {
                          const d = w.days[i];
                          if (!d) return <td key={i} style={{ ...cell, textAlign: "center" }}>·</td>;
                          const so = selloutMin(d) != null;
                          return (
                            <td key={i} style={{ ...cell, textAlign: "center", padding: "4px 2px" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 27, height: 21, fontSize: 10, background: heatBg(d.waste),
                                color: d.waste / maxHeat > 0.55 ? BX.PARCHMENT : BX.INK,
                                outline: so ? `1.5px solid ${BX.OLIVE}` : "none", outlineOffset: -1.5,
                                borderRadius: so ? "50%" : 0 }}>
                                {d.waste || "·"}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "0 14px 10px", fontSize: 10, color: BX.DRIFTWOOD }}>Darker = more wasted · ○ = sold out</div>
            </div>

            {/* Demand density */}
            <div style={{ border: `1px solid ${BX.LINEN}` }}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${BX.LINEN}` }}>
                <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Demand through the day</span>
              </div>
              <div style={{ padding: "10px 8px 2px" }}>{density()}</div>
              <div style={{ padding: "0 14px 10px", fontSize: 10, color: BX.DRIFTWOOD }}>
                Shading = every sale, from Square timestamps · dot = sold out (amber = before ideal)
                {calc.peak && <> · peak {fmtT(calc.peak.from)}–{fmtT(calc.peak.to)}, {calc.peak.share}% of sales</>}
              </div>
            </div>
          </div>

          {/* Suggestions */}
          <div style={{ border: `1px solid ${BX.LINEN}` }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Order suggestions · per weekday</span>
              <span style={label({ fontSize: 7 })}>ARITHMETIC FROM THE RANGE ABOVE · BEN DECIDES</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: "left" }}>DAY</th><th style={th}>ORDER</th><th style={th}>AVG SOLD</th>
                  <th style={th}>SOLD OUT</th><th style={th}>BEFORE {fmtT(ideal).toUpperCase()}</th>
                  <th style={th}>SUGGEST</th><th style={th}>Δ / WK</th>
                </tr></thead>
                <tbody>
                  {calc.byDay.map(s => {
                    const changed = s.suggest !== s.cur;
                    return (
                      <tr key={s.day}>
                        <td style={{ ...cell, textAlign: "left", fontFamily: BX.SERIF, fontSize: 12 }}>{s.day}</td>
                        <td style={cell}>{s.cur}</td>
                        <td style={cell}>{s.avgSold.toFixed(1)}</td>
                        <td style={cell}>{s.so} of {s.count}</td>
                        <td style={{ ...cell, color: s.soEarly ? BX.AMBER : BX.GRAPHITE }}>{s.soEarly || "·"}</td>
                        <td style={{ ...cell, fontWeight: 500, color: changed ? (s.suggest < s.cur ? BX.OLIVE : BX.AMBER) : BX.DRIFTWOOD }}>
                          {changed ? `${s.suggest} ${s.suggest < s.cur ? "▼" : "▲"}` : "keep"}
                        </td>
                        <td style={{ ...cell, color: s.delta > 0 ? BX.OLIVE : s.delta < 0 ? BX.AMBER : BX.DRIFTWOOD }}>
                          {s.delta ? `${s.delta > 0 ? "−$" : "+$"}${Math.abs(s.delta).toFixed(2)}` : "·"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 14px 12px", fontSize: 10, color: BX.DRIFTWOOD, lineHeight: 1.6 }}>
              Rule, in the open: cut toward average sold when a weekday keeps wasting and never sells out before the
              ideal; add one when it sells out early on 40%+ of days.
              {price != null && <> Net if all applied: <b style={{ fontWeight: 500, color: calc.netSave >= 0 ? BX.OLIVE : BX.AMBER }}>
                {calc.netSave >= 0 ? "−$" : "+$"}{Math.abs(calc.netSave).toFixed(2)}/week</b>.</>}
              {" "}Apply changes by uploading a new standing order — it lands as a ▲ marker above.
            </div>
          </div>
        </>}
      </div>
    </BxModal>
  );
}

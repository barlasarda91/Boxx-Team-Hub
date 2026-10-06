import { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import { BX, label, tag, bodyText } from "../lib/boxx.js";
import BxModal from "./BxModal.jsx";

// Every member's own window into the living schedule: published versions with
// approved swaps laid over them — the same view the variance checker sees.
// Opening it acknowledges any pending schedule push (server-side).
export default function MyScheduleModal({ meName, onClose, defaultView = "me" }) {
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState(defaultView);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(`/api/my-schedule?offset=${offset}`).then(setData).catch(e => setError(e.message));
  }, [offset]);

  const weekLabel = offset === 0 ? "THIS WEEK" : offset === 1 ? "NEXT WEEK" : `IN ${offset} WEEKS`;
  const pagerBtn = {
    fontFamily: BX.MONO, fontSize: 12, padding: "5px 11px", background: "transparent",
    border: `1px solid ${BX.LINEN}`, color: BX.GRAPHITE, cursor: "pointer",
  };
  const toggleBtn = (on, extra = {}) => ({
    fontFamily: BX.MONO, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase",
    padding: "7px 12px", cursor: "pointer",
    border: `1px solid ${on ? BX.INK : BX.LINEN}`,
    background: on ? BX.INK : "transparent", color: on ? BX.PARCHMENT : BX.DRIFTWOOD, ...extra,
  });
  const fmtDay = (d) => `${d.day.slice(0, 3).toUpperCase()} ${d.date.slice(5).replace("-", "/")}`;

  const meRow = (d) => {
    const off = !d.me.code || d.me.code === "OFF";
    return (
      <div key={d.date} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "10px 20px",
        borderBottom: `1px solid ${BX.STONE}`, background: d.is_today ? "rgba(107,110,74,0.08)" : "transparent" }}>
        <span style={{ fontSize: 10, letterSpacing: "0.1em", color: BX.DRIFTWOOD, width: 84, flexShrink: 0 }}>{fmtDay(d)}</span>
        <span style={{ fontSize: 11, width: 78, flexShrink: 0, color: off ? BX.LINEN : BX.INK }}>{d.me.code || "OFF"}</span>
        <span style={{ fontSize: 12, color: off ? BX.LINEN : BX.INK }}>{d.me.label || "·"}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {d.me.swapped && <span style={tag(BX.AMBER)}>SWAPPED</span>}
          {d.is_today && <span style={tag(BX.OLIVE)}>TODAY</span>}
        </span>
      </div>
    );
  };

  // Whole team as the planner grid: rows = people, columns = days, today lit.
  const CHIP = {
    OPEN:     { background: BX.INK, color: BX.PARCHMENT, border: `1px solid ${BX.INK}` },
    MID:      { background: BX.OLIVE, color: BX.PARCHMENT, border: `1px solid ${BX.OLIVE}` },
    CLOSE:    { background: "transparent", color: BX.INK, border: `1px solid ${BX.LINEN}` },
    ROASTERY: { background: "transparent", color: BX.OLIVE, border: `1px solid ${BX.OLIVE}` },
    STACKED:  { background: BX.AMBER, color: BX.PARCHMENT, border: `1px solid ${BX.AMBER}` },
  };
  const shortT = (label) => label ? label.replace(/:00/g, "").replace(/ – /, "–") : "";
  const teamGrid = () => {
    const names = [...new Set(data.days.flatMap(d => d.team.map(r => r.name)))].sort();
    const todayBg = "rgba(107,110,74,0.09)";
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BX.MONO, minWidth: 640 }}>
          <thead><tr>
            <th style={{ padding: "9px 12px", borderBottom: `1px solid ${BX.LINEN}` }}></th>
            {data.days.map(d => (
              <th key={d.date} style={{ textAlign: "center", padding: "8px 4px", fontWeight: 400,
                fontSize: 8, letterSpacing: "0.14em", color: d.is_today ? BX.OLIVE : BX.DRIFTWOOD,
                borderBottom: `1px solid ${d.is_today ? BX.OLIVE : BX.LINEN}`,
                background: d.is_today ? todayBg : "transparent" }}>
                {d.day.slice(0, 3).toUpperCase()}<br />{d.date.slice(5).replace("-", "/")}
                {d.is_today && <><br /><span style={{ color: BX.OLIVE }}>TODAY</span></>}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {names.map(name => (
              <tr key={name}>
                <td style={{ padding: "8px 12px", fontFamily: BX.SERIF, fontSize: 13,
                  fontWeight: name === meName ? 700 : 400, borderBottom: `1px solid ${BX.STONE}`,
                  whiteSpace: "nowrap" }}>{name}</td>
                {data.days.map(d => {
                  const r = d.team.find(x => x.name === name);
                  const off = !r || !r.code || r.code === "OFF";
                  const chip = off ? null : (CHIP[r.code] || CHIP.CLOSE);
                  return (
                    <td key={d.date} style={{ padding: "6px 3px", textAlign: "center",
                      borderBottom: `1px solid ${BX.STONE}`, background: d.is_today ? todayBg : "transparent" }}>
                      {off ? (
                        <span style={{ fontSize: 9, color: BX.LINEN }}>OFF</span>
                      ) : (
                        <span title={r.swapped ? "Changed by an approved swap" : undefined}
                          style={{ display: "inline-block", padding: "4px 7px", fontSize: 8,
                            letterSpacing: "0.1em", whiteSpace: "nowrap", ...chip,
                            boxShadow: r.swapped ? `0 0 0 2px ${BX.AMBER}` : "none" }}>
                          {r.code}{r.label ? ` ${shortT(r.label)}` : ""}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "8px 12px 10px", display: "flex", gap: 14, flexWrap: "wrap" }}>
          {["OPEN", "MID", "CLOSE", "ROASTERY"].map(c => (
            <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 11, height: 11, display: "inline-block", ...CHIP[c] }} />
              <span style={label({ fontSize: 7 })}>{c}</span>
            </span>
          ))}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 11, height: 11, display: "inline-block", background: "transparent",
              border: `1px solid ${BX.LINEN}`, boxShadow: `0 0 0 2px ${BX.AMBER}` }} />
            <span style={label({ fontSize: 7 })}>SWAPPED</span>
          </span>
        </div>
      </div>
    );
  };

  return (
    <BxModal title="MY SCHEDULE" onClose={onClose} width={view === "team" ? 940 : 560}>
      <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK }}>
        <div style={{ padding: "10px 20px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex",
          gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center" }}>
            <button onClick={() => setOffset(o => Math.max(0, o - 1))} style={{ ...pagerBtn, opacity: offset === 0 ? 0.4 : 1 }}>‹</button>
            <span style={{ ...label({ fontSize: 9 }), color: BX.INK, padding: "0 12px", minWidth: 86, textAlign: "center" }}>{weekLabel}</span>
            <button onClick={() => setOffset(o => Math.min(3, o + 1))} style={{ ...pagerBtn, opacity: offset === 3 ? 0.4 : 1 }}>›</button>
          </span>
          <span style={{ display: "flex" }}>
            <button onClick={() => setView("me")} style={toggleBtn(view === "me", { borderRight: "none" })}>Just me</button>
            <button onClick={() => setView("team")} style={toggleBtn(view === "team")}>Whole team</button>
          </span>
          <span style={{ fontSize: 9, color: BX.DRIFTWOOD }}>swaps already applied</span>
        </div>

        {error && <div style={bodyText({ color: BX.RUST, padding: "14px 20px" })}>{error}</div>}
        {!data && !error && <div style={bodyText({ padding: "14px 20px", color: BX.DRIFTWOOD })}>Loading…</div>}

        {data && view === "me" && !data.on_grid && (
          <div style={bodyText({ padding: "16px 20px", fontSize: 12, color: BX.DRIFTWOOD })}>
            No standing shifts this week — you're scheduled per event. The whole-team view still shows who's on.
          </div>
        )}
        {data && view === "me" && data.on_grid && data.days.map(meRow)}
        {data && view === "team" && teamGrid()}
      </div>
    </BxModal>
  );
}

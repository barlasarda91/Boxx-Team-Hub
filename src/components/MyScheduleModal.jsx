import { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import { BX, label, tag, bodyText } from "../lib/boxx.js";
import BxModal from "./BxModal.jsx";

// Every member's own window into the living schedule: published versions with
// approved swaps laid over them — the same view the variance checker sees.
// Opening it acknowledges any pending schedule push (server-side).
export default function MyScheduleModal({ meName, onClose }) {
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState("me");
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

  const teamDay = (d) => (
    <div key={d.date} style={{ padding: "10px 20px", borderBottom: `1px solid ${BX.STONE}`,
      background: d.is_today ? "rgba(107,110,74,0.08)" : "transparent" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.1em", color: BX.DRIFTWOOD }}>{fmtDay(d)}</span>
        {d.is_today && <span style={tag(BX.OLIVE)}>TODAY</span>}
      </div>
      {d.team.filter(r => r.code && r.code !== "OFF").map(r => (
        <div key={r.name} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0" }}>
          <span style={{ fontFamily: BX.SERIF, fontSize: 12, width: 84, flexShrink: 0,
            fontWeight: r.name === meName ? 700 : 400 }}>{r.name}</span>
          <span style={{ fontSize: 11, color: BX.GRAPHITE }}>
            {r.code}{r.label ? ` · ${r.label}` : ""}
          </span>
          {r.swapped && <span style={tag(BX.AMBER, { flexShrink: 0 })}>SWAPPED</span>}
        </div>
      ))}
      {d.team.every(r => !r.code || r.code === "OFF") && (
        <div style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>Nobody scheduled.</div>
      )}
    </div>
  );

  return (
    <BxModal title="MY SCHEDULE" onClose={onClose} width={560}>
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
        {data && view === "team" && data.days.map(teamDay)}
      </div>
    </BxModal>
  );
}

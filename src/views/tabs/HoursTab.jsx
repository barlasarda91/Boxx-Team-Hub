import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api.js";
import { BX, label, tag, card, bodyText, btnGhost } from "../../lib/boxx.js";
import BxModal from "../../components/BxModal.jsx";

const VAR_META = {
  late_in:     ["LATE IN", BX.AMBER],
  early_in:    ["EARLY IN", BX.DRIFTWOOD],
  early_out:   ["EARLY OUT", BX.AMBER],
  late_out:    ["LATE OUT", BX.AMBER],
  no_show:     ["NO SHOW", BX.RUST],
  unscheduled: ["UNSCHEDULED", BX.DRIFTWOOD],
};
const hrs = (m) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;

const statTile = (l, v, sub, color = BX.INK) => (
  <div key={l} style={card({ padding: "13px 15px" })}>
    <div style={label({ fontSize: 8, marginBottom: 7 })}>{l}</div>
    <div style={{ fontFamily: BX.SERIF, fontSize: 24, color }}>{v}</div>
    <div style={label({ fontSize: 7, marginTop: 5 })}>{sub}</div>
  </div>
);

// Hours: the whole team's week from Square timecards, checked against the
// standing schedule. Anything more than 5 minutes off is a variance.
export default function HoursTab({ isMobile }) {
  const [week, setWeek] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null); // member name → day pop-up

  const load = useCallback(() => {
    api.get("/api/labor/week").then(setWeek).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return (
    <div style={card({ padding: "18px" })}>
      <span style={bodyText({ fontSize: 12, color: BX.RUST })}>{error}</span>
      <div style={{ marginTop: 8 }}>
        <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>
          Timecards come from Square. If this persists, check the Square API key and Team permissions.
        </span>
      </div>
    </div>
  );
  if (!week) return <div style={bodyText({ padding: 20 })}>Pulling timecards from Square…</div>;

  const totalMin = week.members.reduce((a, m) => a + m.week_minutes, 0);
  const totalVar = week.members.reduce((a, m) => a + m.variances.length, 0);
  const dailyOt = week.members.reduce((a, m) => a + m.daily_ot_min, 0);
  const weeklyOt = week.members.reduce((a, m) => a + m.weekly_ot_min, 0);
  const openMember = week.members.find(m => m.name === open);

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 980 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: BX.SERIF, fontSize: 17 }}>
          This week · {week.monday.slice(5).replace("-", "/")} to {week.to.slice(5).replace("-", "/")}
        </span>
        <span style={tag(BX.OLIVE)}>LIVE · SQUARE TIMECARDS</span>
        <span style={label({ fontSize: 8 })}>CA RULES · OVER 8H/DAY OR 40H/WEEK · NOBODY EXEMPT · {week.grace_min} MIN GRACE</span>
      </div>

      {!week.has_schedule && (
        <div style={card({ padding: "12px 16px", marginBottom: 8, borderColor: BX.AMBER })}>
          <span style={bodyText({ fontSize: 12, color: BX.AMBER })}>
            No standing schedule found for this week, so variances cannot be checked — hours and overtime still track.
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
        {statTile("TEAM HOURS", hrs(totalMin), "SO FAR THIS WEEK")}
        {statTile("VARIANCES", totalVar, `OVER ${week.grace_min} MINUTES`, totalVar > 0 ? BX.AMBER : BX.INK)}
        {statTile("DAILY OT", hrs(dailyOt), "OVER 8H IN A DAY", dailyOt > 0 ? BX.AMBER : BX.INK)}
        {statTile("WEEKLY OT", hrs(weeklyOt), "OVER 40H · ESTIMATE", weeklyOt > 0 ? BX.AMBER : BX.INK)}
      </div>

      <div style={card()}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Team · tap a name for the day-by-day</span>
        </div>
        {week.members.map(m => (
          <div key={m.name} onClick={() => setOpen(m.name)}
            style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer",
              display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 14, minWidth: 90 }}>{m.name}</span>
            <span style={{ fontSize: 12 }}>{hrs(m.week_minutes)}</span>
            {m.daily_ot_min + m.weekly_ot_min > 0 && (
              <span style={tag(BX.AMBER)}>{hrs(m.daily_ot_min + m.weekly_ot_min)} OT</span>
            )}
            <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {m.variances.length > 0
                ? <span style={tag(m.variances.some(v => v.kind === "no_show") ? BX.RUST : BX.AMBER)}>
                    {m.variances.length} VARIANCE{m.variances.length > 1 ? "S" : ""}
                  </span>
                : <span style={tag()}>ON SCHEDULE</span>}
            </span>
          </div>
        ))}
        {week.members.length === 0 && (
          <div style={bodyText({ padding: "14px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>No timecards yet this week.</div>
        )}
      </div>

      {openMember && (
        <BxModal title={`${openMember.name} · week of ${week.monday}`} onClose={() => setOpen(null)} width={700}>
          {openMember.days.map(d => (
            <div key={d.date} style={{ padding: "11px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
              <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={label({ color: BX.INK, fontSize: 9 })}>{d.day.slice(0, 3).toUpperCase()} {d.date.slice(5)}</span>
                <span style={tag(d.shift_code === "OFF" ? BX.DRIFTWOOD : BX.DRIFTWOOD)}>{d.shift_code}</span>
                {d.scheduled && <span style={bodyText({ fontSize: 11 })}>scheduled {d.scheduled}</span>}
                {d.clocked
                  ? <span style={bodyText({ fontSize: 11, color: BX.INK })}>clocked {d.clocked}</span>
                  : d.shift_code !== "OFF" && d.shift_code !== "ROASTERY" && !d.live
                    ? <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>no timecard</span> : null}
                {d.live && <span style={tag(BX.OLIVE)}>LIVE</span>}
                <span style={{ marginLeft: "auto", fontSize: 12 }}>{d.minutes > 0 ? hrs(d.minutes) : "·"}</span>
              </div>
              {(d.variances.length > 0 || d.day_ot_min > 0) && (
                <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {d.variances.map((v, i) => {
                    const [lbl2, color] = VAR_META[v.kind] || [v.kind, BX.DRIFTWOOD];
                    return <span key={i} style={tag(color)}>{lbl2}{v.diff_min ? ` · ${v.diff_min}M` : ""}</span>;
                  })}
                  {d.day_ot_min > 0 && <span style={tag(BX.AMBER)}>{hrs(d.day_ot_min)} DAILY OT</span>}
                </div>
              )}
            </div>
          ))}
          <div style={{ padding: "12px 22px" }}>
            <span style={label({ fontSize: 8 })}>
              WEEK {hrs(openMember.week_minutes)} · DAILY OT {hrs(openMember.daily_ot_min)} · WEEKLY OT {hrs(openMember.weekly_ot_min)} (ESTIMATE)
            </span>
          </div>
        </BxModal>
      )}

      <div style={{ marginTop: 10 }}>
        <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>
          Every Monday the week's variances over {week.grace_min} minutes are submitted to the owner's decision queue automatically.
        </span>
      </div>
    </div>
  );
}

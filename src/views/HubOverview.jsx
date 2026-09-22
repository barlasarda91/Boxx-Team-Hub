import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { BX, label, eyebrow, tag, card, serifH, bodyText, btnPrimary, btnGhost, statusColor, statusLabel, fmtAgo } from "../lib/boxx.js";

// Owner dashboard: seven tiles, the decision queue, this week, latest check-ins.
export default function HubOverview({ onOpenDomain, isMobile, T }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [resolving, setResolving] = useState(null);   // decision being resolved: {id, state}
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(() => {
    api.get("/api/hub/overview").then(setData).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const resolve = async (id, state) => {
    try {
      await api.post(`/api/decisions/${id}/resolve`, { state, owner_note: noteDraft || null });
      setResolving(null); setNoteDraft("");
      load();
    } catch (err) { setError(err.message); }
  };

  const fmtDay = (d) => {
    const names = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
    return names[new Date(`${d}T12:00:00Z`).getUTCDay()] + " " + d.slice(5).replace("-", "/");
  };

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK }}>

      {/* Week in review — the digest ribbon, expanded. Member tiles live on
          the Team tab; this is the numbers view. */}
      {data.digest && (() => {
        const d = data.digest;
        const p = d.pastry;
        const statTile = (lbl2, big, sub, color = BX.INK) => (
          <div key={lbl2} style={card({ padding: "13px 15px" })}>
            <div style={label({ fontSize: 7 })}>{lbl2}</div>
            <div style={{ fontFamily: BX.SERIF, fontSize: 21, margin: "6px 0 2px", color }}>{big}</div>
            <div style={{ fontSize: 9, color: BX.DRIFTWOOD }}>{sub}</div>
          </div>
        );
        return (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
              <span style={label({ color: BX.OLIVE, letterSpacing: "0.2em" })}>Week of {d.week}</span>
              <span style={{ marginLeft: "auto", ...label({ fontSize: 8 }) }}>WEEK IN REVIEW · AUTOMATIC</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(6, minmax(0, 1fr))", gap: 8 }}>
              {statTile("PASTRY EFFICIENCY", p?.efficiency != null ? `${p.efficiency}%` : "—",
                p ? `${p.sold} sold of ${p.ordered} ordered` : "no report yet")}
              {statTile("PASTRY WASTE", p ? p.waste : "—",
                p?.waste_value ? `units · $${p.waste_value.toFixed(0)}` : "units",
                p && p.waste > 0 ? BX.AMBER : BX.INK)}
              {statTile("TIMECARD VARIANCES", d.variances,
                d.no_shows > 0 ? `${d.no_shows} no-show${d.no_shows === 1 ? "" : "s"}` : "over 5 minutes",
                d.variances > 0 ? BX.AMBER : BX.INK)}
              {statTile("OVERDUE", d.overdue_commitments, "commitments",
                d.overdue_commitments > 0 ? BX.RUST : BX.INK)}
              {statTile("EVENTS", `${d.events_this_month} of 2`, "this month",
                d.events_this_month < 1 ? BX.AMBER : BX.INK)}
              {statTile("CHECK-INS", `${d.checked_in_week ?? "—"} of 7`, "last 7 days",
                (d.checked_in_week ?? 7) < 7 ? BX.AMBER : BX.INK)}
            </div>
            {(d.top_waste?.length > 0 || d.variances_by_member?.length > 0) && (
              <div style={card({ padding: "11px 15px", marginTop: 8, display: "flex", gap: 20, flexWrap: "wrap" })}>
                {d.top_waste?.length > 0 && (
                  <span style={bodyText({ fontSize: 11 })}>
                    <span style={label({ fontSize: 8, marginRight: 8 })}>MOST WASTE</span>
                    {d.top_waste.map(w => `${w.item} ${w.waste}${w.waste_value ? ` ($${w.waste_value.toFixed(0)})` : ""}`).join(" · ")}
                  </span>
                )}
                {d.variances_by_member?.length > 0 && (
                  <span style={bodyText({ fontSize: 11 })}>
                    <span style={label({ fontSize: 8, marginRight: 8 })}>VARIANCES</span>
                    {d.variances_by_member.map(v => `${v.name} ${v.n}`).join(" · ")}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 8, alignItems: "stretch" }}>

        {/* Decision queue */}
        <div style={card({ flexGrow: 1.4, flexBasis: 0, minWidth: 0 })}>
          <div style={{ padding: "13px 20px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between" }}>
            <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Decision Queue · {data.queue.length} open</span>
            <span style={label({ fontSize: 8 })}>oldest first</span>
          </div>
          {data.queue.length === 0 && (
            <div style={bodyText({ padding: "22px 20px", color: BX.DRIFTWOOD })}>Queue is clear. Nothing needs you.</div>
          )}
          {data.queue.map(q => (
            <div key={q.id} style={{ padding: "14px 20px", borderBottom: `1px solid ${BX.STONE}` }}>
              <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, alignItems: isMobile ? "stretch" : "center" }}>
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: BX.INK }}>{q.title}</div>
                  <div style={{ fontSize: 11, color: BX.DRIFTWOOD, marginTop: 3 }}>
                    {q.detail ? `${q.detail} · ` : ""}{q.raised_by_name || "system"} · {q.domain_name || ""} · {fmtAgo(q.created_at)}
                  </div>
                </div>
                {resolving?.id !== q.id ? (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => { setResolving({ id: q.id, state: "approved" }); setNoteDraft(""); }} style={btnPrimary({ padding: "9px 14px", fontSize: 9 })}>Approve</button>
                    <button onClick={() => { setResolving({ id: q.id, state: "declined" }); setNoteDraft(""); }} style={btnGhost({ padding: "9px 14px", fontSize: 9 })}>Decline</button>
                    <button onClick={() => resolve(q.id, "acknowledged")} style={btnGhost({ padding: "9px 14px", fontSize: 9, borderColor: BX.LINEN, color: BX.DRIFTWOOD })}>Ack</button>
                  </div>
                ) : null}
              </div>
              {resolving?.id === q.id && (
                <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                  <input autoFocus value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && resolve(q.id, resolving.state)}
                    placeholder={`Note to ${q.raised_by_name || "the team"} · optional`}
                    style={{ flexGrow: 1, fontFamily: BX.MONO, fontWeight: 400, fontSize: 12, color: BX.INK,
                      background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`, padding: "8px 10px", outline: "none" }} />
                  <button onClick={() => resolve(q.id, resolving.state)} style={btnPrimary({ padding: "8px 14px", fontSize: 9 })}>
                    {resolving.state === "approved" ? "Approve" : "Decline"}
                  </button>
                  <button onClick={() => setResolving(null)} style={btnGhost({ padding: "8px 12px", fontSize: 9, borderColor: BX.LINEN, color: BX.DRIFTWOOD })}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right column */}
        <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ background: BX.STONE, padding: "14px 18px" }}>
            <div style={eyebrow({ marginBottom: 8 })}>This Week</div>
            {data.week.length === 0 && <div style={bodyText({ fontSize: 12, color: BX.DRIFTWOOD })}>Nothing scheduled.</div>}
            {data.week.map(w => (
              <div key={w.id} style={{ display: "flex", gap: 10, padding: "5px 0", alignItems: "baseline" }}>
                <span style={{ fontFamily: BX.MONO, fontWeight: 400, fontSize: 9, letterSpacing: "0.1em", color: BX.INK, width: 74, flexShrink: 0 }}>{fmtDay(w.due_date)}</span>
                <span style={bodyText({ fontSize: 12 })}>{w.title} <span style={{ color: BX.DRIFTWOOD }}>({w.owner_name})</span></span>
              </div>
            ))}
          </div>

          <div style={card({ flexGrow: 1 })}>
            <div style={{ padding: "13px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
              <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Latest Check-ins</span>
            </div>
            {data.recent_check_ins.length === 0 && (
              <div style={bodyText({ padding: "18px", color: BX.DRIFTWOOD, fontSize: 12 })}>None yet — the team's first check-ins land here.</div>
            )}
            {data.recent_check_ins.map(c => (
              <div key={c.id} style={{ padding: "11px 18px", borderBottom: `1px solid ${BX.STONE}` }}>
                <div style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
                  <span style={serifH(14)}>{c.user_name}</span>
                  <span style={tag(statusColor(c.status))}>{c.status.toUpperCase()}</span>
                  <span style={{ fontSize: 10, color: BX.DRIFTWOOD, marginLeft: "auto" }}>{fmtAgo(c.created_at)}</span>
                </div>
                {c.note && <div style={bodyText({ fontSize: 11, marginTop: 5, color: BX.GRAPHITE })}>{c.note}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

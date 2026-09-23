import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { BX, label, eyebrow, tag, card, serifH, bodyText, btnPrimary, btnGhost, statusColor, statusLabel, fmtAgo } from "../lib/boxx.js";
import BxModal from "../components/BxModal.jsx";

// Detail pop-ups behind the week-in-review tiles — house pattern: the tile is
// the surface, the click opens the numbers behind it.
function DigestDetail({ kind, digest, onClose }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (kind === "pastry" || kind === "waste") {
      api.get(`/api/pastry/reports/${digest.week}`).then(d => setReport(d.report)).catch(e => setError(e.message));
    }
  }, [kind, digest.week]);

  const th = { ...label({ fontSize: 8 }), padding: "8px 14px", borderBottom: `1px solid ${BX.LINEN}`, textAlign: "right" };
  const cell = { padding: "7px 14px", borderBottom: `1px solid ${BX.STONE}`, fontSize: 11, textAlign: "right" };
  const left = { textAlign: "left" };
  const KIND_LABELS = { late_in: "LATE IN", early_in: "EARLY IN", early_out: "EARLY OUT", late_out: "LATE OUT", no_show: "NO SHOW", unscheduled: "UNSCHEDULED" };

  const titles = {
    pastry: `PASTRY · WEEK OF ${digest.week}`, waste: `PASTRY WASTE · WEEK OF ${digest.week}`,
    variances: `TIMECARD VARIANCES · WEEK OF ${digest.week}`, overdue: "OVERDUE COMMITMENTS",
    events: "EVENTS THIS MONTH", checkins: "CHECK-INS · LAST 7 DAYS",
    presence: "TEAM PRESENCE · LAST 7 DAYS",
  };

  return (
    <BxModal title={titles[kind]} onClose={onClose} width={720}>
      <div style={{ padding: "6px 0 16px" }}>
        {error && <div style={{ color: BX.RUST, fontSize: 12, padding: "12px 22px" }}>{error}</div>}

        {(kind === "pastry" || kind === "waste") && !report && !error && (
          <div style={bodyText({ padding: "16px 22px", color: BX.DRIFTWOOD })}>Loading the week's report…</div>
        )}
        {(kind === "pastry" || kind === "waste") && report && (
          <>
            <div style={{ display: "flex", gap: 8, padding: "12px 22px" }}>
              {[["EFFICIENCY", report.totals.efficiency != null ? `${report.totals.efficiency}%` : "—"],
                ["ORDERED", report.totals.ordered], ["SOLD", report.totals.sold],
                ["WASTE", `${report.totals.waste}${report.totals.waste_value ? ` · $${report.totals.waste_value.toFixed(0)}` : ""}`]]
                .map(([l, v]) => (
                <div key={l} style={{ flex: 1, border: `1px solid ${BX.LINEN}`, padding: "10px 12px" }}>
                  <div style={label({ fontSize: 7 })}>{l}</div>
                  <div style={{ fontFamily: BX.SERIF, fontSize: 17, marginTop: 4 }}>{v}</div>
                </div>
              ))}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={{ ...th, ...left }}>ITEM</th><th style={th}>ORD</th><th style={th}>SOLD</th>
                <th style={th}>WASTE</th><th style={th}>WASTE $</th><th style={th}>EFF</th>
              </tr></thead>
              <tbody>
                {(report.items || []).filter(i => i.ordered > 0 || i.sold > 0)
                  .sort((a, b) => (b.waste_value || 0) - (a.waste_value || 0)).map(i => (
                  <tr key={i.item}>
                    <td style={{ ...cell, ...left, fontFamily: BX.SERIF, fontSize: 12 }}>{i.item}</td>
                    <td style={cell}>{i.ordered}</td><td style={cell}>{i.sold}</td>
                    <td style={{ ...cell, color: i.waste > 0 ? BX.AMBER : BX.GRAPHITE }}>{i.waste}</td>
                    <td style={cell}>{i.waste_value != null ? `$${i.waste_value.toFixed(2)}` : "·"}</td>
                    <td style={cell}>{i.ordered > 0 ? `${Math.round((i.sold / i.ordered) * 100)}%` : "·"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {kind === "variances" && (
          (digest.variance_rows || []).length === 0
            ? <div style={bodyText({ padding: "16px 22px", color: BX.DRIFTWOOD })}>No variances recorded for this week.</div>
            : <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={{ ...th, ...left }}>MEMBER</th><th style={{ ...th, ...left }}>DATE</th>
                  <th style={{ ...th, ...left }}>WHAT</th><th style={th}>MINUTES</th>
                </tr></thead>
                <tbody>
                  {digest.variance_rows.map((v, i) => (
                    <tr key={i}>
                      <td style={{ ...cell, ...left, fontFamily: BX.SERIF, fontSize: 12 }}>{v.member_name}</td>
                      <td style={{ ...cell, ...left }}>{v.date.slice(5).replace("-", "/")}</td>
                      <td style={{ ...cell, ...left, color: v.kind === "no_show" ? BX.RUST : BX.AMBER }}>{KIND_LABELS[v.kind] || v.kind}</td>
                      <td style={cell}>{v.diff_min ?? "·"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
        )}

        {kind === "overdue" && (
          (digest.overdue_list || []).length === 0
            ? <div style={bodyText({ padding: "16px 22px", color: BX.DRIFTWOOD })}>Nothing overdue. Clean slate.</div>
            : digest.overdue_list.map((c, i) => (
                <div key={i} style={{ padding: "11px 22px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 12, alignItems: "baseline" }}>
                  <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{c.title}</span>
                  <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>{c.owner_name}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: BX.RUST }}>DUE {c.due_date.slice(5).replace("-", "/")}</span>
                </div>
              ))
        )}

        {kind === "events" && (
          (digest.events_list || []).length === 0
            ? <div style={bodyText({ padding: "16px 22px", color: BX.AMBER })}>Nothing planned this month — the pace is 2.</div>
            : digest.events_list.map((e, i) => (
                <div key={i} style={{ padding: "11px 22px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 12, alignItems: "baseline" }}>
                  <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{e.title}</span>
                  <span style={{ fontSize: 10, color: BX.DRIFTWOOD }}>{e.event_date}</span>
                  <span style={{ marginLeft: "auto" }}><span style={tag(e.status === "confirmed" ? BX.OLIVE : BX.DRIFTWOOD)}>{(e.status || "hold").toUpperCase()}</span></span>
                </div>
              ))
        )}

        {kind === "presence" && (
          <div style={{ padding: "6px 0" }}>
            <div style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD, padding: "6px 22px 10px" })}>
              Days with any in-app activity, last 7 days. The bar is once a day, every day.
            </div>
            {(digest.presence || []).map((p) => {
              const color = p.days >= 5 ? BX.INK : p.days >= 3 ? BX.AMBER : BX.RUST;
              return (
                <div key={p.name} style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontFamily: BX.SERIF, fontSize: 13, width: 110 }}>{p.name}</span>
                  <span style={{ display: "flex", gap: 3 }}>
                    {Array.from({ length: 7 }, (_, i) => (
                      <span key={i} style={{ width: 14, height: 14, border: `1px solid ${BX.LINEN}`,
                        background: i < p.days ? color : "transparent", opacity: i < p.days ? 0.85 : 1 }} />
                    ))}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color, fontWeight: p.days < 5 ? 500 : 400 }}>
                    {p.days} of 7
                  </span>
                </div>
              );
            })}
            {(digest.presence || []).length === 0 && (
              <div style={bodyText({ padding: "6px 22px", color: BX.DRIFTWOOD })}>No activity recorded yet.</div>
            )}
          </div>
        )}

        {kind === "checkins" && (
          <div style={{ padding: "12px 22px" }}>
            <div style={label({ fontSize: 8, marginBottom: 8 })}>CHECKED IN</div>
            <div style={bodyText({ fontSize: 12, marginBottom: 14 })}>
              {(digest.checked_in_names || []).length ? digest.checked_in_names.join(" · ") : "Nobody yet this week."}
            </div>
            <div style={label({ fontSize: 8, marginBottom: 8, color: BX.AMBER })}>NOT YET</div>
            <div style={bodyText({ fontSize: 12, color: (digest.missing_check_ins || []).length ? BX.AMBER : BX.DRIFTWOOD })}>
              {(digest.missing_check_ins || []).length ? digest.missing_check_ins.join(" · ") : "Everyone's in."}
            </div>
          </div>
        )}
      </div>
    </BxModal>
  );
}

// Owner dashboard: seven tiles, the decision queue, this week, latest check-ins.
export default function HubOverview({ onOpenDomain, isMobile, T }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [resolving, setResolving] = useState(null);   // decision being resolved: {id, state}
  const [noteDraft, setNoteDraft] = useState("");
  const [detail, setDetail] = useState(null);         // open week-in-review pop-up

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

      {/* Something automatic is failing — say so, don't leave it in a log table */}
      {(data.job_alerts || []).length > 0 && (
        <div style={card({ padding: "11px 16px", marginBottom: 12, borderColor: BX.RUST })}>
          <div style={label({ color: BX.RUST, letterSpacing: "0.2em", marginBottom: 4 })}>
            Automatic jobs failing — the app is running on stale data
          </div>
          {data.job_alerts.map((a, i) => (
            <div key={i} style={bodyText({ fontSize: 11, padding: "3px 0" })}>
              <span style={{ fontWeight: 500, color: BX.INK }}>{a.job_type}</span>
              {` — ${a.message || "failed"} · ${fmtAgo(a.started_at)}`}
            </div>
          ))}
        </div>
      )}

      {/* Week in review — the digest ribbon, expanded. Member tiles live on
          the Team tab; this is the numbers view. */}
      {data.digest && (() => {
        const d = data.digest;
        const p = d.pastry;
        const statTile = (key, lbl2, big, sub, color = BX.INK) => (
          <button key={key} onClick={() => setDetail(key)}
            style={{ ...card({ padding: "13px 15px", cursor: "pointer" }), textAlign: "left",
              fontFamily: BX.MONO, width: "100%" }}>
            <div style={label({ fontSize: 7 })}>{lbl2}</div>
            <div style={{ fontFamily: BX.SERIF, fontSize: 21, margin: "6px 0 2px", color }}>{big}</div>
            <div style={{ fontSize: 9, color: BX.DRIFTWOOD }}>{sub}</div>
          </button>
        );
        return (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
              <span style={label({ color: BX.OLIVE, letterSpacing: "0.2em" })}>Week of {d.week}</span>
              <span style={{ marginLeft: "auto", ...label({ fontSize: 8 }) }}>WEEK IN REVIEW · AUTOMATIC · CLICK A TILE FOR DETAIL</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(7, minmax(0, 1fr))", gap: 8 }}>
              {statTile("pastry", "PASTRY EFFICIENCY", p?.efficiency != null ? `${p.efficiency}%` : "—",
                p ? `${p.sold} sold of ${p.ordered} ordered` : "no report yet")}
              {statTile("waste", "PASTRY WASTE", p ? p.waste : "—",
                p?.waste_value ? `units · $${p.waste_value.toFixed(0)}` : "units",
                p && p.waste > 0 ? BX.AMBER : BX.INK)}
              {statTile("variances", "TIMECARD VARIANCES", d.variances,
                d.no_shows > 0 ? `${d.no_shows} no-show${d.no_shows === 1 ? "" : "s"}` : "over 5 minutes",
                d.variances > 0 ? BX.AMBER : BX.INK)}
              {statTile("overdue", "OVERDUE", d.overdue_commitments, "commitments",
                d.overdue_commitments > 0 ? BX.RUST : BX.INK)}
              {statTile("events", "EVENTS", `${d.events_this_month} of 2`, "this month",
                d.events_this_month < 1 ? BX.AMBER : BX.INK)}
              {statTile("checkins", "CHECK-INS", `${d.checked_in_week ?? "—"} of 7`, "last 7 days",
                (d.checked_in_week ?? 7) < 7 ? BX.AMBER : BX.INK)}
              {statTile("presence", "TEAM PRESENCE", d.presence_avg != null ? `${d.presence_avg} of 7` : "—",
                "avg days in-app, last 7",
                d.presence_avg == null ? BX.INK : d.presence_avg < 3 ? BX.RUST : d.presence_avg < 5 ? BX.AMBER : BX.INK)}
            </div>
            {detail && <DigestDetail kind={detail} digest={d} onClose={() => setDetail(null)} />}
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

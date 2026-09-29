import { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import { BX, label, tag, bodyText } from "../lib/boxx.js";
import BxModal from "./BxModal.jsx";

// Timecard variances for one week, two levels: who → their day-by-day.
// The header names the in-app schedule version the week was checked against —
// Square supplies clock-ins only, never the reference schedule.
const KIND_LABELS = {
  late_in: "LATE IN", early_in: "EARLY IN", early_out: "EARLY OUT",
  late_out: "LATE OUT", no_show: "NO SHOW", unscheduled: "UNSCHEDULED",
};
const kindColor = (k) => k === "no_show" ? BX.RUST : k === "unscheduled" ? BX.DRIFTWOOD : BX.AMBER;

export default function VarianceBreakdown({ week, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [who, setWho] = useState(null);

  useEffect(() => {
    api.get(`/api/labor/variances?week=${week}`).then(setData).catch(e => setError(e.message));
  }, [week]);

  const byMember = {};
  for (const v of data?.variances || []) (byMember[v.member_name] = byMember[v.member_name] || []).push(v);
  const members = Object.entries(byMember)
    .map(([name, rows]) => ({ name, rows }))
    .sort((a, b) => b.rows.length - a.rows.length);

  const th = { ...label({ fontSize: 8 }), padding: "8px 14px", borderBottom: `1px solid ${BX.LINEN}`, textAlign: "right" };
  const cell = { padding: "7px 14px", borderBottom: `1px solid ${BX.STONE}`, fontSize: 11, textAlign: "right" };
  const left = { textAlign: "left" };

  const kindChips = (rows) => {
    const counts = {};
    for (const v of rows) counts[v.kind] = (counts[v.kind] || 0) + 1;
    return Object.entries(counts).map(([k, n]) => (
      <span key={k} style={tag(kindColor(k), { flexShrink: 0 })}>{n} {KIND_LABELS[k] || k}</span>
    ));
  };

  return (
    <BxModal title={`TIMECARD VARIANCES · WEEK OF ${week}`} onClose={onClose} width={720}>
      <div style={{ padding: "0 0 14px", fontFamily: BX.MONO, fontWeight: 400, color: BX.INK }}>
        <div style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.LINEN}`, fontSize: 10, color: BX.DRIFTWOOD }}>
          Checked against the in-app schedule{data?.against ? ` effective ${data.against.effective_date}${data.against.note ? ` (${data.against.note})` : ""}` : ""},
          with approved swaps applied. Square supplies the clock-ins only.
        </div>
        {error && <div style={bodyText({ color: BX.RUST, padding: "14px 22px" })}>{error}</div>}
        {!data && !error && <div style={bodyText({ padding: "14px 22px", color: BX.DRIFTWOOD })}>Loading…</div>}
        {data && members.length === 0 && (
          <div style={bodyText({ padding: "16px 22px", color: BX.DRIFTWOOD })}>No variances recorded for this week.</div>
        )}

        {/* Level 1: the team */}
        {data && !who && members.map(m => (
          <button key={m.name} onClick={() => setWho(m.name)}
            style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left",
              padding: "11px 22px", background: "transparent", border: "none",
              borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer", fontFamily: BX.MONO, color: BX.INK }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 14, width: 100, flexShrink: 0 }}>{m.name}</span>
            <span style={{ fontSize: 11, color: BX.DRIFTWOOD, flexShrink: 0 }}>{m.rows.length}</span>
            <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{kindChips(m.rows)}</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: BX.DRIFTWOOD }}>›</span>
          </button>
        ))}

        {/* Level 2: one member's days */}
        {data && who && (
          <>
            <div style={{ padding: "11px 22px", display: "flex", gap: 12, alignItems: "baseline" }}>
              <button onClick={() => setWho(null)}
                style={{ background: "transparent", border: `1px solid ${BX.LINEN}`, color: BX.DRIFTWOOD,
                  fontFamily: BX.MONO, fontSize: 8, letterSpacing: "0.14em", padding: "6px 10px",
                  textTransform: "uppercase", cursor: "pointer" }}>‹ Everyone</button>
              <span style={{ fontFamily: BX.SERIF, fontSize: 16 }}>{who}</span>
              <span style={{ fontSize: 11, color: BX.DRIFTWOOD }}>{byMember[who]?.length} variance{byMember[who]?.length === 1 ? "" : "s"}</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={{ ...th, ...left }}>DATE</th><th style={{ ...th, ...left }}>WHAT</th>
                <th style={th}>SCHEDULED</th><th style={th}>CLOCKED</th><th style={th}>MINUTES</th>
              </tr></thead>
              <tbody>
                {(byMember[who] || []).map((v, i) => (
                  <tr key={i}>
                    <td style={{ ...cell, ...left }}>{v.date.slice(5).replace("-", "/")}</td>
                    <td style={{ ...cell, ...left, color: kindColor(v.kind) }}>{KIND_LABELS[v.kind] || v.kind}</td>
                    <td style={cell}>{v.scheduled_at || "·"}</td>
                    <td style={cell}>{v.actual_at || "·"}</td>
                    <td style={cell}>{v.diff_min ?? "·"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </BxModal>
  );
}

import { useState, useEffect } from "react";
import { api } from "../../lib/api.js";
import { BX, label, card, bodyText } from "../../lib/boxx.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CODE_STYLE = {
  OPEN:     { background: BX.INK, color: BX.PARCHMENT, border: `1px solid ${BX.INK}` },
  MID:      { background: BX.OLIVE, color: BX.PARCHMENT, border: `1px solid ${BX.OLIVE}` },
  CLOSE:    { background: "transparent", color: BX.INK, border: `1px solid ${BX.LINEN}` },
  ROASTERY: { background: "transparent", color: BX.OLIVE, border: `1px solid ${BX.OLIVE}` },
  OFF:      null,
};

// The standing schedule, versioned like the pastry order. Published rarely;
// the Hours tab checks timecards against whatever version is in force.
export default function ScheduleTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/api/schedule").then(setData).catch(e => setError(e.message));
  }, []);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;
  if (!data.version) return <div style={bodyText({ padding: 20, color: BX.DRIFTWOOD })}>No schedule on file yet.</div>;

  const members = Object.keys(data.grid).sort();

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 300, color: BX.INK, maxWidth: 1050 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={label()}>STANDING SCHEDULE · EFFECTIVE {data.version.effective_date}{data.version.note ? ` · ${data.version.note.toUpperCase()}` : ""}</span>
      </div>
      <div style={{ display: "flex", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
        {["OPEN", "MID", "CLOSE", "ROASTERY"].map(c => (
          <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, display: "inline-block", ...CODE_STYLE[c], border: CODE_STYLE[c].border }} />
            {<span style={label({ fontSize: 8 })}>{c}</span>}
          </span>
        ))}
      </div>
      <div style={card({ overflowX: "auto" })}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BX.MONO }}>
          <thead><tr>
            <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 400, fontSize: 8, letterSpacing: "0.16em", color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.LINEN}` }}></th>
            {DAYS.map(d => (
              <th key={d} style={{ textAlign: "center", padding: "10px 8px", fontWeight: 400, fontSize: 8, letterSpacing: "0.16em", color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.LINEN}` }}>
                {d.slice(0, 3).toUpperCase()}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {members.map(name => (
              <tr key={name}>
                <td style={{ padding: "9px 14px", fontFamily: BX.SERIF, fontSize: 13, borderBottom: `1px solid ${BX.STONE}`, whiteSpace: "nowrap" }}>{name}</td>
                {DAYS.map(d => {
                  const s = data.grid[name]?.[d];
                  const style = s ? CODE_STYLE[s.code] : null;
                  return (
                    <td key={d} style={{ padding: "7px 6px", textAlign: "center", borderBottom: `1px solid ${BX.STONE}` }}>
                      {!s || s.code === "OFF" ? (
                        <span style={{ fontSize: 9, color: BX.LINEN }}>OFF</span>
                      ) : (
                        <span style={{ display: "inline-block", padding: "4px 8px", fontSize: 8, fontWeight: 400,
                          letterSpacing: "0.12em", whiteSpace: "nowrap", ...style }}>
                          {s.code}{s.label ? ` ${s.label.replace(" · ", "–")}` : ""}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10 }}>
        <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>
          Roastery days have no store hours to check, so timecards on those days never raise variances.
          New versions upload with the swap checker build.
        </span>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../lib/api.js";
import { BX, label, card, bodyText, btnPrimary, btnGhost, inputBx } from "../../lib/boxx.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CODE_STYLE = {
  OPEN:     { background: BX.INK, color: BX.PARCHMENT, border: `1px solid ${BX.INK}` },
  MID:      { background: BX.OLIVE, color: BX.PARCHMENT, border: `1px solid ${BX.OLIVE}` },
  CLOSE:    { background: "transparent", color: BX.INK, border: `1px solid ${BX.LINEN}` },
  ROASTERY: { background: "transparent", color: BX.OLIVE, border: `1px solid ${BX.OLIVE}` },
  OFF:      null,
};
const PRESETS = ["OFF", "OPEN 6-12", "OPEN 6-1", "MID 9-4", "CLOSE 12-7", "CLOSE 1-7", "ROASTERY"];

// Map a stored shift back to its preset key for the editor
const presetOf = (s) => {
  if (!s || s.code === "OFF") return "OFF";
  if (s.code === "ROASTERY") return "ROASTERY";
  const key = PRESETS.find(p => {
    const m = /^(\w+) (\d+)-(\d+)$/.exec(p);
    if (!m || m[1] !== s.code) return false;
    const h = (x) => { const n = Number(x); return (n < 6 || n === 7 ? n + 12 : n) * 60; };
    return h(m[2]) === s.start_min && h(m[3]) === s.end_min;
  });
  return key || (s.code === "OPEN" ? "OPEN 6-1" : s.code === "MID" ? "MID 9-4" : "CLOSE 12-7");
};

// Next Monday as the default effective date for a new version
const nextMonday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
};

// The standing schedule, versioned like the pastry order. Travis or the owner
// can publish a new version in-app; past weeks keep checking against whatever
// version was in force at the time.
export default function ScheduleTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});            // member → day → preset
  const [effective, setEffective] = useState(nextMonday());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [importWarnings, setImportWarnings] = useState([]);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    api.get("/api/schedule").then(setData).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;
  if (!data.version && !editing) return (
    <div style={bodyText({ padding: 20, color: BX.DRIFTWOOD })}>
      No schedule on file yet.
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={e => importFile(e.target.files?.[0])} />
      <button onClick={() => fileRef.current?.click()} style={btnGhost({ marginLeft: 12, padding: "8px 14px", fontSize: 8, borderColor: BX.OLIVE, color: BX.OLIVE })}>
        Upload week (.xlsx)
      </button>
    </div>
  );

  const members = Object.keys(data.grid).sort();

  const startEdit = () => {
    const d = {};
    for (const m of members) {
      d[m] = {};
      for (const day of DAYS) d[m][day] = presetOf(data.grid[m]?.[day]);
    }
    setDraft(d); setEffective(nextMonday()); setNote(""); setEditing(true);
  };
  const publish = async () => {
    setBusy(true); setError(null);
    try {
      await api.post("/api/schedule", { effective_date: effective, note: note || undefined, grid: draft });
      setEditing(false); setImportWarnings([]); load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  // The planner spreadsheet becomes an editor draft: parsed on the server,
  // reviewed here, published like any hand-edited version — never auto.
  const importFile = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.upload("/api/schedule/import", fd);
      // Roster members missing from the sheet stay visible in the editor, OFF
      const base = {};
      for (const m of new Set([...members, ...Object.keys(r.grid)])) {
        base[m] = {};
        for (const day of DAYS) base[m][day] = r.grid[m]?.[day] || "OFF";
      }
      setDraft(base);
      setEffective(nextMonday());
      setNote(`Imported from ${file.name.slice(0, 80)}`);
      setImportWarnings(r.warnings || []);
      setEditing(true);
    } catch (err) { setError(`Import failed: ${err.message}`); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  if (editing) return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 1050 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={label()}>NEW SCHEDULE VERSION</span>
        <span style={label({ fontSize: 8 })}>EFFECTIVE</span>
        <input type="date" value={effective} onChange={e => setEffective(e.target.value)}
          style={inputBx({ fontSize: 12, padding: "7px 10px" })} />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (winter hours…)"
          style={inputBx({ fontSize: 12, padding: "8px 10px", width: 180 })} />
        <button onClick={publish} disabled={busy}
          style={btnPrimary({ marginLeft: "auto", padding: "10px 16px", fontSize: 9, opacity: busy ? 0.5 : 1 })}>
          {busy ? "Publishing…" : "Publish version"}
        </button>
        <button onClick={() => { setEditing(false); setImportWarnings([]); }} style={btnGhost({ padding: "10px 12px", fontSize: 9, borderColor: BX.LINEN, color: BX.DRIFTWOOD })}>✕</button>
      </div>
      {importWarnings.length > 0 && (
        <div style={card({ padding: "10px 14px", marginBottom: 10, borderColor: BX.AMBER })}>
          <div style={label({ fontSize: 8, color: BX.AMBER, marginBottom: 4 })}>IMPORT NOTES — CHECK BEFORE PUBLISHING</div>
          {importWarnings.map((w, i) => (
            <div key={i} style={bodyText({ fontSize: 11, padding: "2px 0" })}>{w}</div>
          ))}
        </div>
      )}
      <div style={card({ overflowX: "auto" })}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BX.MONO }}>
          <thead><tr>
            <th style={{ padding: "10px 14px", borderBottom: `1px solid ${BX.LINEN}` }}></th>
            {DAYS.map(d => (
              <th key={d} style={{ textAlign: "center", padding: "10px 6px", fontWeight: 400, fontSize: 8, letterSpacing: "0.16em", color: BX.DRIFTWOOD, borderBottom: `1px solid ${BX.LINEN}` }}>
                {d.slice(0, 3).toUpperCase()}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {Object.keys(draft).sort().map(name => (
              <tr key={name}>
                <td style={{ padding: "8px 14px", fontFamily: BX.SERIF, fontSize: 13, borderBottom: `1px solid ${BX.STONE}`, whiteSpace: "nowrap" }}>{name}</td>
                {DAYS.map(d => (
                  <td key={d} style={{ padding: "5px 3px", textAlign: "center", borderBottom: `1px solid ${BX.STONE}` }}>
                    <select value={draft[name]?.[d] || "OFF"}
                      onChange={e => setDraft(dr => ({ ...dr, [name]: { ...dr[name], [d]: e.target.value } }))}
                      style={inputBx({ fontSize: 10, padding: "5px 4px",
                        color: draft[name]?.[d] === "OFF" ? BX.DRIFTWOOD : BX.INK })}>
                      {PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10 }}>
        <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>
          Publishing creates a new version from the effective date forward. Past weeks keep checking timecards
          against the version that was in force at the time, and approved swap exceptions stay untouched.
        </span>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 1050 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={label()}>STANDING SCHEDULE · EFFECTIVE {data.version.effective_date}{data.version.note ? ` · ${data.version.note.toUpperCase()}` : ""}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
            onChange={e => importFile(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            style={{ padding: "8px 14px", background: "transparent",
              border: `1px solid ${BX.OLIVE}`, color: BX.OLIVE, fontFamily: BX.MONO, fontSize: 8,
              letterSpacing: "0.16em", textTransform: "uppercase", cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Reading…" : "Upload week (.xlsx)"}
          </button>
          <button onClick={startEdit} style={{ padding: "8px 14px", background: "transparent",
            border: `1px solid ${BX.INK}`, color: BX.INK, fontFamily: BX.MONO, fontSize: 8,
            letterSpacing: "0.16em", textTransform: "uppercase", cursor: "pointer" }}>
            Edit schedule
          </button>
        </span>
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
      {/* Who has opened My Schedule since the last publish */}
      {data.seen && (
        <div style={card({ marginTop: 10 })}>
          <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex",
            gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Seen by the team</span>
            <span style={label({ fontSize: 8 })}>LAST PUBLISH · EFFECTIVE {data.seen.effective_date} · {(data.seen.note || "").toUpperCase()}</span>
            <span style={{ marginLeft: "auto", fontSize: 11,
              color: data.seen.missing.length ? BX.AMBER : BX.OLIVE }}>
              {data.seen.acks.length} of {data.seen.acks.length + data.seen.missing.length}
            </span>
          </div>
          <div style={{ padding: "10px 16px", display: "flex", gap: "8px 18px", flexWrap: "wrap" }}>
            {data.seen.acks.map(a => (
              <span key={a.name} style={{ fontSize: 11, color: BX.GRAPHITE }}>
                <span style={{ fontFamily: BX.SERIF, fontSize: 12 }}>{a.name}</span>
                {` · seen ${new Date(a.seen_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
              </span>
            ))}
            {data.seen.missing.map(name => (
              <span key={name} style={{ fontSize: 11, color: BX.AMBER }}>
                <span style={{ fontFamily: BX.SERIF, fontSize: 12 }}>{name}</span> · not yet
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>
          Roastery days have no store hours to check, so timecards on those days never raise variances.
          Edit schedule publishes a new effective-dated version and pushes it: a board post @everyone plus a
          strip on each member's dashboard until they open My Schedule. Approved swaps override single days on top.
        </span>
      </div>
    </div>
  );
}

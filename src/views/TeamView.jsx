import { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import { BX, label, tag, card, serifH, bodyText, statusColor, statusLabel, fmtAgo } from "../lib/boxx.js";

// Team: every domain at a glance, readable by everyone. Transparency is the
// default; sensitive numbers (labor, expenses) live in their own views.
export default function TeamView({ onOpenDomain, isMobile }) {
  const [domains, setDomains] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/api/domains").then(d => setDomains(d.domains)).catch(e => setError(e.message));
  }, []);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!domains) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 300, color: BX.INK, display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 8, maxWidth: 900 }}>
      {domains.map(d => (
        <div key={d.id} onClick={() => onOpenDomain(d.id)} style={card({ padding: "16px 18px", cursor: "pointer" })}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span style={serifH(17)}>{d.owner}</span>
            <span style={tag(statusColor(d.status))}>{statusLabel(d.status)}</span>
          </div>
          <div style={label({ fontSize: 8, margin: "4px 0 10px" })}>{d.name}</div>
          {d.last_check_in?.note
            ? <div style={bodyText({ fontSize: 12 })}>{d.last_check_in.note}</div>
            : <div style={bodyText({ fontSize: 12, color: BX.DRIFTWOOD })}>No check-in yet.</div>}
          <div style={{ fontSize: 10, color: BX.DRIFTWOOD, marginTop: 8 }}>
            {d.last_check_in ? `Checked in ${fmtAgo(d.last_check_in.at)}` : "—"}
            {d.upcoming.length > 0 && ` · next: ${d.upcoming[0].title} (${d.upcoming[0].due_date.slice(5).replace("-", "/")})`}
          </div>
        </div>
      ))}
    </div>
  );
}

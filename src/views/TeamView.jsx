import { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import { BX, label, tag, card, serifH, bodyText, statusColor, statusLabel, fmtAgo } from "../lib/boxx.js";

// Team: every domain at a glance, readable by everyone. The Board lives in
// its own nav tab; waiting-on chips here show who is holding whom.
export default function TeamView({ onOpenDomain, isMobile }) {
  const [domains, setDomains] = useState(null);
  const [waiting, setWaiting] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/api/domains").then(d => setDomains(d.domains)).catch(e => setError(e.message));
    api.get("/api/waiting/summary").then(d => setWaiting(d.summary)).catch(() => {});
  }, []);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!domains) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const chips = (owner) => {
    const w = waiting[owner];
    if (!w) return null;
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {w.holding > 0 && (
          <span style={tag(BX.AMBER)}>HOLDING {w.holding} · OLDEST {w.oldest_days}D</span>
        )}
        {w.blocked_by.map(b => (
          <span key={b.who} style={tag(BX.AMBER)}>BLOCKED BY {b.who.toUpperCase()} · {b.days}D</span>
        ))}
      </div>
    );
  };

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 900 }}>
      <div style={{ display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {domains.map(d => (
          <div key={d.id} onClick={() => onOpenDomain(d.id)}
            style={card({ padding: "16px 18px", cursor: "pointer",
              borderColor: waiting[d.owner]?.holding > 0 ? BX.AMBER : BX.LINEN })}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <span style={serifH(17)}>{d.owner}</span>
              <span style={tag(statusColor(d.status))}>{statusLabel(d.status)}</span>
            </div>
            <div style={label({ fontSize: 8, margin: "4px 0 10px" })}>{d.name}</div>
            {d.last_check_in?.note
              ? <div style={bodyText({ fontSize: 12 })}>{d.last_check_in.note}</div>
              : <div style={bodyText({ fontSize: 12, color: BX.DRIFTWOOD })}>No check-in yet.</div>}
            {chips(d.owner)}
            <div style={{ fontSize: 10, color: BX.DRIFTWOOD, marginTop: 8,
              display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span>
                {d.last_check_in ? `Checked in ${fmtAgo(d.last_check_in.at)}` : "—"}
                {d.upcoming.length > 0 && ` · next: ${d.upcoming[0].title} (${d.upcoming[0].due_date.slice(5).replace("-", "/")})`}
              </span>
              <span style={label({ fontSize: 8, flexShrink: 0 })}>FULL CARD →</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

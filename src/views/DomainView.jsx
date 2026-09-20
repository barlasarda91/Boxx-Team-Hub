import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { BX, label, eyebrow, tag, card, serifH, bodyText, btnPrimary, btnGhost, inputBx, statusColor, statusLabel, fmtAgo } from "../lib/boxx.js";
import CheckInModal from "../components/CheckInModal.jsx";
import PastryTab from "./tabs/PastryTab.jsx";
import OrdersWatchTab from "./tabs/OrdersWatchTab.jsx";
import OneOnOneTab from "./tabs/OneOnOneTab.jsx";
import HoursTab from "./tabs/HoursTab.jsx";
import ScheduleTab from "./tabs/ScheduleTab.jsx";
import SwapTab from "./tabs/SwapTab.jsx";
import CalendarTab from "./tabs/CalendarTab.jsx";
import InfluencersTab from "./tabs/InfluencersTab.jsx";
import { FoldersTab, BriefTab } from "./tabs/AminTabs.jsx";
import EventsTab from "./tabs/EventsTab.jsx";
import { BirthdaysTab, TeamEventsTab } from "./tabs/AlexTabs.jsx";
import EquipmentTab from "./tabs/EquipmentTab.jsx";
import CatalogView from "./CatalogView.jsx";
import CountView from "./CountView.jsx";
import InvoicesView from "./InvoicesView.jsx";
import { THEMES } from "../themes.js";

// Each member's card is a tab bar: Overview + their working tools + 1:1.
// Cards keep surface info; detail opens in pop-ups inside each tab.
const WORK_TABS = {
  Ben: [
    { id: "pastry",    label: "Pastry" },
    { id: "orders",    label: "Orders" },
    { id: "catalogue", label: "Catalogue" },
    { id: "count",     label: "Count" },
    { id: "invoices",  label: "Invoices" },
  ],
  Travis: [
    { id: "hours",    label: "Hours" },
    { id: "swap",     label: "Swap Check" },
    { id: "schedule", label: "Schedule" },
  ],
  Vicky: [
    { id: "calendar",    label: "Calendar" },
    { id: "influencers", label: "Influencers" },
    { id: "brief",       label: "Brief" },
  ],
  Amin: [
    { id: "folders", label: "Folders" },
    { id: "brief",   label: "Brief" },
  ],
  Brandon: [
    { id: "events", label: "Events" },
  ],
  Alex: [
    { id: "birthdays",  label: "Birthdays" },
    { id: "teamevents", label: "Team Events" },
  ],
  Manny: [
    { id: "equipment", label: "Equipment" },
  ],
};

// A domain page: the member's home (writable) or a read view for anyone else.
// Standard at top, check-in as primary action, commitments, decisions, history.
export default function DomainView({ domainId, me, isMobile }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showStandard, setShowStandard] = useState(false);
  const [draft, setDraft] = useState({ title: "", due_date: "", repeat_rule: "none" });
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState("overview");
  useEffect(() => { setTab("overview"); }, [domainId]);

  const load = useCallback(() => {
    api.get(`/api/domains/${domainId}`).then(setData).catch(e => setError(e.message));
  }, [domainId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const d = data.domain;
  const mine = me.user.role === "owner" || d.owner_user_id === me.user.id;
  const canWrite = mine;

  const completeCommitment = async (id) => {
    try { await api.post(`/api/commitments/${id}/complete`); load(); }
    catch (err) { setError(err.message); }
  };

  const addCommitment = async () => {
    if (!draft.title || !/^\d{4}-\d{2}-\d{2}$/.test(draft.due_date)) return;
    try {
      await api.post("/api/commitments", { domain_id: d.id, ...draft });
      setDraft({ title: "", due_date: "", repeat_rule: "none" });
      setAdding(false);
      load();
    } catch (err) { setError(err.message); }
  };

  const openCommitments = data.commitments.filter(c => !c.done_at);
  const doneCommitments = data.commitments.filter(c => c.done_at);
  const today = new Date().toISOString().split("T")[0];

  const showWork = me.user.role === "owner" || d.owner_user_id === me.user.id;
  const workTabs = showWork ? (WORK_TABS[d.owner] || []) : [];
  const tabs = [
    { id: "overview", label: "Overview" },
    ...workTabs,
    ...(showWork ? [{ id: "oneonone", label: "1:1" }] : []),
  ];
  const activeSoon = workTabs.find(t => t.id === tab)?.soon;

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK,
      maxWidth: tab === "overview" ? 760 : 1050 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <span style={serifH(22)}>{d.owner}</span>
        <span style={tag(statusColor(d.status))}>{statusLabel(d.status)}</span>
      </div>
      <div style={label({ marginBottom: 12 })}>{d.name} · checks in weekly</div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${BX.LINEN}`, marginBottom: 16,
        overflowX: "auto", whiteSpace: "nowrap" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "11px 14px",
              marginBottom: -1, flexShrink: 0,
              borderBottom: `2px solid ${tab === t.id ? BX.INK : "transparent"}`,
              ...label({ fontSize: 9, color: tab === t.id ? BX.INK : BX.DRIFTWOOD }) }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Working tabs */}
      {tab === "oneonone" && <OneOnOneTab domainId={d.id} />}
      {tab === "hours" && <HoursTab isMobile={isMobile} />}
      {tab === "schedule" && <ScheduleTab />}
      {tab === "swap" && <SwapTab isMobile={isMobile} />}
      {tab === "calendar" && <CalendarTab isMobile={isMobile} />}
      {tab === "influencers" && <InfluencersTab isMobile={isMobile} />}
      {tab === "brief" && <BriefTab />}
      {tab === "folders" && <FoldersTab isMobile={isMobile} />}
      {tab === "events" && <EventsTab isMobile={isMobile} />}
      {tab === "birthdays" && <BirthdaysTab isMobile={isMobile} />}
      {tab === "teamevents" && <TeamEventsTab />}
      {tab === "equipment" && <EquipmentTab isMobile={isMobile} />}
      {tab === "pastry" && <PastryTab isMobile={isMobile} />}
      {tab === "orders" && <OrdersWatchTab isMobile={isMobile} />}
      {tab === "catalogue" && <CatalogView isMobile={isMobile} />}
      {tab === "count" && <CountView isMobile={isMobile} />}
      {tab === "invoices" && <InvoicesView T={THEMES.boxx} />}
      {activeSoon && (
        <div style={card({ padding: "20px 18px" })}>
          <span style={bodyText({ fontSize: 13, color: BX.DRIFTWOOD })}>
            This tab arrives with {activeSoon}. The design is settled; the plumbing is next.
          </span>
        </div>
      )}

      {tab !== "overview" ? null : <>

      {/* Standard */}
      <div style={card({ marginBottom: 8 })}>
        <button onClick={() => setShowStandard(s => !s)}
          style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
            padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={eyebrow()}>The Standard</span>
          <span style={label({ fontSize: 8 })}>{showStandard ? "HIDE" : "SHOW"}</span>
        </button>
        {showStandard && (
          <div style={{ padding: "0 18px 16px" }}>
            <div style={bodyText({ fontSize: 12 })}>{d.standard_md}</div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BX.STONE}` }}>
              <span style={label({ fontSize: 8 })}>Authority limits</span>
              <div style={bodyText({ fontSize: 12, marginTop: 4 })}>{d.authority_limits_md}</div>
            </div>
          </div>
        )}
      </div>

      {/* Check-in CTA */}
      {canWrite && (
        <button onClick={() => setShowCheckIn(true)}
          style={btnPrimary({ width: "100%", padding: "16px 0", marginBottom: 8, display: "flex",
            alignItems: "center", justifyContent: "center", gap: 10 })}>
          Weekly check-in{d.check_in_overdue ? " · overdue" : ""}
        </button>
      )}

      {/* Commitments */}
      <div style={card({ marginBottom: 8 })}>
        <div style={{ padding: "13px 18px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between" }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Commitments</span>
          {canWrite && (
            <button onClick={() => setAdding(a => !a)} style={{ background: "none", border: "none", cursor: "pointer", ...label({ fontSize: 8, textDecoration: "underline" }) }}>
              {adding ? "CANCEL" : "+ ADD"}
            </button>
          )}
        </div>
        {adding && (
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", flexDirection: isMobile ? "column" : "row", gap: 8 }}>
            <input value={draft.title} onChange={e => setDraft(s => ({ ...s, title: e.target.value }))}
              placeholder="What needs doing" style={inputBx({ flexGrow: 1, fontSize: 12 })} />
            <input type="date" value={draft.due_date} onChange={e => setDraft(s => ({ ...s, due_date: e.target.value }))}
              style={inputBx({ fontSize: 12 })} />
            <select value={draft.repeat_rule} onChange={e => setDraft(s => ({ ...s, repeat_rule: e.target.value }))}
              style={inputBx({ fontSize: 12 })}>
              <option value="none">once</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="annual">annual</option>
            </select>
            <button onClick={addCommitment} style={btnGhost({ padding: "10px 16px", fontSize: 9 })}>Save</button>
          </div>
        )}
        {openCommitments.length === 0 && <div style={bodyText({ padding: "16px 18px", color: BX.DRIFTWOOD, fontSize: 12 })}>Nothing open.</div>}
        {openCommitments.map(c => (
          <div key={c.id} style={{ padding: "11px 18px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", alignItems: "center", gap: 12 }}>
            {canWrite ? (
              <button onClick={() => completeCommitment(c.id)} aria-label={`Mark done: ${c.title}`}
                style={{ width: 20, height: 20, background: "transparent", border: `1px solid ${BX.DRIFTWOOD}`, cursor: "pointer", flexShrink: 0 }} />
            ) : (
              <span style={{ width: 20, height: 20, border: `1px solid ${BX.STONE}`, flexShrink: 0, display: "inline-block" }} />
            )}
            <span style={bodyText({ fontSize: 13, flexGrow: 1 })}>{c.title}</span>
            <span style={{ fontFamily: BX.MONO, fontWeight: 400, fontSize: 9, letterSpacing: "0.1em",
              color: c.due_date < today ? BX.RUST : BX.DRIFTWOOD, flexShrink: 0 }}>
              {c.due_date < today ? "OVERDUE · " : ""}{c.due_date.slice(5).replace("-", "/")}
              {c.repeat_rule !== "none" ? ` · ${c.repeat_rule.replace("every:", "each ")}` : ""}
            </span>
          </div>
        ))}
        {doneCommitments.length > 0 && (
          <div style={{ padding: "9px 18px", fontSize: 10, color: BX.DRIFTWOOD }}>
            {doneCommitments.length} completed in the last two weeks
          </div>
        )}
      </div>

      {/* Decisions raised from this domain */}
      {data.decisions.length > 0 && (
        <div style={card({ marginBottom: 8 })}>
          <div style={{ padding: "13px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Raised to the owner</span>
          </div>
          {data.decisions.map(dec => (
            <div key={dec.id} style={{ padding: "11px 18px", borderBottom: `1px solid ${BX.STONE}` }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={tag(dec.state === "open" ? BX.AMBER : dec.state === "declined" ? BX.RUST : BX.DRIFTWOOD)}>
                  {dec.state.toUpperCase()}
                </span>
                <span style={bodyText({ fontSize: 12, flexGrow: 1 })}>{dec.title}</span>
                <span style={{ fontSize: 10, color: BX.DRIFTWOOD, flexShrink: 0 }}>{fmtAgo(dec.created_at)}</span>
              </div>
              {dec.owner_note && (
                <div style={bodyText({ fontSize: 11, marginTop: 5, color: BX.GRAPHITE })}>Owner: {dec.owner_note}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Check-in history */}
      <div style={card()}>
        <div style={{ padding: "13px 18px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Check-in history</span>
        </div>
        {data.check_ins.length === 0 && <div style={bodyText({ padding: "16px 18px", color: BX.DRIFTWOOD, fontSize: 12 })}>No check-ins yet.</div>}
        {data.check_ins.map(c => (
          <div key={c.id} style={{ padding: "11px 18px", borderBottom: `1px solid ${BX.STONE}` }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <span style={tag(statusColor(c.status))}>{c.status.toUpperCase()}</span>
              <span style={{ fontSize: 10, color: BX.DRIFTWOOD, marginLeft: "auto" }}>{new Date(c.created_at).toLocaleDateString()} · {fmtAgo(c.created_at)}</span>
            </div>
            {c.note && <div style={bodyText({ fontSize: 12, marginTop: 6 })}>{c.note}</div>}
          </div>
        ))}
      </div>

      </>}

      {showCheckIn && (
        <CheckInModal domainId={me.user.role === "owner" ? d.id : undefined}
          onDone={() => { setShowCheckIn(false); load(); }}
          onClose={() => setShowCheckIn(false)} />
      )}
    </div>
  );
}

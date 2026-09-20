import { useState, useEffect, useCallback } from "react";
import { THEMES } from "./themes.js";
import { api } from "./lib/api.js";
import { BX, label, serifH } from "./lib/boxx.js";
import LoginView from "./views/LoginView.jsx";
import PinChangeView from "./views/PinChangeView.jsx";
import HubOverview from "./views/HubOverview.jsx";
import DomainView from "./views/DomainView.jsx";
import TeamView from "./views/TeamView.jsx";
import CheckInModal from "./components/CheckInModal.jsx";
import SettingsModal from "./modals/SettingsModal.jsx";

// ─── Local storage — UI preferences only ──────────────────────────────────────
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

const HUB_NAV = [
  { id: "overview", label: "Overview",  ownerOnly: true },
  { id: "mydomain", label: "My Domain", memberOnly: true },
  { id: "team",     label: "Team" },
];

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const fn = e => setMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return mobile;
}

// Every member's card is a tabbed workspace (DomainView); the hub shell here
// only handles auth, navigation between cards, and settings.
export default function App() {
  const [me, setMe] = useState(null);                 // { user, domain } | null
  const [authChecked, setAuthChecked] = useState(false);
  const isMobile = useIsMobile();

  const [settings,     setSettingsState] = useState(() => lsGet("crumbs:settings", { storeName: "Boxx Coffee" }));
  const [pinGate,      setPinGate]       = useState(null);   // { pinUsed? } while a PIN change is required
  const [activeNav,    setActiveNav]     = useState("team");
  const [openDomainId, setOpenDomainId]  = useState(null);   // domain drill-down
  const [showSettings, setShowSettings]  = useState(false);
  const [showCheckIn,  setShowCheckIn]   = useState(false);
  const [showMore,     setShowMore]      = useState(false);

  const T = THEMES.boxx;
  const isOwner = me?.user?.role === "owner";

  // ── Auth boot ────────────────────────────────────────────────────────────────
  const afterLogin = useCallback(async (user, loginInfo) => {
    let domain = null, mustChange = loginInfo?.mustChangePin;
    try {
      const d = await api.get("/api/auth/me");
      domain = d.domain;
      if (mustChange === undefined) mustChange = d.must_change_pin;
    } catch {}
    setMe({ user, domain });
    setPinGate(mustChange ? { pinUsed: loginInfo?.pinUsed } : null);
    setActiveNav(user.role === "owner" ? "overview" : "mydomain");
    setOpenDomainId(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.get("/api/auth/me");
        await afterLogin(d.user);
      } catch { /* not signed in */ }
      setAuthChecked(true);
    })();
    const onAuthRequired = () => setMe(null);
    window.addEventListener("boxx:auth-required", onAuthRequired);
    return () => window.removeEventListener("boxx:auth-required", onAuthRequired);
  }, []);

  const logout = async () => {
    try { await api.post("/api/auth/logout"); } catch {}
    setMe(null);
    setShowMore(false);
  };

  const handleSaveSettings = s => { setSettingsState(s); lsSet("crumbs:settings", s); };
  const openDomain = (id) => { setOpenDomainId(id); setActiveNav("domain"); };

  if (!authChecked) return <div style={{ minHeight: "100vh", background: BX.PARCHMENT }} />;
  if (!me) return <LoginView onLogin={afterLogin} />;
  if (pinGate) return (
    <PinChangeView userName={me.user.name} currentPin={pinGate.pinUsed} forced
      onDone={() => setPinGate(null)} />
  );

  const titleFor = (id) =>
    id === "overview" ? "Overview"
    : id === "mydomain" ? (me.domain?.name || "My Domain")
    : id === "team" ? "Team"
    : "";

  const content = (
    <>
      {activeNav === "overview" && isOwner && (
        <HubOverview onOpenDomain={openDomain} isMobile={isMobile} T={T} />
      )}
      {activeNav === "mydomain" && me.domain && (
        <DomainView domainId={me.domain.id} me={me} isMobile={isMobile} />
      )}
      {activeNav === "domain" && openDomainId && (
        <>
          <button onClick={() => { setOpenDomainId(null); setActiveNav("team"); }}
            style={{ background: "none", border: `1px solid ${BX.LINEN}`, cursor: "pointer",
              padding: "8px 14px", marginBottom: 14, ...label({ fontSize: 9, color: BX.GRAPHITE }) }}>
            ← Team
          </button>
          <DomainView domainId={openDomainId} me={me} isMobile={isMobile} />
        </>
      )}
      {activeNav === "team" && <TeamView onOpenDomain={openDomain} isMobile={isMobile} />}
    </>
  );

  // ── Mobile: header + content + bottom tabs ───────────────────────────────────
  if (isMobile) {
    const tabs = isOwner
      ? [{ id: "overview", label: "OVERVIEW" }, { id: "team", label: "TEAM" }, { id: "more", label: "MORE" }]
      : [{ id: "mydomain", label: "DOMAIN" }, { id: "checkin", label: "CHECK-IN" }, { id: "team", label: "TEAM" }, { id: "more", label: "MORE" }];
    const tapTab = (id) => {
      if (id === "checkin") return setShowCheckIn(true);
      if (id === "more") return setShowMore(true);
      setOpenDomainId(null);
      setActiveNav(id);
    };
    const activeTab = activeNav === "domain" ? (isOwner ? "team" : "mydomain") : activeNav;

    return (
      <div style={{ minHeight: "100vh", background: BX.PARCHMENT, display: "flex", flexDirection: "column", fontFamily: BX.MONO }}>
        <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex",
          justifyContent: "space-between", alignItems: "baseline", position: "sticky", top: 0, background: BX.PARCHMENT, zIndex: 50 }}>
          <span style={serifH(18)}>{activeNav === "domain" ? "Team" : titleFor(activeNav) || "Boxx Hub"}</span>
          <span style={label({ fontSize: 8 })}>{me.user.name.toUpperCase()}</span>
        </div>
        <div style={{ flexGrow: 1, padding: "16px 16px 90px" }}>{content}</div>

        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 64, background: BX.PARCHMENT,
          borderTop: `1px solid ${BX.LINEN}`, display: "flex", zIndex: 100 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => tapTab(t.id)}
              style={{ flexGrow: 1, background: "none", border: "none", cursor: "pointer",
                borderTop: activeTab === t.id ? `2px solid ${BX.INK}` : "2px solid transparent", marginTop: -1,
                fontFamily: BX.MONO, fontWeight: 400, fontSize: 9, letterSpacing: "0.14em",
                color: activeTab === t.id ? BX.INK : BX.DRIFTWOOD }}>
              {t.label}
            </button>
          ))}
        </div>

        {showMore && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(26,25,22,0.5)", zIndex: 300,
            display: "flex", alignItems: "flex-end" }} onClick={e => e.target === e.currentTarget && setShowMore(false)}>
            <div style={{ background: BX.PARCHMENT, width: "100%", padding: "20px 20px 32px", borderTop: `1px solid ${BX.LINEN}` }}>
              <button onClick={() => { setShowSettings(true); setShowMore(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "13px 4px", background: "none",
                  border: "none", borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer",
                  fontFamily: BX.MONO, fontWeight: 400, fontSize: 14, color: BX.INK }}>
                Settings
              </button>
              <button onClick={logout}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "13px 4px", background: "none",
                  border: "none", cursor: "pointer", fontFamily: BX.MONO, fontWeight: 400, fontSize: 12,
                  letterSpacing: "0.12em", textTransform: "uppercase", color: BX.RUST }}>
                Sign out
              </button>
            </div>
          </div>
        )}

        {showCheckIn && (
          <CheckInModal onDone={() => setShowCheckIn(false)} onClose={() => setShowCheckIn(false)} />
        )}
        {showSettings && <SettingsModal settings={settings} me={me} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} T={T} />}
      </div>
    );
  }

  // ── Desktop: sidebar layout ──────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.BG, color: T.TEXT, fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}} * { box-sizing: border-box; }`}</style>

      {/* Sidebar */}
      <aside style={{ width: 224, background: T.SIDEBAR, borderRight: `1px solid ${T.BORDER}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 22px 18px", borderBottom: `1px solid ${T.BORDER}` }}>
          <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 20, color: T.TEXT }}>Boxx Hub</div>
          <div style={{ color: T.DIM, fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", marginTop: 5, fontWeight: 400 }}>
            Coffee Roasters Co.
          </div>
        </div>

        <nav style={{ padding: "14px 12px 4px" }}>
          <div style={{ color: T.DIM, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", padding: "0 12px 8px", fontWeight: 400 }}>Hub</div>
          {HUB_NAV.filter(n => (!n.ownerOnly || isOwner) && (!n.memberOnly || !isOwner)).map(({ id, label: lbl }) => (
            <div key={id} onClick={() => { setOpenDomainId(null); setActiveNav(id); }}
              style={{ padding: "10px 12px", cursor: "pointer", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase",
                fontWeight: 400, background: activeNav === id ? T.TEXT : "transparent",
                color: activeNav === id ? T.BG : T.DIM, marginBottom: 2 }}>
              {lbl}
            </div>
          ))}
        </nav>

        <div style={{ marginTop: "auto", padding: "12px 12px", borderTop: `1px solid ${T.BORDER}` }}>
          <div onClick={() => setShowSettings(true)} style={{ padding: "9px 12px", cursor: "pointer", color: T.DIM, fontSize: 12 }}>
            Settings
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px" }}>
            <span style={{ color: T.DIM, fontSize: 11 }}>{me.user.name}</span>
            <button onClick={logout} style={{ background: "none", border: "none", cursor: "pointer", color: BX.RUST,
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 400 }}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ borderBottom: `1px solid ${T.BORDER}`, padding: "0 32px", height: 58,
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: T.CARD }}>
          <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 19, color: T.TEXT }}>
            {activeNav === "domain" ? "Team / Domain" : titleFor(activeNav)}
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
          {content}
        </div>
      </div>

      {showSettings && <SettingsModal settings={settings} me={me} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} T={T} />}
    </div>
  );
}

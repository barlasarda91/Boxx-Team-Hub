import { useState, useEffect, useCallback } from "react";
import { THEMES } from "./themes.js";
import { getLastCompletedMonday, formatWeekLabel } from "./lib/dates.js";
import { api, checkProxy } from "./lib/api.js";
import { squareFetchOrders, flattenOrders, extractOdeko } from "./lib/square.js";
import { analyzeWeek, getActiveOrders } from "./lib/orders.js";
import { BX, label, serifH } from "./lib/boxx.js";
import LoginView from "./views/LoginView.jsx";
import PinChangeView from "./views/PinChangeView.jsx";
import HubOverview from "./views/HubOverview.jsx";
import DomainView from "./views/DomainView.jsx";
import TeamView from "./views/TeamView.jsx";
import DashboardView from "./views/DashboardView.jsx";
import ItemsView from "./views/ItemsView.jsx";
import OdekoView from "./views/OdekoView.jsx";
import ExpensesView from "./views/ExpensesView.jsx";
import InvoicesView from "./views/InvoicesView.jsx";
import CheckInModal from "./components/CheckInModal.jsx";
import VendorUploadModal from "./modals/VendorUploadModal.jsx";
import SettingsModal from "./modals/SettingsModal.jsx";
import EventsModal from "./modals/EventsModal.jsx";
import ReportModal from "./modals/ReportModal.jsx";

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

const ANALYTICS_NAV = [
  { id: "dashboard", label: "Dashboard" },
  { id: "items",     label: "Item Detail" },
  { id: "odeko",     label: "Odeko" },
  { id: "expenses",  label: "Expenses" },
  { id: "invoices",  label: "Invoices" },
];

const ODEKO_CATEGORY = "Dis Burrito";

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

export default function App() {
  const [me, setMe] = useState(null);                 // { user, domain } | null
  const [authChecked, setAuthChecked] = useState(false);
  const isMobile = useIsMobile();

  const [settings,       setSettingsState]       = useState(() => lsGet("crumbs:settings", { storeName: "Boxx Coffee" }));
  const [pinGate,        setPinGate]             = useState(null);   // { pinUsed? } while a PIN change is required
  const [standingOrders, setStandingOrdersState] = useState({});
  const [ordersHistory,  setOrdersHistoryState]  = useState([]);
  const [ordersLoaded,   setOrdersLoaded]        = useState(false);
  const [weekData,       setWeekData]            = useState([]);
  const [weekLabel,      setWeekLabel]           = useState(null);
  const [activeNav,      setActiveNav]           = useState("team");
  const [openDomainId,   setOpenDomainId]        = useState(null);   // domain drill-down
  const [vendorFilter,   setVendorFilter]        = useState("all");
  const [showSettings,   setShowSettings]        = useState(false);
  const [showVendors,    setShowVendors]         = useState(false);
  const [showCheckIn,    setShowCheckIn]         = useState(false);
  const [showMore,       setShowMore]            = useState(false);
  const [syncStatus,     setSyncStatus]          = useState(null);
  const [syncing,        setSyncing]             = useState(false);
  const [proxyUp,        setProxyUp]             = useState(null);
  const [showReport,     setShowReport]          = useState(false);
  const [showEvents,     setShowEvents]          = useState(false);
  const [odekoData,      setOdekoData]           = useState([]);
  const [pendingInvoices, setPendingInvoices]    = useState(0);

  const T       = THEMES.boxx;
  const monday  = getLastCompletedMonday();
  const vendors = [...new Set(Object.values(standingOrders).map(v => v.vendor))].filter(Boolean);

  const isOwner = me?.user?.role === "owner";
  // Analytics lives fully under Ben's Supplies domain; the owner reads it
  // through Ben's check-ins and reports.
  const canSeeAnalytics = me?.user?.name === "Ben";

  // ── Analytics boot (unchanged behavior, now behind auth) ────────────────────
  const loadStandingOrders = useCallback(async () => {
    const data = await api.get("/api/standing-orders/history");
    const history = (data.versions || []).map(v => ({ effectiveDate: v.effectiveDate, orders: v.orders }));
    setOrdersHistoryState(history);
    const active = getActiveOrders(history, monday) || {};
    const current = Object.keys(active).length ? active : (history[0]?.orders || {});
    setStandingOrdersState(current);
    setOrdersLoaded(true);
    return { history, current };
  }, [monday]);

  const refreshPendingCount = useCallback(async () => {
    try {
      const data = await api.get("/api/invoices?status=pending_review");
      setPendingInvoices((data.invoices || []).length);
    } catch {}
  }, []);

  const pullFromSquare = useCallback(async (orders, history) => {
    setSyncing(true);
    setSyncStatus({ type: "info", msg: "Pulling last week's transactions from Square…" });
    try {
      const labelTxt   = formatWeekLabel(monday);
      const rawOrders  = await squareFetchOrders(monday);
      const txByDate   = flattenOrders(rawOrders);
      const activeOrds = history.length > 0 ? getActiveOrders(history, monday) : orders;
      setWeekData(analyzeWeek(activeOrds, txByDate, monday, history));
      setWeekLabel(labelTxt);
      try { setOdekoData(extractOdeko(rawOrders, ODEKO_CATEGORY)); } catch {}
      setSyncStatus({ type: "success", msg: `${rawOrders.length} orders synced for ${labelTxt}` });
    } catch (err) {
      setSyncStatus({ type: "error", msg: `Error: ${err.message}` });
    } finally {
      setSyncing(false);
    }
  }, [monday]);

  const bootAnalytics = useCallback(async () => {
    const up = await checkProxy();
    setProxyUp(up);
    if (!up) return;
    refreshPendingCount();
    try {
      const loaded = await loadStandingOrders();
      if (Object.keys(loaded.current).length > 0) pullFromSquare(loaded.current, loaded.history);
      else setSyncStatus({ type: "warn", msg: "Upload vendor standing orders to define daily item targets." });
    } catch (err) {
      setSyncStatus({ type: "error", msg: `Could not load standing orders: ${err.message}` });
    }
  }, [loadStandingOrders, pullFromSquare, refreshPendingCount]);

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
    if (user.name === "Ben") bootAnalytics();
    else setProxyUp(true);
  }, [bootAnalytics]);

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
  const handleSaveOrders = async (orders, effectiveDate) => {
    await api.post("/api/standing-orders", { effective_date: effectiveDate, orders });
    const loaded = await loadStandingOrders();
    if (proxyUp) pullFromSquare(loaded.current, loaded.history);
  };
  const openDomain = (id) => { setOpenDomainId(id); setActiveNav("domain"); };

  if (!authChecked) return <div style={{ minHeight: "100vh", background: BX.PARCHMENT }} />;
  if (!me) return <LoginView onLogin={afterLogin} />;
  if (pinGate) return (
    <PinChangeView userName={me.user.name} currentPin={pinGate.pinUsed} forced
      onDone={() => setPinGate(null)} />
  );

  const hasData   = weekData.length > 0;
  const hasOrders = Object.keys(standingOrders).length > 0;

  const navItems = [
    ...HUB_NAV.filter(n => (!n.ownerOnly || isOwner) && (!n.memberOnly || !isOwner)),
    ...(canSeeAnalytics ? ANALYTICS_NAV : []),
  ];

  const titleFor = (id) =>
    id === "overview" ? "Overview"
    : id === "mydomain" ? (me.domain?.name || "My Domain")
    : id === "team" ? "Team"
    : id === "domain" ? ""
    : ANALYTICS_NAV.find(n => n.id === id)?.label || "";

  const content = (
    <>
      {activeNav === "overview" && isOwner && (
        <HubOverview onOpenDomain={openDomain} isMobile={isMobile} T={T} />
      )}
      {activeNav === "mydomain" && me.domain && (
        <DomainView domainId={me.domain.id} me={me} isMobile={isMobile} />
      )}
      {activeNav === "domain" && openDomainId && (
        <DomainView domainId={openDomainId} me={me} isMobile={isMobile} />
      )}
      {activeNav === "team" && <TeamView onOpenDomain={openDomain} isMobile={isMobile} />}

      {activeNav === "dashboard" && canSeeAnalytics && (
        hasData
          ? <DashboardView weekData={weekData} weekLabel={weekLabel} vendorFilter={vendorFilter} vendors={vendors} monday={monday} T={T} />
          : <div style={{ textAlign: "center", padding: "80px 0", color: T.DIM }}>
              <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 30, marginBottom: 14, color: T.DIM }}>
                {!proxyUp ? "Server not reachable" : !hasOrders ? "Upload vendor orders to begin" : "Pulling data…"}
              </div>
              {proxyUp && ordersLoaded && !hasOrders &&
                <button onClick={() => setShowVendors(true)}
                  style={{ padding: "12px 28px", background: T.ACCENT, border: "none", color: T.BG, cursor: "pointer", fontSize: 13 }}>
                  Upload Vendor Orders
                </button>}
            </div>
      )}
      {activeNav === "items" && canSeeAnalytics && (
        hasData ? <ItemsView weekData={weekData} vendorFilter={vendorFilter} vendors={vendors} T={T} />
        : <div style={{ textAlign: "center", padding: "80px 0", color: T.DIM }}>No data yet</div>
      )}
      {activeNav === "odeko" && canSeeAnalytics && (
        weekLabel ? <OdekoView odekoData={odekoData} weekLabel={weekLabel} monday={monday} T={T} />
        : <div style={{ textAlign: "center", padding: "80px 0", color: T.DIM }}>No data yet</div>
      )}
      {activeNav === "expenses" && canSeeAnalytics && (
        <ExpensesView onOpenInvoices={() => setActiveNav("invoices")} T={T} />
      )}
      {activeNav === "invoices" && canSeeAnalytics && <InvoicesView T={T} />}
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
              {canSeeAnalytics && ANALYTICS_NAV.map(n => (
                <button key={n.id} onClick={() => { setActiveNav(n.id); setShowMore(false); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "13px 4px", background: "none",
                    border: "none", borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer",
                    fontFamily: BX.MONO, fontWeight: 300, fontSize: 14, color: BX.INK }}>
                  {n.label}
                </button>
              ))}
              <button onClick={() => { setShowSettings(true); setShowMore(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "13px 4px", background: "none",
                  border: "none", borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer",
                  fontFamily: BX.MONO, fontWeight: 300, fontSize: 14, color: BX.INK }}>
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
  const SC = {
    info:    { bg: "#EFEAD9", bo: BX.LINEN, co: BX.GRAPHITE },
    warn:    { bg: "#F0E7D2", bo: "#D9BE94", co: BX.AMBER },
    error:   { bg: "#F0DFD8", bo: "#D8AFA5", co: BX.RUST },
    success: { bg: "#E8E9DA", bo: "#C6CBAA", co: BX.OLIVE },
  };

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

        {canSeeAnalytics && (
          <nav style={{ padding: "14px 12px 4px", borderTop: `1px solid ${T.BORDER}`, marginTop: 12 }}>
            <div style={{ color: T.DIM, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", padding: "0 12px 8px", fontWeight: 400 }}>Analytics</div>
            {ANALYTICS_NAV.map(({ id, label: lbl }) => (
              <div key={id} onClick={() => { setOpenDomainId(null); setActiveNav(id); if (id === "invoices" || id === "expenses") refreshPendingCount(); }}
                style={{ padding: "9px 12px", cursor: "pointer", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase",
                  fontWeight: 400, display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: activeNav === id ? T.TEXT : "transparent",
                  color: activeNav === id ? T.BG : T.DIM, marginBottom: 2 }}>
                <span>{lbl}</span>
                {id === "invoices" && pendingInvoices > 0 && (
                  <span style={{ fontSize: 9, background: activeNav === id ? T.BG : T.TEXT, color: activeNav === id ? T.TEXT : T.BG, padding: "1px 7px", fontWeight: 400 }}>
                    {pendingInvoices}
                  </span>
                )}
              </div>
            ))}
          </nav>
        )}

        <div style={{ marginTop: "auto", padding: "12px 12px", borderTop: `1px solid ${T.BORDER}` }}>
          {canSeeAnalytics && (
            <>
              <div onClick={() => setShowVendors(true)}
                style={{ padding: "9px 12px", cursor: "pointer", color: T.DIM, fontSize: 12 }}>
                Vendor Orders {ordersLoaded && !hasOrders && <span style={{ color: BX.RUST }}>·</span>}
              </div>
              {proxyUp && hasOrders && (
                <div onClick={() => !syncing && pullFromSquare(standingOrders, ordersHistory)}
                  style={{ padding: "9px 12px", cursor: syncing ? "default" : "pointer", color: T.DIM, fontSize: 12 }}>
                  {syncing ? "Syncing…" : "Refresh Square"}
                </div>
              )}
              {hasData && (
                <div onClick={() => setShowReport(true)} style={{ padding: "9px 12px", cursor: "pointer", color: T.DIM, fontSize: 12 }}>
                  Weekly Report
                </div>
              )}
              <div onClick={() => setShowEvents(true)} style={{ padding: "9px 12px", cursor: "pointer", color: T.DIM, fontSize: 12 }}>
                Upcoming Events
              </div>
            </>
          )}
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
          {weekLabel && canSeeAnalytics && <div style={{ color: T.DIM, fontSize: 10, letterSpacing: "0.14em" }}>{weekLabel.toUpperCase()}</div>}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
          {syncStatus && syncStatus.type !== "success" && ["dashboard", "items", "odeko"].includes(activeNav) && (
            <div style={{ marginBottom: 20, padding: "11px 18px", fontSize: 12,
              background: SC[syncStatus.type]?.bg, border: `1px solid ${SC[syncStatus.type]?.bo}`, color: SC[syncStatus.type]?.co }}>
              {syncStatus.msg}
            </div>
          )}
          {content}
        </div>
      </div>

      {showSettings && <SettingsModal settings={settings} me={me} onSave={handleSaveSettings} onClose={() => { setShowSettings(false); refreshPendingCount(); }} T={T} />}
      {showVendors  && <VendorUploadModal existingOrders={standingOrders} onSave={handleSaveOrders} onClose={() => setShowVendors(false)} T={T} ordersHistory={ordersHistory} />}
      {showEvents   && <EventsModal onClose={() => setShowEvents(false)} T={T} />}
      {showReport   && <ReportModal weekData={weekData} weekLabel={weekLabel} storeName={settings.storeName} vendors={vendors} odekoData={odekoData} monday={monday} onClose={() => setShowReport(false)} />}
    </div>
  );
}

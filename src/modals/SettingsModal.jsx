import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { BX, label, eyebrow, tag, card, serifH, bodyText, btnPrimary, btnGhost, inputBx } from "../lib/boxx.js";

// Settings, in the house style: parchment, square corners, mono labels.
// Tabs are scoped by role — the owner sees everything including Costs;
// Ben sees the supplies plumbing; everyone else changes their PIN.

function tabsFor(me) {
  if (me?.user?.role === "owner") return ["General", "Costs", "Gmail", "Vendors", "Consumables", "Alerts & Drinks", "Team PINs", "My PIN"];
  if (me?.user?.name === "Ben") return ["General", "Gmail", "Vendors", "Consumables", "Alerts & Drinks", "My PIN"];
  return ["My PIN"];
}

const sectionTitle = (text, extra) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
    <span style={eyebrow()}>{text}</span>
    {extra && <span style={label({ fontSize: 8 })}>{extra}</span>}
  </div>
);

const note = (text) => (
  <div style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD, marginTop: 8 })}>{text}</div>
);

const fieldLabel = (text) => (
  <div style={label({ fontSize: 8, marginBottom: 6 })}>{text}</div>
);

// ─── Costs tab (owner) ────────────────────────────────────────────────────────
// Metered from real Claude API usage per call; hosting is an owner-entered
// monthly estimate. The point: in a month, the biggest line here is the first
// candidate for a native (non-Claude) replacement.
const PURPOSE_LABELS = {
  invoice_extract: "Invoice PDF reading",
  order_image: "Standing order photo reading",
  swap_parse: "Shift swap parsing",
};
const fmtUsd = (v) => v == null ? "—" : `$${v.toFixed(v < 10 ? 2 : 0)}`;
const fmtTok = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v || 0);

function CostsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [hostDraft, setHostDraft] = useState("");
  const load = useCallback(() => api.get("/api/costs").then(d => {
    setData(d); setHostDraft(d.hosting_monthly_usd ?? "");
  }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST })}>{error}</div>;
  if (!data) return <div style={bodyText({ color: BX.DRIFTWOOD })}>Loading…</div>;

  const saveHosting = async () => {
    try {
      await api.patch("/api/settings", { hosting_monthly_usd: hostDraft === "" ? null : Number(hostDraft) });
      load();
    } catch (err) { setError(err.message); }
  };

  const thisMonth = data.monthly[0];
  const hosting = data.hosting_monthly_usd;
  const cell = { padding: "8px 12px", borderBottom: `1px solid ${BX.STONE}`, fontSize: 11 };
  const th = { ...label({ fontSize: 8 }), padding: "8px 12px", borderBottom: `1px solid ${BX.LINEN}`, textAlign: "left" };
  const right = { textAlign: "right" };

  return (
    <div>
      {/* Tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 14 }}>
        {[
          ["LAST 30 DAYS · CLAUDE", fmtUsd(data.last_30d.cost_usd), `${data.last_30d.calls} calls`],
          ["THIS MONTH · CLAUDE", fmtUsd(thisMonth?.cost_usd ?? 0), thisMonth ? `${thisMonth.calls} calls` : "no calls yet"],
          ["HOSTING / MONTH", hosting != null ? fmtUsd(hosting) : "not set", "Railway, entered below"],
          ["EST. MONTHLY TOTAL", fmtUsd((thisMonth?.cost_usd ?? 0) + (hosting ?? 0)), hosting == null ? "excl. hosting" : "Claude + hosting"],
        ].map(([l, big, sub]) => (
          <div key={l} style={card({ padding: "12px 14px" })}>
            <div style={label({ fontSize: 7 })}>{l}</div>
            <div style={{ fontFamily: BX.SERIF, fontSize: 20, margin: "6px 0 2px" }}>{big}</div>
            <div style={{ fontSize: 9, color: BX.DRIFTWOOD }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Where the Claude money goes */}
      <div style={card({ marginBottom: 8 })}>
        <div style={{ padding: "11px 14px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between" }}>
          <span style={eyebrow()}>Claude usage · last 30 days</span>
          <span style={label({ fontSize: 8 })}>METERED PER CALL</span>
        </div>
        {data.last_30d.by_purpose.length === 0 && (
          <div style={bodyText({ padding: "14px", fontSize: 12, color: BX.DRIFTWOOD })}>
            No Claude calls yet. They start when invoices, order photos, or swap requests come in.
          </div>
        )}
        {data.last_30d.by_purpose.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>WHAT</th>
              <th style={{ ...th, ...right }}>CALLS</th>
              <th style={{ ...th, ...right }}>TOKENS IN</th>
              <th style={{ ...th, ...right }}>TOKENS OUT</th>
              <th style={{ ...th, ...right }}>COST</th>
            </tr></thead>
            <tbody>
              {data.last_30d.by_purpose.map(p => (
                <tr key={p.purpose}>
                  <td style={{ ...cell, fontFamily: BX.SERIF, fontSize: 12 }}>{PURPOSE_LABELS[p.purpose] || p.purpose}</td>
                  <td style={{ ...cell, ...right }}>{p.calls}</td>
                  <td style={{ ...cell, ...right }}>{fmtTok(p.input_tokens)}</td>
                  <td style={{ ...cell, ...right }}>{fmtTok(p.output_tokens)}</td>
                  <td style={{ ...cell, ...right, fontWeight: 500 }}>${p.cost_usd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Month by month */}
      {data.monthly.length > 0 && (
        <div style={card({ marginBottom: 8 })}>
          <div style={{ padding: "11px 14px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={eyebrow()}>Month by month</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>MONTH</th>
              <th style={{ ...th, ...right }}>CALLS</th>
              <th style={{ ...th, ...right }}>CLAUDE</th>
              <th style={{ ...th, ...right }}>HOSTING</th>
              <th style={{ ...th, ...right }}>TOTAL</th>
            </tr></thead>
            <tbody>
              {data.monthly.map(m => (
                <tr key={m.month}>
                  <td style={{ ...cell, letterSpacing: "0.08em" }}>{m.month}</td>
                  <td style={{ ...cell, ...right }}>{m.calls}</td>
                  <td style={{ ...cell, ...right }}>${m.cost_usd.toFixed(2)}</td>
                  <td style={{ ...cell, ...right, color: BX.DRIFTWOOD }}>{hosting != null ? fmtUsd(hosting) : "—"}</td>
                  <td style={{ ...cell, ...right, fontWeight: 500 }}>{fmtUsd(m.cost_usd + (hosting ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Hosting estimate + free services */}
      <div style={card({ padding: "13px 14px", marginBottom: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" })}>
        <div>
          <div style={label({ fontSize: 8 })}>HOSTING ESTIMATE · $/MONTH</div>
          <div style={{ fontSize: 10, color: BX.DRIFTWOOD, marginTop: 3 }}>From your Railway billing page — the app can't see it.</div>
        </div>
        <input value={hostDraft} inputMode="decimal" placeholder="e.g. 5"
          onChange={e => setHostDraft(e.target.value.replace(/[^0-9.]/g, ""))}
          style={inputBx({ width: 90, marginLeft: "auto", textAlign: "center", fontSize: 12, padding: "8px 10px" })} />
        <button onClick={saveHosting} style={btnPrimary({ padding: "9px 16px", fontSize: 9 })}>Save</button>
      </div>

      {note("Square API and Gmail API are free at this usage. Claude is the only per-use cost, metered above from each call's real token count. The biggest line after a month of real use is the first candidate for a native, no-Claude replacement.")}
    </div>
  );
}

// ─── Team PINs (owner) ────────────────────────────────────────────────────────
function TeamPinsTab() {
  const [users, setUsers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => api.get("/api/users").then(d => setUsers(d.users)).catch(e => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const reset = async (id, name) => {
    const pin = drafts[id];
    if (!/^\d{4,6}$/.test(pin || "")) return setMsg("PIN must be 4-6 digits");
    try {
      await api.post(`/api/users/${id}/reset-pin`, { new_pin: pin });
      setMsg(`${name}'s PIN reset — they'll pick their own at next sign-in.`);
      setDrafts(d => ({ ...d, [id]: "" }));
    } catch (err) { setMsg(err.message); }
  };

  return (
    <div>
      {note("Resetting a PIN signs that person out everywhere and asks them to choose a new one at next sign-in.")}
      <div style={{ marginTop: 10 }}>
        {users.map(u => (
          <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
            borderBottom: `1px solid ${BX.STONE}` }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 14, width: 110 }}>{u.name}</span>
            <span style={tag()}>{u.role.toUpperCase()}</span>
            <input value={drafts[u.id] || ""} inputMode="numeric" maxLength={6} placeholder="new PIN"
              onChange={e => setDrafts(d => ({ ...d, [u.id]: e.target.value.replace(/\D/g, "") }))}
              style={inputBx({ width: 96, marginLeft: "auto", textAlign: "center", fontSize: 12, padding: "8px 10px" })} />
            <button onClick={() => reset(u.id, u.name)} style={btnGhost({ padding: "9px 14px", fontSize: 9 })}>Reset</button>
          </div>
        ))}
      </div>
      {msg && <div style={{ marginTop: 12, color: BX.AMBER, fontSize: 12 }}>{msg}</div>}
    </div>
  );
}

// ─── My PIN ───────────────────────────────────────────────────────────────────
function MyPinTab() {
  const [current, setCurrent] = useState("");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [msg, setMsg] = useState(null);

  const save = async () => {
    if (pin1 !== pin2) return setMsg("PINs don't match");
    try {
      await api.post("/api/auth/change-pin", { current_pin: current, new_pin: pin1 });
      setMsg("PIN changed.");
      setCurrent(""); setPin1(""); setPin2("");
    } catch (err) { setMsg(err.message); }
  };

  const field = (lbl, val, set) => (
    <label style={{ display: "block", marginBottom: 14 }}>
      {fieldLabel(lbl)}
      <input type="password" inputMode="numeric" maxLength={6} value={val}
        onChange={e => set(e.target.value.replace(/\D/g, ""))}
        style={inputBx({ width: 160, textAlign: "center", letterSpacing: "0.3em" })} />
    </label>
  );

  const ready = current.length >= 4 && pin1.length >= 4 && pin1 === pin2;
  return (
    <div>
      {field("CURRENT PIN", current, setCurrent)}
      {field("NEW PIN · 4-6 DIGITS", pin1, setPin1)}
      {field("NEW PIN AGAIN", pin2, setPin2)}
      <button onClick={save} disabled={!ready} style={btnPrimary({ opacity: ready ? 1 : 0.4 })}>Change PIN</button>
      {msg && <div style={{ marginTop: 12, color: msg === "PIN changed." ? BX.OLIVE : BX.RUST, fontSize: 12 }}>{msg}</div>}
    </div>
  );
}

// ─── Gmail ────────────────────────────────────────────────────────────────────
function GmailTab() {
  const [status, setStatus] = useState(null);
  const [syncDays, setSyncDays] = useState(14);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(() => api.get("/api/gmail/status").then(setStatus).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const runSync = async () => {
    setSyncing(true); setMessage(null);
    try {
      const r = await api.post("/api/gmail/sync", { days: Number(syncDays) });
      setMessage(r.message || "Sync complete");
      load();
    } catch (err) { setMessage(`Sync failed: ${err.message}`); }
    finally { setSyncing(false); }
  };

  const disconnect = async () => { await api.post("/api/gmail/disconnect"); load(); };

  if (!status) return <div style={bodyText({ color: BX.DRIFTWOOD })}>Loading…</div>;

  return (
    <div>
      {!status.configured && (
        <div style={card({ padding: "12px 14px", marginBottom: 12, borderColor: BX.AMBER })}>
          <span style={bodyText({ fontSize: 12, color: BX.AMBER })}>
            Google OAuth is not configured on the server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
            GOOGLE_REDIRECT_URI in Railway, then redeploy.
          </span>
        </div>
      )}

      <div style={card({ padding: "14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" })}>
        <span style={tag(status.connected ? BX.OLIVE : BX.DRIFTWOOD)}>
          {status.connected ? "CONNECTED" : "NOT CONNECTED"}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: BX.SERIF, fontSize: 14 }}>
            {status.connected ? (status.account_email || "unknown account") : "Watching billing@ starts here"}
          </div>
          {status.last_sync && (
            <div style={{ fontSize: 10, color: BX.DRIFTWOOD, marginTop: 3 }}>
              Last sync {new Date(status.last_sync).toLocaleString()} · {status.last_status}
            </div>
          )}
        </div>
        {status.connected
          ? <button onClick={disconnect} style={btnGhost({ marginLeft: "auto", color: BX.RUST, borderColor: BX.RUST, fontSize: 9, padding: "9px 14px" })}>Disconnect</button>
          : <a href="/api/gmail/auth" style={{ ...btnPrimary({ marginLeft: "auto", fontSize: 9, padding: "10px 16px", opacity: status.configured ? 1 : 0.4 }), textDecoration: "none", display: "inline-block" }}>Connect Gmail</a>}
      </div>

      {status.connected && (
        <div style={card({ padding: "14px" })}>
          {sectionTitle("Manual sync")}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select value={syncDays} onChange={e => setSyncDays(e.target.value)} style={inputBx({ fontSize: 12, padding: "8px 10px" })}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days (backfill)</option>
            </select>
            <button onClick={runSync} disabled={syncing} style={btnPrimary({ fontSize: 9, padding: "10px 16px", opacity: syncing ? 0.5 : 1 })}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {message && <div style={{ color: BX.AMBER, fontSize: 12, marginTop: 10 }}>{message}</div>}
          {note("Emails matching vendor patterns with PDF attachments are staged as pending invoices — nothing confirms automatically. The watcher also checks every 2 hours, 7am to 7pm.")}
        </div>
      )}
    </div>
  );
}

// ─── Vendors ──────────────────────────────────────────────────────────────────
function VendorsTab() {
  const [vendors, setVendors] = useState([]);
  const [draft, setDraft] = useState({ name: "", kind: "supply", email_pattern: "" });
  const [error, setError] = useState(null);

  const load = useCallback(() => api.get("/api/vendors").then(d => setVendors(d.vendors)).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const patch = async (id, fields) => {
    try { await api.patch(`/api/vendors/${id}`, fields); load(); }
    catch (err) { setError(err.message); }
  };

  const add = async () => {
    if (!draft.name.trim()) return;
    try {
      await api.post("/api/vendors", { ...draft, email_pattern: draft.email_pattern || null });
      setDraft({ name: "", kind: "supply", email_pattern: "" });
      load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      {error && <div style={{ color: BX.RUST, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      {note("The email pattern is matched against the From address of incoming invoices (e.g. @shorelinesupply.com). Copy it from a real invoice email — Gmail sync only searches vendors that have one.")}
      <div style={{ margin: "12px 0" }}>
        {vendors.map(v => (
          <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
            borderBottom: `1px solid ${BX.STONE}`, opacity: v.active ? 1 : 0.45, flexWrap: "wrap" }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 14, width: 110 }}>{v.name}</span>
            <span style={tag(v.kind === "pastry" ? BX.OLIVE : BX.DRIFTWOOD)}>{v.kind.toUpperCase()}</span>
            <input defaultValue={v.email_pattern || ""} placeholder="email pattern — not set"
              onBlur={e => e.target.value !== (v.email_pattern || "") && patch(v.id, { email_pattern: e.target.value || null })}
              style={inputBx({ flexGrow: 1, minWidth: 160, fontSize: 12, padding: "8px 10px" })} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, ...label({ fontSize: 8 }) }}>
              ACTIVE
              <input type="checkbox" checked={!!v.active} onChange={e => patch(v.id, { active: e.target.checked ? 1 : 0 })} />
            </label>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          placeholder="New vendor name" style={inputBx({ flexGrow: 1, minWidth: 140, fontSize: 12, padding: "8px 10px" })} />
        <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))}
          style={inputBx({ fontSize: 12, padding: "8px 10px" })}>
          <option value="supply">supply</option>
          <option value="pastry">pastry</option>
        </select>
        <input value={draft.email_pattern} onChange={e => setDraft(d => ({ ...d, email_pattern: e.target.value }))}
          placeholder="email pattern (optional)" style={inputBx({ flexGrow: 1, minWidth: 140, fontSize: 12, padding: "8px 10px" })} />
        <button onClick={add} style={btnPrimary({ fontSize: 9, padding: "10px 16px", opacity: draft.name.trim() ? 1 : 0.4 })}>Add</button>
      </div>
    </div>
  );
}

// ─── Consumables ──────────────────────────────────────────────────────────────
function ConsumableEditor({ consumable, vendors, onSave, onCancel }) {
  const [c, setC] = useState(() => ({
    name: consumable?.name || "",
    method: consumable?.method || "rule",
    denominator: consumable?.denominator || "matching_item",
    rolling_window_days: consumable?.rolling_window_days || "",
    window_auto: consumable ? consumable.window_auto : 1,
    patterns: consumable?.patterns?.map(p => ({ ...p })) || [],
    rules: consumable?.rules?.map(r => ({ ...r })) || [],
  }));
  const set = (k, v) => setC(prev => ({ ...prev, [k]: v }));
  const setPattern = (i, k, v) => set("patterns", c.patterns.map((p, idx) => idx === i ? { ...p, [k]: v } : p));
  const setRule = (i, k, v) => set("rules", c.rules.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const inp = (extra) => inputBx({ fontSize: 12, padding: "8px 10px", ...extra });
  const dashedBtn = { padding: "6px 12px", background: "transparent", border: `1px dashed ${BX.LINEN}`,
    color: BX.OLIVE, cursor: "pointer", fontFamily: BX.MONO, fontSize: 10, marginBottom: 14 };

  return (
    <div style={card({ padding: 16, marginBottom: 12 })}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
        <label>{fieldLabel("NAME")}
          <input value={c.name} onChange={e => set("name", e.target.value)} placeholder="12oz Hot Cup" style={inp({ width: "100%" })} />
        </label>
        <label>{fieldLabel("METHOD")}
          <select value={c.method} onChange={e => set("method", e.target.value)} style={inp({ width: "100%" })}>
            <option value="rule">rule — usage from sales</option>
            <option value="statistical">statistical — spend ÷ volume</option>
          </select>
        </label>
        <label>{fieldLabel("COST SHOWN PER")}
          <select value={c.denominator} onChange={e => set("denominator", e.target.value)} style={inp({ width: "100%" })}>
            <option value="transaction">customer (transaction)</option>
            <option value="drink">drink</option>
            <option value="matching_item">matching item sold</option>
          </select>
        </label>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14, fontSize: 12, color: BX.DRIFTWOOD }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={!!c.window_auto} onChange={e => set("window_auto", e.target.checked ? 1 : 0)} />
          Auto window (3× median purchase gap)
        </label>
        {!c.window_auto && (
          <label>Window days
            <input type="number" min="7" max="365" value={c.rolling_window_days}
              onChange={e => set("rolling_window_days", e.target.value)} style={inp({ width: 70, marginLeft: 8 })} />
          </label>
        )}
      </div>

      {fieldLabel("INVOICE MATCH PATTERNS · SUBSTRING OF SKU OR DESCRIPTION")}
      {c.patterns.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input value={p.pattern} onChange={e => setPattern(i, "pattern", e.target.value)}
            placeholder="12 OZ HOT CUP" style={inp({ flex: 2 })} />
          <select value={p.vendor_id || ""} onChange={e => setPattern(i, "vendor_id", e.target.value ? Number(e.target.value) : null)}
            style={inp({ flex: 1 })}>
            <option value="">any vendor</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <input type="number" step="any" value={p.units_per_pack_override ?? ""}
            onChange={e => setPattern(i, "units_per_pack_override", e.target.value)}
            placeholder="units/pack override" style={inp({ width: 140 })} />
          <button onClick={() => set("patterns", c.patterns.filter((_, idx) => idx !== i))}
            style={{ background: "transparent", border: "none", color: BX.RUST, cursor: "pointer" }}>✕</button>
        </div>
      ))}
      <button onClick={() => set("patterns", [...c.patterns, { pattern: "", vendor_id: null, units_per_pack_override: "" }])}
        style={dashedBtn}>+ PATTERN</button>

      {c.method === "rule" && (
        <>
          {fieldLabel("USAGE RULES · WHICH SQUARE SALES USE THIS ITEM, AND HOW MANY EACH")}
          {c.rules.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <select value={r.match_type} onChange={e => setRule(i, "match_type", e.target.value)} style={inp({ width: 120 })}>
                <option value="category">category</option>
                <option value="item_name">item name</option>
                <option value="variation">variation</option>
              </select>
              <input value={r.match_value} onChange={e => setRule(i, "match_value", e.target.value)}
                placeholder="Hot Drinks" style={inp({ flex: 1 })} />
              <span style={{ fontSize: 11, color: BX.DRIFTWOOD }}>×</span>
              <input type="number" step="any" value={r.units_per_match}
                onChange={e => setRule(i, "units_per_match", e.target.value)} style={inp({ width: 64 })} />
              <button onClick={() => set("rules", c.rules.filter((_, idx) => idx !== i))}
                style={{ background: "transparent", border: "none", color: BX.RUST, cursor: "pointer" }}>✕</button>
            </div>
          ))}
          <button onClick={() => set("rules", [...c.rules, { match_type: "category", match_value: "", units_per_match: 1 }])}
            style={dashedBtn}>+ RULE</button>
          {note("Example: category \"Hot Drinks\" × 2 units each = every hot drink sold uses 2 cups (double-cupping).")}
        </>
      )}
      {c.method === "statistical" && note("Statistical items can't show a variance check — the rate comes from spend itself. They show drift over time only.")}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button onClick={onCancel} style={btnGhost({ fontSize: 9, padding: "10px 16px" })}>Cancel</button>
        <button onClick={() => onSave(c)} disabled={!c.name.trim()}
          style={btnPrimary({ fontSize: 9, padding: "10px 16px", opacity: c.name.trim() ? 1 : 0.4 })}>Save</button>
      </div>
    </div>
  );
}

function ConsumablesTab() {
  const [consumables, setConsumables] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [editing, setEditing] = useState(null);   // null | "new" | consumable object
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, v] = await Promise.all([api.get("/api/consumables"), api.get("/api/vendors")]);
      setConsumables(c.consumables || []);
      setVendors((v.vendors || []).filter(x => x.active));
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (data) => {
    try {
      const body = { ...data, rolling_window_days: data.rolling_window_days ? Number(data.rolling_window_days) : null };
      if (editing === "new") await api.post("/api/consumables", body);
      else await api.patch(`/api/consumables/${editing.id}`, body);
      setEditing(null);
      load();
    } catch (err) { setError(err.message); }
  };

  const deactivate = async (id) => {
    try { await api.del(`/api/consumables/${id}`); load(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div>
      {error && <div style={{ color: BX.RUST, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      {editing != null && (
        <ConsumableEditor consumable={editing === "new" ? null : editing} vendors={vendors}
          onSave={save} onCancel={() => setEditing(null)} />
      )}
      {editing == null && (
        <>
          {consumables.filter(c => c.active).map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
              borderBottom: `1px solid ${BX.STONE}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontFamily: BX.SERIF, fontSize: 14 }}>{c.name}</span>
                <span style={{ marginLeft: 10 }}><span style={tag(c.method === "rule" ? BX.OLIVE : BX.DRIFTWOOD)}>{c.method.toUpperCase()}</span></span>
                <div style={{ fontSize: 10, color: BX.DRIFTWOOD, marginTop: 3 }}>
                  {c.patterns.length} pattern{c.patterns.length !== 1 ? "s" : ""} · {c.rules.length} rule{c.rules.length !== 1 ? "s" : ""}
                  · window {c.rolling_window_days || "?"}d{c.window_auto ? " (auto)" : ""}
                </div>
              </div>
              <button onClick={() => setEditing(c)} style={btnGhost({ padding: "8px 14px", fontSize: 9 })}>Edit</button>
              <button onClick={() => deactivate(c.id)} style={btnGhost({ padding: "8px 14px", fontSize: 9, color: BX.RUST, borderColor: BX.RUST })}>Deactivate</button>
            </div>
          ))}
          <button onClick={() => setEditing("new")} style={btnPrimary({ marginTop: 14, fontSize: 9, padding: "10px 16px" })}>+ New consumable</button>
        </>
      )}
    </div>
  );
}

// ─── Alerts & Drinks ──────────────────────────────────────────────────────────
function AlertsTab() {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/api/settings").then(d => setSettings({
      price_alert_threshold_pct: d.settings.price_alert_threshold_pct,
      drink_categories: (d.settings.drink_categories || []).join(", "),
      drink_items: (d.settings.drink_items || []).join(", "),
    })).catch(e => setError(e.message));
  }, []);

  if (!settings) return <div style={bodyText({ color: BX.DRIFTWOOD })}>Loading…</div>;

  const save = async () => {
    try {
      await api.patch("/api/settings", {
        price_alert_threshold_pct: Number(settings.price_alert_threshold_pct) || 3,
        drink_categories: settings.drink_categories.split(",").map(s => s.trim()).filter(Boolean),
        drink_items: settings.drink_items.split(",").map(s => s.trim()).filter(Boolean),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      {error && <div style={{ color: BX.RUST, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <label style={{ display: "block", marginBottom: 18 }}>
        {fieldLabel("PRICE ALERT THRESHOLD")}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="number" min="0.5" max="50" step="0.5" value={settings.price_alert_threshold_pct}
            onChange={e => setSettings(s => ({ ...s, price_alert_threshold_pct: e.target.value }))}
            style={inputBx({ width: 80, fontSize: 12, padding: "8px 10px" })} />
          <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>% — smaller changes are treated as rounding / pack-size noise</span>
        </div>
      </label>

      <label style={{ display: "block", marginBottom: 14 }}>
        {fieldLabel("DRINK CATEGORIES")}
        <input value={settings.drink_categories}
          onChange={e => setSettings(s => ({ ...s, drink_categories: e.target.value }))}
          placeholder="Hot Drinks, Cold Drinks" style={inputBx({ width: "100%", fontSize: 12, padding: "8px 10px" })} />
        {note("Square category names that count as a drink, comma-separated. The denominator for per-drink consumables (sugar, lids).")}
      </label>

      <label style={{ display: "block", marginBottom: 18 }}>
        {fieldLabel("DRINK ITEM NAMES · OPTIONAL")}
        <input value={settings.drink_items}
          onChange={e => setSettings(s => ({ ...s, drink_items: e.target.value }))}
          placeholder="Latte, Cappuccino" style={inputBx({ width: "100%", fontSize: 12, padding: "8px 10px" })} />
        {note("Extra item names counted as drinks even if their category isn't listed above.")}
      </label>

      <button onClick={save} style={btnPrimary({ fontSize: 9, padding: "10px 16px" })}>{saved ? "✓ Saved" : "Save"}</button>
      {note("Changing the drink definition applies from the next Square metrics sync.")}
    </div>
  );
}

// ─── Modal shell ──────────────────────────────────────────────────────────────
export default function SettingsModal({ settings, me, onSave, onClose }) {
  const TABS = tabsFor(me);
  const [tab, setTab] = useState(TABS[0]);
  const [local, setLocal] = useState(settings);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,25,22,0.45)", zIndex: 400,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: 880, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column",
        background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`, fontFamily: BX.MONO, fontWeight: 400, color: BX.INK }}>

        <div style={{ padding: "16px 24px 0", borderBottom: `1px solid ${BX.LINEN}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={serifH(20)}>Settings</span>
            <button onClick={onClose} aria-label="Close"
              style={{ background: "none", border: "none", cursor: "pointer", fontFamily: BX.MONO, fontSize: 14, color: BX.DRIFTWOOD }}>✕</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", marginTop: 8 }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 13px",
                  marginBottom: -1, whiteSpace: "nowrap",
                  borderBottom: `2px solid ${tab === t ? BX.INK : "transparent"}`,
                  ...label({ fontSize: 10, color: tab === t ? BX.INK : BX.DRIFTWOOD }) }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: "20px 24px", overflowY: "auto", flexGrow: 1 }}>
          {tab === "General" && (
            <div>
              <label style={{ display: "block", marginBottom: 18 }}>
                {fieldLabel("STORE NAME")}
                <input value={local.storeName} onChange={e => setLocal({ ...local, storeName: e.target.value })}
                  placeholder="Boxx Coffee" style={inputBx({ width: "100%" })} />
              </label>
              <div style={card({ padding: "12px 14px", marginBottom: 18, background: BX.STONE, border: "none" })}>
                <span style={bodyText({ fontSize: 11, color: BX.GRAPHITE })}>
                  API keys live in Railway environment variables on the server — never in the browser.
                  Orders, invoices, counts and reports live in the server database and survive redeploys.
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={onClose} style={btnGhost({ fontSize: 9, padding: "10px 16px" })}>Cancel</button>
                <button onClick={() => { onSave(local); onClose(); }} style={btnPrimary({ fontSize: 9, padding: "10px 16px" })}>Save</button>
              </div>
            </div>
          )}
          {tab === "Costs" && <CostsTab />}
          {tab === "Gmail" && <GmailTab />}
          {tab === "Vendors" && <VendorsTab />}
          {tab === "Consumables" && <ConsumablesTab />}
          {tab === "Alerts & Drinks" && <AlertsTab />}
          {tab === "Team PINs" && <TeamPinsTab />}
          {tab === "My PIN" && <MyPinTab />}
        </div>
      </div>
    </div>
  );
}

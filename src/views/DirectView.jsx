import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { BX, label, tag, card, bodyText, btnPrimary, btnGhost, inputBx, fmtAgo } from "../lib/boxx.js";

// The Direct Line: one private thread per member — that member and Arda,
// nobody else. Plain messages are quiet talk; "decision needed" renders as a
// card the owner approves or declines in one tap, writing the same decision
// log as the Overview queue. Deleting is housekeeping: either party sweeps
// plain messages, only the asker withdraws a pending decision, and a resolved
// decision's log row survives any sweep.

function Thread({ memberId, me, isMobile, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState("message");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(null);     // message id armed for delete
  const bottomRef = useRef(null);
  const isOwner = me.user.role === "owner";

  const load = useCallback((scroll) => {
    api.get(`/api/direct/${memberId}`).then(d => {
      setData(d);
      if (scroll) setTimeout(() => bottomRef.current?.scrollIntoView({ block: "end" }), 50);
    }).catch(e => setError(e.message));
  }, [memberId]);
  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), 15000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const otherName = isOwner ? data.member.name : data.owner_name;

  const send = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/direct/${memberId}`, { kind, text: draft.trim() });
      setDraft(""); setKind("message"); load(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const zap = async (m) => {
    if (armed !== m.id) return setArmed(m.id);
    try { await api.del(`/api/direct/messages/${m.id}`); setArmed(null); load(false); }
    catch (err) { setError(err.message); setArmed(null); }
  };
  const resolve = async (decisionId, state) => {
    try { await api.post(`/api/decisions/${decisionId}/resolve`, { state }); load(false); }
    catch (err) { setError(err.message); }
  };

  const fmtAt = (iso) => new Date(iso).toLocaleString("en-US",
    { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase();
  const delBtn = (m, dark) => (
    <button onClick={() => zap(m)}
      title={armed === m.id ? "Tap again — gone for both of you" : "Delete"}
      style={{ position: "absolute", top: 3, right: 5, background: "none", border: "none",
        cursor: "pointer", fontFamily: BX.MONO, fontSize: 10, padding: 2,
        color: armed === m.id ? BX.RUST : dark ? BX.DRIFTWOOD : BX.LINEN }}>
      {armed === m.id ? "✕?" : "✕"}
    </button>
  );

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 640,
      display: "flex", flexDirection: "column", height: isMobile ? "calc(100vh - 210px)" : "calc(100vh - 170px)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 6, flexWrap: "wrap" }}>
        {isOwner && onBack && (
          <button onClick={onBack} style={btnGhost({ padding: "6px 10px", fontSize: 8, borderColor: BX.LINEN, color: BX.DRIFTWOOD })}>
            ‹ All lines
          </button>
        )}
        <span style={{ fontFamily: BX.SERIF, fontSize: 18 }}>{otherName}</span>
      </div>
      <div style={{ fontSize: 9, color: BX.OLIVE, letterSpacing: "0.08em", padding: "7px 0 9px",
        borderBottom: `1px solid ${BX.STONE}` }}>
        🔒 PRIVATE — ONLY YOU AND {otherName.toUpperCase()}. NOT ON THE BOARD, NOT ON ANY CARD.
      </div>

      <div style={{ flexGrow: 1, overflowY: "auto", display: "flex", flexDirection: "column",
        gap: 10, padding: "12px 2px" }}>
        {data.messages.length === 0 && (
          <div style={bodyText({ fontSize: 12, color: BX.DRIFTWOOD, padding: "16px 4px" })}>
            Nothing yet. Quiet matters and quick decisions live here — pushes straight to {otherName}'s phone.
          </div>
        )}
        {data.messages.map(m => {
          const mine = m.author_id === me.user.id;
          if (m.kind === "decision" && m.decision) {
            const open = m.decision.state === "open";
            return (
              <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "88%",
                border: `1px solid ${open ? BX.AMBER : BX.OLIVE}`, position: "relative" }}>
                {delBtn(m, false)}
                <div style={{ padding: "6px 24px 6px 11px", borderBottom: `1px solid ${open ? BX.AMBER : BX.STONE}`,
                  background: open ? "rgba(138,90,31,0.08)" : "rgba(107,110,74,0.07)",
                  display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={tag(open ? BX.AMBER : BX.OLIVE)}>
                    {open ? "DECISION NEEDED" : m.decision.state.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 8, color: BX.DRIFTWOOD, letterSpacing: "0.1em" }}>
                    {m.author_name.toUpperCase()} · {fmtAt(m.created_at)}
                  </span>
                </div>
                <div style={{ padding: "9px 11px", fontSize: 12 }}>{m.text}</div>
                {open && isOwner && (
                  <div style={{ padding: "8px 11px", borderTop: `1px solid ${BX.STONE}`, display: "flex", gap: 6, alignItems: "center" }}>
                    <button onClick={() => resolve(m.decision.id, "approved")} style={btnPrimary({ padding: "7px 13px", fontSize: 8 })}>Approve</button>
                    <button onClick={() => resolve(m.decision.id, "declined")} style={btnGhost({ padding: "7px 12px", fontSize: 8 })}>Decline</button>
                    <span style={{ fontSize: 9, color: BX.DRIFTWOOD }}>one tap · recorded in the decision log</span>
                  </div>
                )}
                {open && !isOwner && (
                  <div style={{ padding: "7px 11px", borderTop: `1px solid ${BX.STONE}`, fontSize: 9, color: BX.DRIFTWOOD }}>
                    Waiting on Arda — also in the decision queue.
                  </div>
                )}
                {!open && (
                  <div style={{ padding: "7px 11px", borderTop: `1px solid ${BX.STONE}`, fontSize: 10, color: BX.GRAPHITE }}>
                    {m.decision.owner_note ? `${m.decision.owner_note} · ` : ""}
                    <span style={{ color: BX.DRIFTWOOD, fontSize: 9 }}>SAVED TO THE DECISION LOG{m.decision.resolved_at ? ` · ${fmtAgo(m.decision.resolved_at)}` : ""}</span>
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "84%",
              padding: "8px 24px 8px 12px", fontSize: 12, lineHeight: 1.5, position: "relative",
              background: mine ? BX.INK : "rgba(221,214,204,0.35)",
              color: mine ? BX.PARCHMENT : BX.INK,
              border: mine ? `1px solid ${BX.INK}` : `1px solid ${BX.STONE}` }}>
              {delBtn(m, mine)}
              {m.text}
              <div style={{ fontSize: 8, letterSpacing: "0.1em", marginTop: 4,
                color: mine ? BX.LINEN : BX.DRIFTWOOD }}>
                {m.author_name.toUpperCase()} · {fmtAt(m.created_at)}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{ borderTop: `1px solid ${BX.LINEN}`, paddingTop: 10 }}>
        {!isOwner && (
          <div style={{ display: "flex", gap: 0, marginBottom: 8 }}>
            {[["message", "Message"], ["decision", "Decision needed"]].map(([k, t]) => (
              <button key={k} onClick={() => setKind(k)}
                style={{ fontFamily: BX.MONO, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase",
                  padding: "7px 11px", cursor: "pointer",
                  border: `1px solid ${kind === k ? BX.INK : BX.LINEN}`, borderRight: k === "message" ? "none" : undefined,
                  background: kind === k ? BX.INK : "transparent", color: kind === k ? BX.PARCHMENT : BX.DRIFTWOOD }}>
                {t}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
            placeholder={kind === "decision" ? "What needs deciding — one line" : `Write to ${otherName}…`}
            style={inputBx({ flexGrow: 1, fontSize: 12 })} />
          <button onClick={send} disabled={busy || !draft.trim()}
            style={btnPrimary({ padding: "10px 16px", fontSize: 9, opacity: busy || !draft.trim() ? 0.5 : 1 })}>
            Send
          </button>
        </div>
        <div style={{ fontSize: 9, color: BX.DRIFTWOOD, marginTop: 6 }}>
          {kind === "decision"
            ? "Renders as a card Arda approves or declines in one tap — recorded in the decision log."
            : `Private · pushes to ${otherName}'s phone.`}
        </div>
      </div>
    </div>
  );
}

export default function DirectView({ me, isMobile }) {
  const isOwner = me.user.role === "owner";
  const [threads, setThreads] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState(null);

  const loadThreads = useCallback(() => {
    if (!isOwner) return;
    api.get("/api/direct/threads").then(d => setThreads(d.threads)).catch(e => setError(e.message));
  }, [isOwner]);
  useEffect(() => { loadThreads(); }, [loadThreads, openId]);

  if (!isOwner) return <Thread memberId={me.user.id} me={me} isMobile={isMobile} />;
  if (openId) return <Thread memberId={openId} me={me} isMobile={isMobile} onBack={() => setOpenId(null)} />;

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!threads) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 640 }}>
      <div style={label({ marginBottom: 10 })}>DIRECT LINES · ONE PRIVATE THREAD PER PERSON</div>
      <div style={card()}>
        {threads.map(t => (
          <div key={t.member_id} onClick={() => setOpenId(t.member_id)}
            style={{ padding: "12px 16px", borderBottom: `1px solid ${BX.STONE}`, display: "flex",
              gap: 10, alignItems: "baseline", cursor: "pointer", flexWrap: "wrap" }}>
            <span style={{ fontFamily: BX.SERIF, fontSize: 15, width: 90, flexShrink: 0 }}>{t.name}</span>
            {t.pending_decisions > 0 && (
              <span style={tag(BX.AMBER, { flexShrink: 0 })}>
                {t.pending_decisions} DECISION{t.pending_decisions > 1 ? "S" : ""} WAITING
              </span>
            )}
            <span style={{ fontSize: 10, color: t.unread ? BX.GRAPHITE : BX.DRIFTWOOD, flexGrow: 1, minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.last ? `${t.last.author_name === me.user.name ? "You: " : ""}${t.last.text}` : "No messages yet"}
            </span>
            <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexShrink: 0 }}>
              {t.last && <span style={{ fontSize: 9, color: BX.DRIFTWOOD }}>{fmtAgo(t.last.created_at)}</span>}
              {t.unread > 0 && (
                <span style={{ minWidth: 17, height: 17, background: BX.RUST, color: BX.PARCHMENT, fontSize: 9,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
                  {t.unread}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

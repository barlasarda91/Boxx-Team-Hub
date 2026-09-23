import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { BX, label, eyebrow, tag, card, bodyText, btnPrimary, btnGhost, inputBx, fmtAgo } from "../lib/boxx.js";
import { useRoster } from "../lib/useRoster.js";

// The Team Board: one feed, two kinds of post. The TYPE tag in the composer
// decides what a post is — nothing is inferred from anyone's words, and
// Claude never reads the board. Mentions are literal @Name matches.

// Render @mentions in olive without trusting any HTML.
// @Arda reaches the owner; @everyone reaches the whole team.
function renderText(text, names) {
  const words = [...names, "Arda", "everyone"];
  const parts = String(text).split(/(@[A-Za-z]+)/g);
  return parts.map((p, i) => {
    const m = /^@([A-Za-z]+)$/.exec(p);
    if (m && words.some(n => n.toLowerCase() === m[1].toLowerCase())) {
      return <span key={i} style={{ color: BX.OLIVE }}>{p}</span>;
    }
    return <span key={i}>{p}</span>;
  });
}

const daysOld = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
const ageTag = (iso) => {
  const d = daysOld(iso);
  const hrs = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  return d >= 1 ? `${d}D` : `${Math.max(1, hrs)}H`;
};

export default function TeamBoard({ me, isMobile }) {
  const roster = useRoster();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [kind, setKind] = useState("post");
  const [text, setText] = useState("");
  const [waitingOn, setWaitingOn] = useState("");
  const [needBy, setNeedBy] = useState("");
  const [attachables, setAttachables] = useState([]);
  const [attach, setAttach] = useState("");       // "kind|label"
  const [showAttach, setShowAttach] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/api/board").then(d => {
      setData(d);
      api.post("/api/board/seen").catch(() => {});
    }).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/api/board/attachables").then(d => setAttachables(d.attachables)).catch(() => {});
  }, []);

  const post = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const [attachKind, attachLabel] = attach ? attach.split("|") : [null, null];
      await api.post("/api/board", {
        kind, text: text.trim(),
        waiting_on: kind === "waiting_on" ? waitingOn : undefined,
        need_by: kind === "waiting_on" && needBy ? needBy : undefined,
        attach_kind: attachKind || undefined, attach_label: attachLabel || undefined,
      });
      setText(""); setWaitingOn(""); setNeedBy(""); setAttach(""); setShowAttach(false); setKind("post");
      load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const act = async (id, action) => {
    try { await api.post(`/api/board/${id}/${action}`); load(); }
    catch (err) { setError(err.message); }
  };

  if (!data) return <div style={bodyText({ padding: 12, color: BX.DRIFTWOOD })}>{error || "Loading board…"}</div>;

  const typeTag = (id, text_, onColor = BX.INK) => (
    <button key={id} onClick={() => setKind(id)}
      style={{ cursor: "pointer", padding: "5px 10px", fontFamily: BX.MONO, fontWeight: 400, fontSize: 8,
        letterSpacing: "0.16em", textTransform: "uppercase",
        background: kind === id ? onColor : "transparent",
        color: kind === id ? BX.PARCHMENT : BX.DRIFTWOOD,
        border: `1px solid ${kind === id ? onColor : BX.LINEN}` }}>
      {text_}
    </button>
  );

  const blockerState = (p) => {
    if (p.cleared_at) return tagEl("CLEARED", BX.DRIFTWOOD);
    if (p.delivered_at) return tagEl("DELIVERED — AWAITING OK", BX.OLIVE);
    return tagEl(`WAITING ON ${p.waiting_on.toUpperCase()} · ${ageTag(p.created_at)}`, BX.AMBER);
  };
  const tagEl = (s, c) => <span style={tag(c)}>{s}</span>;

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK }}>
      {error && <div style={{ color: BX.RUST, fontSize: 12, marginBottom: 10 }}>{error}</div>}

      {/* Composer */}
      <div style={card({ marginBottom: 8 })}>
        <div style={{ padding: "11px 16px 0", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={label({ fontSize: 8 })}>TYPE:</span>
          {typeTag("post", "Post")}
          {typeTag("waiting_on", "Waiting on", BX.AMBER)}
        </div>
        {kind === "waiting_on" && (
          <div style={{ padding: "10px 16px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={label({ fontSize: 8 })}>ON</span>
            <select value={waitingOn} onChange={e => setWaitingOn(e.target.value)}
              style={inputBx({ fontSize: 12, padding: "8px 10px" })}>
              <option value="">— who —</option>
              {roster.all.filter(n => n !== me.user.name).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={label({ fontSize: 8 })}>NEED BY</span>
            <input type="date" value={needBy} onChange={e => setNeedBy(e.target.value)}
              style={inputBx({ fontSize: 12, padding: "7px 10px" })} />
          </div>
        )}
        <div style={{ padding: "10px 16px", display: "flex", gap: 8, alignItems: "center" }}>
          <input value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && post()}
            placeholder={kind === "waiting_on" ? "What do you need from them?" : "Tell the team… @name, @Arda, or @everyone"}
            style={inputBx({ flexGrow: 1, fontSize: 12, padding: "10px 12px" })} />
          <button onClick={post} disabled={busy || !text.trim() || (kind === "waiting_on" && !waitingOn)}
            style={btnPrimary({ padding: "11px 18px", fontSize: 9,
              opacity: busy || !text.trim() || (kind === "waiting_on" && !waitingOn) ? 0.4 : 1 })}>
            {kind === "waiting_on" ? "Flag it" : "Post"}
          </button>
        </div>
        <div style={{ padding: "0 16px 11px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {!showAttach && !attach && (
            <button onClick={() => setShowAttach(true)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, ...label({ fontSize: 8 }) }}>
              # ATTACH
            </button>
          )}
          {showAttach && (
            <select value={attach} onChange={e => { setAttach(e.target.value); setShowAttach(false); }}
              style={inputBx({ fontSize: 11, padding: "6px 8px", maxWidth: 280 })}>
              <option value="">— attach nothing —</option>
              {attachables.map((a, i) => (
                <option key={i} value={`${a.kind}|${a.label}`}>{a.kind.toUpperCase()} · {a.label}</option>
              ))}
            </select>
          )}
          {attach && (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 8, letterSpacing: "0.12em", color: BX.GRAPHITE, border: `1px solid ${BX.LINEN}`,
                padding: "3px 8px", background: BX.STONE }}>{attach.replace("|", " · ").toUpperCase()}</span>
              <button onClick={() => setAttach("")} style={{ background: "none", border: "none", cursor: "pointer", color: BX.DRIFTWOOD, fontSize: 11 }}>✕</button>
            </span>
          )}
        </div>
      </div>

      {/* Feed */}
      <div style={card()}>
        <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between" }}>
          <span style={eyebrow()}>Board</span>
          <span style={label({ fontSize: 8 })}>NEWEST FIRST · EVERYONE SEES EVERYTHING</span>
        </div>
        {data.posts.length === 0 && (
          <div style={bodyText({ padding: "16px", fontSize: 12, color: BX.DRIFTWOOD })}>
            Nothing yet. First post starts the board.
          </div>
        )}
        {data.posts.map(p => (
          <div key={p.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${BX.STONE}` }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: isMobile ? "wrap" : "nowrap" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 14, width: isMobile ? "auto" : 76, flexShrink: 0 }}>{p.author_name}</span>
              <div style={{ flexGrow: 1, minWidth: 0 }}>
                <div style={bodyText({ fontSize: 12 })}>{renderText(p.text, roster.all)}</div>
                <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {p.kind === "waiting_on" && blockerState(p)}
                  {p.kind === "waiting_on" && p.need_by && !p.cleared_at && (
                    <span style={{ fontSize: 9, color: BX.DRIFTWOOD }}>NEED BY {p.need_by.slice(5).replace("-", "/")}</span>
                  )}
                  {p.attach_label && (
                    <span style={{ fontSize: 8, letterSpacing: "0.12em", color: BX.GRAPHITE, border: `1px solid ${BX.LINEN}`,
                      padding: "3px 8px", background: BX.STONE }}>{p.attach_kind.toUpperCase()} · {p.attach_label}</span>
                  )}
                  {p.mentions.includes(me.user.name) && p.author_name !== me.user.name && (
                    <span style={tag(BX.OLIVE)}>MENTIONS YOU</span>
                  )}
                </div>
                {p.kind === "waiting_on" && !p.cleared_at && (
                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(me.user.name === p.waiting_on || me.user.role === "owner") && !p.delivered_at && (
                      <button onClick={() => act(p.id, "delivered")} style={btnGhost({ padding: "7px 12px", fontSize: 8 })}>
                        Done — handing over
                      </button>
                    )}
                    {(p.author_name === me.user.name || me.user.role === "owner") && (
                      <button onClick={() => act(p.id, "clear")}
                        style={btnGhost({ padding: "7px 12px", fontSize: 8, borderColor: BX.LINEN, color: BX.DRIFTWOOD })}>
                        Cleared — got it
                      </button>
                    )}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 9, color: BX.DRIFTWOOD, flexShrink: 0 }}>{fmtAgo(p.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

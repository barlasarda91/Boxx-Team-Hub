import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api.js";
import { BX, label, tag, card, bodyText, btnPrimary, btnGhost, inputBx, fmtAgo } from "../../lib/boxx.js";
import BxModal from "../../components/BxModal.jsx";

const TIER_LABEL = { 1: "Tier 1 · pursue", 2: "Tier 2", 3: "Tier 3", 4: "Tier 4", 5: "Tier 5 · inbound / free" };

// Vicky's influencer reference list: tiers 1-5 on the surface, the full
// profile with collab history in the pop-up.
export default function InfluencersTab({ isMobile }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);   // influencer id
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.get("/api/influencers").then(setData).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const byTier = {};
  for (const i of data.influencers) (byTier[i.tier] = byTier[i.tier] || []).push(i);
  const openInf = data.influencers.find(i => i.id === open);

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 300, color: BX.INK, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 12 }}>
        <span style={label()}>REFERENCE LIST · TIER 1 = PURSUE MOST · TIER 5 = INBOUND / FREE</span>
        <button onClick={() => setAdding(true)} style={{ ...btnPrimary({ padding: "10px 16px", fontSize: 9 }), marginLeft: "auto" }}>+ Influencer</button>
      </div>
      {[1, 2, 3, 4, 5].filter(t => byTier[t]?.length).map(t => (
        <div key={t} style={card({ marginBottom: 8 })}>
          <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={label({ color: t === 1 ? BX.INK : BX.DRIFTWOOD, letterSpacing: "0.2em" })}>{TIER_LABEL[t]}</span>
          </div>
          {byTier[t].map(i => (
            <div key={i.id} onClick={() => setOpen(i.id)}
              style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer",
                display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 14 }}>{i.name}</span>
              {(i.platforms || "").split(",").filter(Boolean).map(p => (
                <span key={p} style={tag(p === "RED" ? BX.OLIVE : BX.DRIFTWOOD)}>{p}</span>
              ))}
              {i.followers && <span style={bodyText({ fontSize: 11 })}>{i.followers}</span>}
              <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>
                  {i.collabs.length ? `${i.collabs.length} collab${i.collabs.length > 1 ? "s" : ""}` : "never worked"}
                </span>
                {i.status && <span style={tag(BX.AMBER)}>{i.status.toUpperCase()}</span>}
              </span>
            </div>
          ))}
        </div>
      ))}
      {data.influencers.length === 0 && (
        <div style={card({ padding: "18px" })}>
          <span style={bodyText({ fontSize: 12, color: BX.DRIFTWOOD })}>Empty list. Add the first influencer.</span>
        </div>
      )}

      {(openInf || adding) && (
        <InfluencerModal inf={adding ? null : openInf}
          onClose={() => { setOpen(null); setAdding(false); load(); }} onError={setError} />
      )}
    </div>
  );
}

function InfluencerModal({ inf, onClose, onError }) {
  const [f, setF] = useState({
    name: inf?.name || "", tier: inf?.tier || 3, platforms: (inf?.platforms || "").split(",").filter(Boolean),
    followers: inf?.followers || "", contact: inf?.contact || "", status: inf?.status || "", next_step: inf?.next_step || "",
  });
  const [collab, setCollab] = useState({ when_text: "", description: "", cost: "", result: "" });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  const save = async () => {
    const body = { ...f, platforms: f.platforms.join(",") };
    try {
      if (inf) await api.patch(`/api/influencers/${inf.id}`, body);
      else await api.post("/api/influencers", body);
      onClose();
    } catch (err) { onError(err.message); }
  };
  const addCollab = async () => {
    if (!collab.when_text || !collab.description) return;
    try { await api.post(`/api/influencers/${inf.id}/collabs`, collab); onClose(); }
    catch (err) { onError(err.message); }
  };
  const archive = async () => {
    try { await api.patch(`/api/influencers/${inf.id}`, { active: 0 }); onClose(); }
    catch (err) { onError(err.message); }
  };

  return (
    <BxModal title={inf ? inf.name : "New influencer"} onClose={onClose} width={660}>
      <div style={{ padding: "14px 22px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ display: "flex", gap: 5 }}>
          {[1, 2, 3, 4, 5].map(t => (
            <button key={t} onClick={() => set("tier", t)}
              style={{ width: 28, height: 28, cursor: "pointer", background: f.tier === t ? BX.STONE : "transparent",
                border: `1px solid ${f.tier === t ? BX.INK : BX.LINEN}`, fontFamily: BX.MONO, fontWeight: 400,
                fontSize: 11, color: f.tier === t ? BX.INK : BX.DRIFTWOOD }}>{t}</button>
          ))}
        </span>
        <span style={label({ fontSize: 8 })}>TIER · 1 = PURSUE MOST</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
          {["IG", "TIKTOK", "RED"].map(p => {
            const on = f.platforms.includes(p);
            return (
              <button key={p} onClick={() => set("platforms", on ? f.platforms.filter(x => x !== p) : [...f.platforms, p])}
                style={{ cursor: "pointer", padding: "5px 10px", background: on ? BX.INK : "transparent",
                  border: `1px solid ${on ? BX.INK : BX.LINEN}`, ...label({ fontSize: 8, color: on ? BX.PARCHMENT : BX.DRIFTWOOD }) }}>{p}</button>
            );
          })}
        </span>
      </div>
      <div style={{ padding: "14px 22px", borderBottom: `1px solid ${BX.STONE}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input value={f.name} onChange={e => set("name", e.target.value)} placeholder="Name / handle" style={inputBx({ fontSize: 12 })} />
        <input value={f.followers} onChange={e => set("followers", e.target.value)} placeholder="Followers, e.g. IG 184k · TikTok 96k" style={inputBx({ fontSize: 12 })} />
        <input value={f.contact} onChange={e => set("contact", e.target.value)} placeholder="Contact" style={inputBx({ fontSize: 12 })} />
        <input value={f.status} onChange={e => set("status", e.target.value)} placeholder="Status, e.g. In talks / Keep warm" style={inputBx({ fontSize: 12 })} />
        <input value={f.next_step} onChange={e => set("next_step", e.target.value)} placeholder="Next step" style={inputBx({ fontSize: 12, gridColumn: "1 / -1" })} />
      </div>
      {inf && (
        <>
          <div style={{ padding: "11px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
            <span style={label({ color: BX.INK })}>COLLAB HISTORY</span>
          </div>
          {inf.collabs.map(c => (
            <div key={c.id} style={{ padding: "9px 22px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 12, alignItems: "baseline" }}>
              <span style={label({ fontSize: 8, color: BX.INK, flexShrink: 0 })}>{c.when_text.toUpperCase()}</span>
              <span style={bodyText({ fontSize: 12 })}>
                {c.description}{c.cost ? ` · ${c.cost}` : ""}{c.result ? ` · ${c.result}` : ""}
              </span>
            </div>
          ))}
          <div style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.STONE}`, display: "grid", gridTemplateColumns: "90px 1fr 90px 110px auto", gap: 6 }}>
            <input value={collab.when_text} onChange={e => setCollab(s => ({ ...s, when_text: e.target.value }))} placeholder="May 26" style={inputBx({ fontSize: 11, padding: "8px" })} />
            <input value={collab.description} onChange={e => setCollab(s => ({ ...s, description: e.target.value }))} placeholder="What ran" style={inputBx({ fontSize: 11, padding: "8px" })} />
            <input value={collab.cost} onChange={e => setCollab(s => ({ ...s, cost: e.target.value }))} placeholder="Cost" style={inputBx({ fontSize: 11, padding: "8px" })} />
            <input value={collab.result} onChange={e => setCollab(s => ({ ...s, result: e.target.value }))} placeholder="Result" style={inputBx({ fontSize: 11, padding: "8px" })} />
            <button onClick={addCollab} style={btnGhost({ padding: "8px 12px", fontSize: 8 })}>Add</button>
          </div>
        </>
      )}
      <div style={{ padding: "12px 22px", display: "flex", gap: 10, justifyContent: "flex-end" }}>
        {inf && <button onClick={archive} style={btnGhost({ fontSize: 9, color: BX.RUST, borderColor: BX.RUST })}>Archive</button>}
        <button onClick={save} style={btnPrimary()}>Save</button>
      </div>
    </BxModal>
  );
}

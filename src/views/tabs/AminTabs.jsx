import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api.js";
import { laDateStr } from "../../lib/dates.js";
import { BX, label, tag, card, bodyText, btnPrimary, btnGhost, inputBx } from "../../lib/boxx.js";

// Amin's folders: links only. One click opens Drive or Dropbox; the hub
// never renders folder contents.
export function FoldersTab({ isMobile }) {
  const [folders, setFolders] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({ name: "", url: "", provider: "Google Drive", note: "" });

  const load = useCallback(() => {
    api.get("/api/folders").then(d => setFolders(d.folders)).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!folders) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const add = async () => {
    if (!draft.name || !draft.url) return;
    try {
      await api.post("/api/folders", draft);
      setDraft({ name: "", url: "", provider: draft.provider, note: "" });
      load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 300, color: BX.INK, maxWidth: 900 }}>
      <div style={{ marginBottom: 12 }}>
        <span style={label()}>LINKS ONLY · CONTENT STAYS IN DRIVE / DROPBOX · ONE CLICK OPENS THE FOLDER</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8, marginBottom: 8 }}>
        {folders.map(f => (
          <div key={f.id} style={card({ padding: "16px 18px" })}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 15 }}>{f.name}</span>
              <span style={tag()}>{(f.provider || "LINK").toUpperCase()}</span>
            </div>
            {f.note && <div style={bodyText({ fontSize: 11, marginBottom: 10 })}>{f.note}</div>}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                <span style={btnPrimary({ padding: "10px 18px", fontSize: 9, display: "inline-block" })}>Open folder →</span>
              </a>
              <button onClick={async () => { await api.del(`/api/folders/${f.id}`).catch(e => setError(e.message)); load(); }}
                style={{ background: "none", border: "none", cursor: "pointer", ...label({ fontSize: 8, color: BX.RUST }) }}>
                REMOVE
              </button>
            </div>
          </div>
        ))}
        {folders.length === 0 && (
          <div style={card({ padding: "18px" })}>
            <span style={bodyText({ fontSize: 12, color: BX.DRIFTWOOD })}>No folders linked yet.</span>
          </div>
        )}
      </div>
      <div style={card()}>
        <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.2em" })}>Link a new folder</span>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={draft.name} onChange={e => setDraft(s => ({ ...s, name: e.target.value }))} placeholder="Name, e.g. September shoot"
            style={inputBx({ fontSize: 12, flexBasis: 200, flexGrow: 1 })} />
          <select value={draft.provider} onChange={e => setDraft(s => ({ ...s, provider: e.target.value }))}
            style={inputBx({ fontSize: 12 })}>
            <option>Google Drive</option><option>Dropbox</option><option>Other</option>
          </select>
          <input value={draft.url} onChange={e => setDraft(s => ({ ...s, url: e.target.value }))} placeholder="https://…"
            style={inputBx({ fontSize: 12, flexBasis: 260, flexGrow: 2 })} />
          <input value={draft.note} onChange={e => setDraft(s => ({ ...s, note: e.target.value }))} placeholder="Note (optional)"
            style={inputBx({ fontSize: 12, flexBasis: 180, flexGrow: 1 })} />
          <button onClick={add} style={btnGhost({ fontSize: 9 })}>Add link</button>
        </div>
      </div>
    </div>
  );
}

// The monthly shooting brief, shared between Vicky and Amin.
export function BriefTab() {
  const [month, setMonth] = useState(laDateStr().slice(0, 7));
  const [brief, setBrief] = useState(null);
  const [text, setText] = useState("");
  const [folderUrl, setFolderUrl] = useState("");
  const [status, setStatus] = useState(null);

  const load = useCallback(() => {
    api.get(`/api/briefs/${month}`).then(d => {
      setBrief(d.brief);
      setText(d.brief?.text || "");
      setFolderUrl(d.brief?.folder_url || "");
    }).catch(e => setStatus(e.message));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      await api.put(`/api/briefs/${month}`, { text, folder_url: folderUrl });
      setStatus("Saved.");
      setTimeout(() => setStatus(null), 2000);
    } catch (err) { setStatus(err.message); }
  };
  const shiftMonth = (n) => {
    const d = new Date(`${month}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 300, color: BX.INK, maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <button onClick={() => shiftMonth(-1)} style={btnGhost({ padding: "7px 12px", fontSize: 10 })}>‹</button>
        <span style={{ fontFamily: BX.SERIF, fontSize: 18 }}>{monthName}</span>
        <button onClick={() => shiftMonth(1)} style={btnGhost({ padding: "7px 12px", fontSize: 10 })}>›</button>
        <span style={label({ fontSize: 8 })}>SHOOTING BRIEF · SHARED BETWEEN VICKY AND AMIN</span>
      </div>
      <div style={card()}>
        <div style={{ padding: "14px 18px" }}>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={9}
            placeholder="Theme, hero shots, reels, portraits — what this month's shoot needs to cover."
            style={{ width: "100%", boxSizing: "border-box", fontFamily: BX.MONO, fontWeight: 300, fontSize: 13,
              color: BX.INK, background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`, padding: 12, resize: "vertical", lineHeight: 1.6 }} />
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input value={folderUrl} onChange={e => setFolderUrl(e.target.value)} placeholder="Brief / assets folder link…"
              style={inputBx({ fontSize: 12, flexGrow: 1 })} />
            {folderUrl && /^https:\/\//.test(folderUrl) && (
              <a href={folderUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                <span style={btnGhost({ padding: "10px 14px", fontSize: 9, display: "inline-block" })}>Open →</span>
              </a>
            )}
            <button onClick={save} style={btnPrimary()}>Save brief</button>
          </div>
          {status && <div style={{ marginTop: 8, fontSize: 11, color: status === "Saved." ? BX.OLIVE : BX.RUST }}>{status}</div>}
          {brief?.updated_at && <div style={{ marginTop: 8, ...label({ fontSize: 8 }) }}>LAST SAVED {new Date(brief.updated_at).toLocaleString().toUpperCase()}</div>}
        </div>
      </div>
    </div>
  );
}

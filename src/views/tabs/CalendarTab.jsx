import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../lib/api.js";
import { addDaysStr, laDateStr, getCurrentMonday } from "../../lib/dates.js";
import { BX, label, tag, card, bodyText, btnPrimary, btnGhost, inputBx } from "../../lib/boxx.js";
import BxModal from "../../components/BxModal.jsx";

const PLATFORMS = ["IG", "TIKTOK", "RED"];
const platTag = (p) => <span key={p} style={tag(p === "RED" ? BX.OLIVE : BX.DRIFTWOOD)}>{p}</span>;

function monthDays(ym) {
  const first = `${ym}-01`;
  const dow = new Date(`${first}T12:00:00Z`).getUTCDay(); // 0=Sun
  const gridStart = addDaysStr(first, -((dow + 6) % 7));  // back to Monday
  const days = [];
  for (let i = 0; i < 42; i++) days.push(addDaysStr(gridStart, i));
  while (days.length > 7 && !days[days.length - 7].startsWith(ym)) days.splice(-7);
  return days;
}

// Vicky's content calendar: thumbnails on the grid, the post itself in a
// pop-up, notes per week down the side. IG, TikTok and Red carry equal weight.
export default function CalendarTab({ isMobile }) {
  const today = laDateStr();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openDay, setOpenDay] = useState(null); // date string → pop-up

  const load = useCallback(() => {
    const from = addDaysStr(`${ym}-01`, -7);
    const to = addDaysStr(`${ym}-28`, 14);
    api.get(`/api/posts?from=${from}&to=${to}`).then(setData).catch(e => setError(e.message));
  }, [ym]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const days = monthDays(ym);
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const postsByDate = {};
  for (const p of data.posts) (postsByDate[p.post_date] = postsByDate[p.post_date] || []).push(p);
  const noteFor = (monday) => data.week_notes.find(n => n.week_monday === monday)?.note || "";
  const shiftMonth = (n) => {
    const d = new Date(`${ym}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setYm(d.toISOString().slice(0, 7));
  };
  const monthName = new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, maxWidth: 1050 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => shiftMonth(-1)} style={btnGhost({ padding: "7px 12px", fontSize: 10 })}>‹</button>
        <span style={{ fontFamily: BX.SERIF, fontSize: 18 }}>{monthName}</span>
        <button onClick={() => shiftMonth(1)} style={btnGhost({ padding: "7px 12px", fontSize: 10 })}>›</button>
        <span style={label({ fontSize: 8 })}>IG · TIKTOK · RED · EQUAL WEIGHT · CLICK A DAY TO ADD OR EDIT THE POST</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2.4fr 1fr", gap: 8 }}>
        {/* Month grid */}
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 4 }}>
            {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map(d => (
              <div key={d} style={{ textAlign: "center", ...label({ fontSize: 8 }) }}>{d}</div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
              {week.map(date => {
                const inMonth = date.startsWith(ym);
                const posts = postsByDate[date] || [];
                return (
                  <div key={date} onClick={() => setOpenDay(date)}
                    style={{ border: `1px solid ${date === today ? BX.INK : BX.STONE}`, minHeight: 84, padding: 5,
                      cursor: "pointer", opacity: inMonth ? 1 : 0.35, background: BX.PARCHMENT }}>
                    <div style={{ fontSize: 9, fontWeight: 400, color: BX.DRIFTWOOD }}>{Number(date.slice(8))}</div>
                    {posts.slice(0, 1).map(p => (
                      <div key={p.id} style={{ marginTop: 3 }}>
                        {p.image_path
                          ? <img src={`/api/posts/${p.id}/image`} alt="" style={{ width: "100%", height: 44, objectFit: "cover", display: "block" }} />
                          : <div style={{ height: 44, background: BX.STONE }} />}
                        <div style={{ marginTop: 3, display: "flex", gap: 3, flexWrap: "wrap" }}>
                          {(p.platforms || "").split(",").filter(Boolean).map(pl => (
                            <span key={pl} style={{ fontSize: 6, letterSpacing: "0.1em", fontWeight: 400,
                              color: pl === "RED" ? BX.OLIVE : BX.DRIFTWOOD, border: `1px solid ${BX.LINEN}`, padding: "1px 4px" }}>{pl}</span>
                          ))}
                          {posts.length > 1 && <span style={{ fontSize: 7, color: BX.DRIFTWOOD }}>+{posts.length - 1}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Week notes */}
        <div style={card({ alignSelf: "start" })}>
          <div style={{ padding: "11px 14px", borderBottom: `1px solid ${BX.LINEN}` }}>
            <span style={label({ color: BX.INK, letterSpacing: "0.22em" })}>Week notes</span>
          </div>
          {weeks.map(week => {
            const monday = week[0];
            return (
              <div key={monday} style={{ padding: "10px 14px", borderBottom: `1px solid ${BX.STONE}` }}>
                <div style={label({ fontSize: 8, marginBottom: 5, color: monday === getCurrentMonday() ? BX.INK : BX.DRIFTWOOD })}>
                  {monday.slice(5).replace("-", "/")} · {addDaysStr(monday, 6).slice(5).replace("-", "/")}
                  {monday === getCurrentMonday() ? " · THIS WEEK" : ""}
                </div>
                <textarea defaultValue={noteFor(monday)} rows={2} placeholder="Focus for this week…"
                  onBlur={async e => {
                    if (e.target.value === noteFor(monday)) return;
                    try { await api.put(`/api/week-notes/${monday}`, { note: e.target.value }); load(); }
                    catch (err) { setError(err.message); }
                  }}
                  style={{ width: "100%", boxSizing: "border-box", fontFamily: BX.MONO, fontWeight: 400, fontSize: 11,
                    color: BX.GRAPHITE, background: "transparent", border: `1px solid ${BX.STONE}`, padding: 8, resize: "vertical" }} />
              </div>
            );
          })}
        </div>
      </div>

      {openDay && (
        <DayPostModal date={openDay} posts={postsByDate[openDay] || []}
          onClose={() => { setOpenDay(null); load(); }} onError={setError} />
      )}
    </div>
  );
}

function DayPostModal({ date, posts, onClose, onError }) {
  const existing = posts[0] || null;
  const [platforms, setPlatforms] = useState((existing?.platforms || "").split(",").filter(Boolean));
  const [caption, setCaption] = useState(existing?.caption || "");
  const [folderUrl, setFolderUrl] = useState(existing?.folder_url || "");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const save = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("post_date", date);
      fd.append("platforms", platforms.join(","));
      fd.append("caption", caption);
      fd.append("folder_url", folderUrl);
      if (fileRef.current?.files?.[0]) fd.append("image", fileRef.current.files[0]);
      if (existing) {
        await fetch(`/api/posts/${existing.id}`, { method: "PATCH", body: fd }).then(r => { if (!r.ok) throw new Error("Save failed"); });
      } else {
        await api.upload("/api/posts", fd);
      }
      onClose();
    } catch (err) { onError(err.message); setSaving(false); }
  };
  const remove = async () => {
    try { await api.del(`/api/posts/${existing.id}`); onClose(); }
    catch (err) { onError(err.message); }
  };

  const dayLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <BxModal title={`${dayLabel} · post`} onClose={onClose} width={620}>
      <div style={{ padding: "16px 22px", display: "flex", gap: 16, borderBottom: `1px solid ${BX.STONE}`, flexWrap: "wrap" }}>
        <div style={{ width: 140, flexShrink: 0 }}>
          {existing?.image_path
            ? <img src={`/api/posts/${existing.id}/image`} alt="" style={{ width: 140, height: 140, objectFit: "cover", display: "block" }} />
            : <div style={{ width: 140, height: 140, background: BX.STONE, display: "flex", alignItems: "flex-end", padding: 6, boxSizing: "border-box" }}>
                <span style={label({ fontSize: 7 })}>THUMBNAIL ON THE CALENDAR</span>
              </div>}
          <input ref={fileRef} type="file" accept="image/*" style={{ marginTop: 8, fontSize: 10, width: 140 }} />
        </div>
        <div style={{ flexGrow: 1, minWidth: 220 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {PLATFORMS.map(p => {
              const on = platforms.includes(p);
              return (
                <button key={p} onClick={() => setPlatforms(ps => on ? ps.filter(x => x !== p) : [...ps, p])}
                  style={{ cursor: "pointer", padding: "6px 12px", background: on ? BX.INK : "transparent",
                    border: `1px solid ${on ? BX.INK : BX.LINEN}`,
                    ...label({ fontSize: 8, color: on ? BX.PARCHMENT : BX.DRIFTWOOD }) }}>
                  {p}
                </button>
              );
            })}
          </div>
          <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={5} placeholder="Caption — agreed in the weekly meeting"
            style={{ width: "100%", boxSizing: "border-box", fontFamily: BX.MONO, fontWeight: 400, fontSize: 12,
              color: BX.INK, background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`, padding: 10, resize: "vertical" }} />
          <input value={folderUrl} onChange={e => setFolderUrl(e.target.value)} placeholder="Shoot folder link (Drive / Dropbox)…"
            style={inputBx({ width: "100%", marginTop: 8, fontSize: 11 })} />
        </div>
      </div>
      <div style={{ padding: "12px 22px", display: "flex", gap: 10, justifyContent: "flex-end" }}>
        {existing && <button onClick={remove} style={btnGhost({ fontSize: 9, color: BX.RUST, borderColor: BX.RUST })}>Remove post</button>}
        <button onClick={save} disabled={saving} style={btnPrimary({ opacity: saving ? 0.5 : 1 })}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </BxModal>
  );
}

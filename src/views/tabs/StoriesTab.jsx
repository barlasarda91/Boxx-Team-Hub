import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { BX, label, bodyText } from "../../lib/boxx.js";

// Instagram Stories: Arda's story templates (1080×1920), editable in place and
// exported as PNG with one tap. Edits are remembered per device so only what
// rotated needs retyping; the date fills itself each day. All client-side.

const CSS = `
.igs{--ink:#1A1916;--graphite:#3D3A34;--driftwood:#7A7268;--walnut:#634335;
  --linen:#B8AFA3;--stone:#DDD6CC;--parchment:#F5EFE3;--olive:#6B6E4A;
  --serif:'Libre Baskerville',Georgia,serif;--mono:'IBM Plex Mono','Courier New',monospace}
.igs *{box-sizing:border-box;margin:0;padding:0}
.igs .stage{width:540px;height:960px;position:relative;flex:none}
.igs .story{width:1080px;height:1920px;transform:scale(.5);transform-origin:top left;
  position:absolute;top:0;left:0;background:var(--parchment);overflow:hidden;
  font-family:var(--mono);color:var(--ink)}
.igs .inner{position:absolute;left:96px;right:96px;top:250px;bottom:340px;display:flex;flex-direction:column}
.igs .brandline{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--linen);padding-bottom:24px}
.igs .brand{font:400 30px/1 var(--serif);color:var(--ink)}
.igs .date{font:400 22px/1 var(--mono);letter-spacing:.22em;text-transform:uppercase;color:var(--graphite)}
.igs .head{padding:48px 0 40px}
.igs .title{font:400 84px/1.05 var(--serif);letter-spacing:-.01em;margin-top:16px}
.igs .rows{flex:1;display:flex;flex-direction:column}
.igs .row{flex:1;border-top:1px solid var(--linen);padding:40px 0 0;display:grid;align-content:start;row-gap:10px}
.igs .method{font:400 24px/1.4 var(--mono);letter-spacing:.22em;text-transform:uppercase;color:var(--walnut)}
.igs .coffee{font:400 56px/1.15 var(--serif);color:var(--ink)}
.igs .origin{font:400 24px/1.5 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--olive)}
.igs .notes{font:italic 400 34px/1.35 var(--serif);color:var(--graphite);margin-top:6px}
.igs .po .head{padding:40px 0 32px}
.igs .po .title{font-size:72px}
.igs .po .row{padding:22px 0 0;row-gap:4px}
.igs .po .coffee{font-size:36px}
.igs .po .origin{font-size:19px;letter-spacing:.14em}
.igs .po .notes{font-size:24px;margin-top:2px}
.igs .foot{position:absolute;left:96px;right:96px;bottom:200px;display:flex;justify-content:space-between;
  font:300 19px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--graphite)}
.igs [contenteditable]:hover{outline:2px dashed rgba(107,110,74,.5);outline-offset:6px}
.igs [contenteditable]:focus{outline:2px solid var(--olive);outline-offset:6px}
.igs.exporting [contenteditable]{outline:none!important}
`;

const row = (tpl, i, method) => `
  <div class="row">
    ${method ? `<div class="method">${method}</div>` : ""}
    <div class="coffee" contenteditable="true" spellcheck="false" data-k="${tpl}.coffee${i}">Coffee name</div>
    <div class="origin" contenteditable="true" spellcheck="false" data-k="${tpl}.origin${i}">Process</div>
    <div class="notes" contenteditable="true" spellcheck="false" data-k="${tpl}.notes${i}">Tasting note, note, note.</div>
  </div>`;

const FOOT = `<div class="foot"><span>Istanbul · Los Angeles</span><span>Better Coffee</span><span>boxxcoffee.la</span></div>`;

const BREWS = `
  <div class="story" id="story-brews">
    <div class="inner">
      <div class="brandline">
        <div class="brand">Boxx Coffee Roasters Co.</div>
        <div class="date" contenteditable="true" spellcheck="false" data-k="brews.date" data-date>Tue · Oct 13</div>
      </div>
      <div class="head"><div class="title">On the bar today.</div></div>
      <div class="rows">
        ${row("brews", 0, "Batch Brew")}${row("brews", 1, "Cold Brew")}${row("brews", 2, "Oji Drip")}
      </div>
    </div>
    ${FOOT}
  </div>`;

const POUROVER = `
  <div class="story po" id="story-pourover">
    <div class="inner">
      <div class="brandline">
        <div class="brand">Boxx Coffee Roasters Co.</div>
        <div class="date" contenteditable="true" spellcheck="false" data-k="po.date" data-date>Tue · Oct 13</div>
      </div>
      <div class="head"><div class="title">Pour-Over menu</div></div>
      <div class="rows">${[0, 1, 2, 3, 4, 5].map(i => row("po", i)).join("")}</div>
    </div>
    ${FOOT}
  </div>`;

const todayLabel = () => {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][now.getDay()]} · ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][now.getMonth()]} ${now.getDate()}`;
};

const lsKey = (k) => `boxx:story:${k}`;

export default function StoriesTab() {
  const hostRef = useRef(null);
  const [exporting, setExporting] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Restore saved texts; dates always reset to today (still editable)
    host.querySelectorAll("[data-k]").forEach(el => {
      if (el.hasAttribute("data-date")) { el.textContent = todayLabel(); return; }
      try {
        const saved = localStorage.getItem(lsKey(el.dataset.k));
        if (saved) el.textContent = saved;
      } catch {}
    });
    const onInput = (e) => {
      const el = e.target.closest("[data-k]");
      if (!el || el.hasAttribute("data-date")) return;
      try { localStorage.setItem(lsKey(el.dataset.k), el.textContent); } catch {}
    };
    host.addEventListener("input", onInput);
    return () => host.removeEventListener("input", onInput);
  }, []);

  const exportPng = async (storyId, name) => {
    const host = hostRef.current;
    const story = host?.querySelector(`#${storyId}`);
    if (!story) return;
    setExporting(storyId); setError(null);
    const prev = story.style.transform;
    host.classList.add("exporting");
    story.style.transform = "none";
    try {
      await document.fonts.ready;
      const canvas = await html2canvas(story, {
        width: 1080, height: 1920, scale: 1, backgroundColor: "#F5EFE3", useCORS: true,
      });
      const a = document.createElement("a");
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
      a.download = `${name}-${now.toISOString().slice(0, 10)}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    } finally {
      story.style.transform = prev;
      host.classList.remove("exporting");
      setExporting(null);
    }
  };

  const btn = (storyId, name, lbl) => (
    <button onClick={() => exportPng(storyId, name)} disabled={exporting === storyId}
      style={{ fontFamily: BX.MONO, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase",
        padding: "12px 24px", border: `1px solid ${BX.INK}`, background: BX.INK, color: BX.PARCHMENT,
        cursor: "pointer", opacity: exporting === storyId ? 0.5 : 1 }}>
      {exporting === storyId ? "Rendering…" : lbl}
    </button>
  );

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK }}>
      <style>{CSS}</style>
      <div style={{ marginBottom: 12 }}>
        <span style={label()}>DAILY STORIES · TAP ANY TEXT TO EDIT · EXPORT POSTS A 1080×1920 PNG</span>
      </div>
      <div style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD, marginBottom: 14 })}>
        The date fills itself each morning; everything else is remembered on this device, so only
        what rotated needs retyping. Per coffee: name · process · tasting notes.
      </div>
      {error && <div style={bodyText({ color: BX.RUST, fontSize: 12, marginBottom: 10 })}>{error}</div>}

      <div ref={hostRef} className="igs"
        style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div className="stage" style={{ border: `1px solid ${BX.LINEN}` }}
            dangerouslySetInnerHTML={{ __html: BREWS }} />
          {btn("story-brews", "boxx-bar-brews", "Export PNG · On the bar")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div className="stage" style={{ border: `1px solid ${BX.LINEN}` }}
            dangerouslySetInnerHTML={{ __html: POUROVER }} />
          {btn("story-pourover", "boxx-bar-pourover", "Export PNG · Pour-Over")}
        </div>
      </div>
    </div>
  );
}

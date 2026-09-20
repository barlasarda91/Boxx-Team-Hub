import { BX, label } from "../lib/boxx.js";

// The house pop-up: cards keep surface info, detail opens here.
export default function BxModal({ title, onClose, children, width = 640 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,25,22,0.45)", zIndex: 400,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width, maxWidth: "96vw", maxHeight: "88vh", overflowY: "auto",
        background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}` }}>
        <div style={{ padding: "15px 22px", borderBottom: `1px solid ${BX.LINEN}`,
          display: "flex", alignItems: "baseline", justifyContent: "space-between",
          position: "sticky", top: 0, background: BX.PARCHMENT }}>
          <span style={label({ fontSize: 10, letterSpacing: "0.22em", color: BX.INK })}>{title}</span>
          <button onClick={onClose} aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", fontFamily: BX.MONO, fontSize: 14, color: BX.DRIFTWOOD }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

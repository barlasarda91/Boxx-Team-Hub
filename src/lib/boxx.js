// ─── Boxx design tokens (Website Design Tenets v1.0) ─────────────────────────
// Hub views implement the tenets directly. Two typefaces, seven colors,
// square corners, letterspaced mono labels. Status extension (app-only):
// quiet states use Linen-border tags; problems use amber/rust text+borders.

export const BX = {
  PARCHMENT: "#F5EFE3",
  INK:       "#1A1916",
  GRAPHITE:  "#3D3A34",
  DRIFTWOOD: "#7A7268",
  LINEN:     "#B8AFA3",
  STONE:     "#DDD6CC",
  OLIVE:     "#6B6E4A",
  AMBER:     "#8A5A1F",   // app extension: attention
  RUST:      "#8E3B2C",   // app extension: flag / critical
  SERIF: "'Libre Baskerville', serif",
  MONO:  "'IBM Plex Mono', monospace",
};

export const statusColor = (s) =>
  s === "red" ? BX.RUST : s === "yellow" ? BX.AMBER : s === "green" ? BX.DRIFTWOOD : BX.LINEN;

export const statusLabel = (s) =>
  s === "red" ? "FLAG" : s === "yellow" ? "ATTENTION" : s === "green" ? "ON TRACK" : "NO CHECK-IN";

// Style fragments
export const label = (overrides = {}) => ({
  fontFamily: BX.MONO, fontWeight: 400, fontSize: 9, letterSpacing: "0.18em",
  textTransform: "uppercase", color: BX.DRIFTWOOD, ...overrides,
});

export const eyebrow = (overrides = {}) => label({ color: BX.OLIVE, letterSpacing: "0.2em", ...overrides });

export const tag = (color = BX.DRIFTWOOD, overrides = {}) => ({
  fontFamily: BX.MONO, fontWeight: 400, fontSize: 8, letterSpacing: "0.16em",
  textTransform: "uppercase", color, border: `1px solid ${color === BX.DRIFTWOOD ? BX.LINEN : color}`,
  padding: "3px 8px", display: "inline-block", ...overrides,
});

export const card = (overrides = {}) => ({
  background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`, ...overrides,
});

export const btnPrimary = (overrides = {}) => ({
  padding: "12px 22px", background: BX.INK, border: "none", color: BX.PARCHMENT,
  fontFamily: BX.MONO, fontWeight: 400, fontSize: 10, letterSpacing: "0.18em",
  textTransform: "uppercase", cursor: "pointer", ...overrides,
});

export const btnGhost = (overrides = {}) => ({
  padding: "12px 22px", background: "transparent", border: `1px solid ${BX.INK}`, color: BX.INK,
  fontFamily: BX.MONO, fontWeight: 400, fontSize: 10, letterSpacing: "0.18em",
  textTransform: "uppercase", cursor: "pointer", ...overrides,
});

export const serifH = (size = 20, overrides = {}) => ({
  fontFamily: BX.SERIF, fontWeight: 400, fontSize: size, color: BX.INK, ...overrides,
});

// Body reads at 400 (Regular): 300 was too thin on screen. Emphasis within
// body-size text uses 500 (Medium) to keep the old two-step hierarchy.
export const bodyText = (overrides = {}) => ({
  fontFamily: BX.MONO, fontWeight: 400, fontSize: 13, color: BX.GRAPHITE, lineHeight: 1.65, ...overrides,
});

export const inputBx = (overrides = {}) => ({
  fontFamily: BX.MONO, fontWeight: 400, fontSize: 14, color: BX.INK,
  background: BX.PARCHMENT, border: `1px solid ${BX.LINEN}`, padding: "10px 12px",
  outline: "none", boxSizing: "border-box", ...overrides,
});

export function fmtAgo(iso) {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

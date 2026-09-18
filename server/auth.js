import crypto from "crypto";
import { db } from "./db.js";
import { nowISO } from "./dates.js";
export { hashPin, verifyPin } from "./pinhash.js";

// ─── Name + PIN auth ──────────────────────────────────────────────────────────
// Deliberately simple: the hub needs attributable writes, not enterprise SSO.
// PINs are scrypt-hashed; sessions are random tokens in an httpOnly cookie.

const SESSION_COOKIE = "boxx_session";
const SESSION_DAYS = 30;

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, nowISO(), expires);
  // Opportunistic cleanup of expired sessions
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowISO());
  return { token, expires };
}

export function sessionCookie(token, expires) {
  const secure = process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function userForRequest(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.role, u.active, s.token
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, nowISO());
  if (!row || !row.active) return null;
  return row;
}

export function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// Paths reachable without a session. The Gmail OAuth callback must stay open
// (Google redirects the browser there); everything else data-bearing is gated.
const PUBLIC_PATHS = new Set(["/health", "/api/auth/login", "/api/auth/roster", "/api/gmail/callback"]);

export function authMiddleware(req, res, next) {
  if (!req.path.startsWith("/api") && req.path !== "/health") return next(); // static assets
  if (PUBLIC_PATHS.has(req.path)) return next();
  const user = userForRequest(req);
  if (!user) return res.status(401).json({ error: "Sign in required" });
  req.user = user;
  next();
}

export function requireOwner(req, res, next) {
  if (req.user?.role !== "owner") return res.status(403).json({ error: "Owner only" });
  next();
}

import webpush from "web-push";
import { db, getSetting, setSetting } from "./db.js";
import { nowISO } from "./dates.js";

// ─── Web push — real notifications, even with the tab closed ─────────────────
// Standard Web Push, no third-party service. The VAPID keypair is generated
// once and kept in settings so subscriptions survive redeploys. Sends are
// best-effort: a dead subscription (404/410) is pruned, any other failure is
// logged and never blocks the caller.

const SUBJECT = process.env.PUSH_SUBJECT || "https://boxxteamhub.up.railway.app";

let vapid = null;
export function ensureVapid() {
  if (vapid) return vapid;
  const stored = getSetting("vapid_keys");
  if (stored) {
    vapid = JSON.parse(stored);
  } else {
    vapid = webpush.generateVAPIDKeys();
    setSetting("vapid_keys", JSON.stringify(vapid));
  }
  webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);
  return vapid;
}

export function saveSubscription(userId, sub) {
  if (!sub?.endpoint || !sub?.keys) throw new Error("Not a valid push subscription");
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, keys_json, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys_json = excluded.keys_json
  `).run(userId, sub.endpoint, JSON.stringify(sub.keys), nowISO());
}

export function dropSubscription(endpoint) {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

async function sendTo(row, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: JSON.parse(row.keys_json) },
      JSON.stringify(payload),
      { TTL: 3600 }
    );
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) dropSubscription(row.endpoint);
    else console.error("push send:", err.statusCode || err.message);
    return false;
  }
}

// Fire-and-forget: notify every device of every named user. Names are hub
// names ("Arda"-style aliases resolved by the caller); unknown names no-op.
export function pushToNames(names, { title, body, url = "/", tag }) {
  if (!Array.isArray(names) || names.length === 0) return;
  ensureVapid();
  const rows = db.prepare(`
    SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
    WHERE u.active = 1 AND u.name IN (${names.map(() => "?").join(",")})
  `).all(...names);
  const payload = { title, body, url, tag: tag || "boxx" };
  // Sequential in the background; callers never await this
  (async () => { for (const row of rows) await sendTo(row, payload); })()
    .catch(err => console.error("push batch:", err.message));
}

export function pushSubscriptionCount(userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").get(userId).n;
}

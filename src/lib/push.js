import { api } from "./api.js";

// Web push, client side. Each device subscribes once; the server keeps one
// row per device and prunes dead ones when a send bounces.

export const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// iOS Safari only exposes push once the app is installed to the home screen
export const isIosNotInstalled = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !window.matchMedia("(display-mode: standalone)").matches && !navigator.standalone;

const b64ToU8 = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

export async function pushStatus() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch { return "off"; }
}

export async function enablePush() {
  const reg = await navigator.serviceWorker.register("/sw.js");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications were not allowed — check the browser's site settings");
  const { key } = await api.get("/api/push/vapid-key");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64ToU8(key),
  });
  await api.post("/api/push/subscribe", { subscription: sub.toJSON() });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    try { await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint }); } catch {}
    await sub.unsubscribe();
  }
}

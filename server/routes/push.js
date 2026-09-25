import { Router } from "express";
import { ensureVapid, saveSubscription, dropSubscription, pushToNames, pushSubscriptionCount } from "../push.js";

export const pushRouter = Router();

pushRouter.get("/api/push/vapid-key", (req, res) => {
  try {
    res.json({ key: ensureVapid().publicKey, devices: pushSubscriptionCount(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

pushRouter.post("/api/push/subscribe", (req, res) => {
  try {
    saveSubscription(req.user.id, req.body?.subscription);
    res.json({ ok: true, devices: pushSubscriptionCount(req.user.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

pushRouter.post("/api/push/unsubscribe", (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) dropSubscription(endpoint);
  res.json({ ok: true, devices: pushSubscriptionCount(req.user.id) });
});

// A test knock on this user's own devices — proves the whole pipe.
pushRouter.post("/api/push/test", (req, res) => {
  pushToNames([req.user.name], {
    title: "Boxx Hub",
    body: "Notifications are working on this device.",
    tag: "push-test",
  });
  res.json({ ok: true });
});

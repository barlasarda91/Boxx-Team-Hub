import express from "express";
import cors    from "cors";
import path    from "path";
import fs      from "fs";
import { fileURLToPath } from "url";

try { const { default: d } = await import("dotenv"); d.config(); } catch {}

import { db, dbMigrate, DB_PATH, INVOICE_DIR } from "./server/db.js";
import { loadLocations, locationIds, squareSearchOrders } from "./server/square.js";
import { standingOrdersRouter } from "./server/routes/standingOrders.js";
import { gmailRouter } from "./server/routes/gmail.js";
import { invoicesRouter } from "./server/routes/invoices.js";
import { expensesRouter } from "./server/routes/expenses.js";
import { catalogRouter } from "./server/routes/catalog.js";
import { laborRouter } from "./server/routes/labor.js";
import { squareMapRouter } from "./server/routes/squareMap.js";
import { pipelinesRouter } from "./server/routes/pipelines.js";
import { hubRouter } from "./server/routes/hub.js";
import { boardRouter } from "./server/routes/board.js";
import { authMiddleware } from "./server/auth.js";
import { startCron } from "./server/cron.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 8080;

dbMigrate();

app.use(cors());
app.use(express.json({ strict: false, limit: "5mb" }));
app.use(authMiddleware);

// Daily presence: one row per user per LA day with any authenticated activity.
// Feeds the owner's weekly team-presence numbers.
import { laDateStr } from "./server/dates.js";
app.use((req, _res, next) => {
  if (req.user) {
    try { db.prepare("INSERT OR IGNORE INTO user_activity (user_id, date) VALUES (?, ?)").run(req.user.id, laDateStr()); }
    catch { /* never block a request over presence logging */ }
  }
  next();
});

// Analytics lives under Ben's Supplies domain; the owner keeps API access but
// sees it through Ben's reporting, not the nav. Everyone else: hub only.
const ANALYTICS_PREFIXES = [
  "/api/orders", "/api/catalog", "/api/claude", "/api/standing-orders",
  "/api/invoices", "/api/consumables", "/api/expenses", "/api/price-alerts",
  "/api/sync-log", "/api/settings", "/api/square", "/api/vendors", "/api/gmail",
  "/api/counts", "/api/pastry",
];
app.use((req, res, next) => {
  if (!req.user) return next(); // public paths (login, roster, gmail callback)
  if (ANALYTICS_PREFIXES.some(p => req.path.startsWith(p))) {
    if (req.user.role !== "owner" && req.user.name !== "Ben") {
      return res.status(403).json({ error: "Supplies analytics is Ben's domain" });
    }
  }
  next();
});

const SQUARE_BASE = "https://connect.squareup.com";
const API_KEY     = process.env.SQUARE_API_KEY;

// ── Fetch catalog item IDs for a given category name ─────────────────────────
app.get("/api/catalog/category/:categoryName", async (req, res) => {
  const targetCategory = req.params.categoryName;
  try {
    let allObjects = [], cursor = null;
    do {
      const body = {
        object_types: ["ITEM"],
        limit: 100,
        ...(cursor ? { cursor } : {}),
      };
      const r = await fetch(`${SQUARE_BASE}/v2/catalog/search`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json", "Square-Version": "2024-01-17" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      allObjects = allObjects.concat(data.objects || []);
      cursor     = data.cursor || null;
    } while (cursor);

    const matchingNames = new Set();
    allObjects.forEach(obj => {
      const itemData = obj.item_data;
      if (!itemData) return;
      const catName = itemData.category?.name || itemData.category_name || "";
      if (catName.toLowerCase() === targetCategory.toLowerCase()) {
        matchingNames.add(itemData.name);
        (itemData.variations || []).forEach(v => {
          const varName = v.item_variation_data?.name;
          if (varName && !["regular","standard","default"].includes(varName.toLowerCase())) {
            matchingNames.add(`${itemData.name} (${varName})`);
          } else {
            matchingNames.add(itemData.name);
          }
        });
      }
    });

    console.log(`📦 Category "${targetCategory}": ${matchingNames.size} items found`);
    res.json({ category: targetCategory, items: [...matchingNames] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Square orders proxy ───────────────────────────────────────────────────────
app.post("/api/orders", async (req, res) => {
  try {
    const data = await squareSearchOrders(req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Anthropic API proxy — forwards requests to Claude API ─────────────────────
app.post("/api/claude", async (req, res) => {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14"
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── Feature routes ────────────────────────────────────────────────────────────
app.use(hubRouter);
app.use(standingOrdersRouter);
app.use(gmailRouter);
app.use(invoicesRouter);
app.use(expensesRouter);
app.use(catalogRouter);
app.use(laborRouter);
app.use(squareMapRouter);
app.use(pipelinesRouter);
app.use(boardRouter);

app.get("/health", (_, res) => res.json({
  ok: true,
  locationIds,
  port: PORT,
  db: DB_PATH,
  invoiceDir: INVOICE_DIR,
}));

// ── Static ────────────────────────────────────────────────────────────────────
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));
app.use((req, res) => res.sendFile(path.join(distPath, "index.html")));

app.listen(PORT, async () => {
  console.log(`✅  Crumbs on port ${PORT}`);
  console.log(`📁  dist exists: ${fs.existsSync(distPath)}`);
  console.log(`🗄  SQLite at ${DB_PATH}`);
  await loadLocations();
  startCron();
});

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { nowISO } from "./dates.js";
import { hashPin } from "./pinhash.js";

// Railway volume at /data when present; ./data for local dev
const DEFAULT_DATA_DIR = fs.existsSync("/data") ? "/data" : "./data";
export const DB_PATH = process.env.DB_PATH || path.join(DEFAULT_DATA_DIR, "crumbs.db");
export const INVOICE_DIR = process.env.INVOICE_DIR || path.join(DEFAULT_DATA_DIR, "invoices");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(INVOICE_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── Migrations ───────────────────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS for the base schema, plus numbered incremental
// steps recorded in schema_migrations so later ALTERs never destroy data.

export function dbMigrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL UNIQUE,
      kind          TEXT NOT NULL,
      email_pattern TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS standing_order_versions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      effective_date TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      note           TEXT
    );

    CREATE TABLE IF NOT EXISTS standing_order_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id  INTEGER NOT NULL REFERENCES standing_order_versions(id) ON DELETE CASCADE,
      item_name   TEXT NOT NULL,
      vendor_id   INTEGER REFERENCES vendors(id),
      day_of_week TEXT NOT NULL,
      qty         REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_soi_version ON standing_order_items(version_id);

    CREATE TABLE IF NOT EXISTS invoices (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id        INTEGER REFERENCES vendors(id),
      invoice_number   TEXT,
      invoice_date     TEXT,
      source           TEXT NOT NULL,
      gmail_message_id TEXT,
      gmail_attachment_id TEXT,
      pdf_path         TEXT,
      subtotal         REAL,
      tax              REAL,
      total            REAL,
      status           TEXT NOT NULL DEFAULT 'pending_review',
      extraction_raw   TEXT,
      extraction_error TEXT,
      extracted_at     TEXT,
      confirmed_at     TEXT,
      created_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inv_vendor_date ON invoices(vendor_id, invoice_date);
    CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_gmail_dedup
      ON invoices(gmail_message_id, gmail_attachment_id)
      WHERE gmail_message_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS invoice_line_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      sku           TEXT,
      description   TEXT NOT NULL,
      qty           REAL NOT NULL,
      unit          TEXT,
      units_per_pack REAL,
      unit_price    REAL NOT NULL,
      line_total    REAL NOT NULL,
      consumable_id INTEGER REFERENCES consumables(id),
      edited        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ili_invoice ON invoice_line_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_ili_sku ON invoice_line_items(sku);

    CREATE TABLE IF NOT EXISTS consumables (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      method             TEXT NOT NULL,
      denominator        TEXT NOT NULL,
      rolling_window_days INTEGER,
      window_auto        INTEGER NOT NULL DEFAULT 1,
      active             INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consumable_sku_patterns (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      consumable_id INTEGER NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
      vendor_id     INTEGER REFERENCES vendors(id),
      pattern       TEXT NOT NULL,
      units_per_pack_override REAL
    );

    CREATE TABLE IF NOT EXISTS consumable_rules (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      consumable_id   INTEGER NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
      match_type      TEXT NOT NULL,
      match_value     TEXT NOT NULL,
      units_per_match REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consumable_baselines (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      consumable_id         INTEGER NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
      computed_at           TEXT NOT NULL,
      window_start          TEXT NOT NULL,
      window_end            TEXT NOT NULL,
      denominator_count     REAL NOT NULL,
      units_purchased       REAL,
      total_spend           REAL NOT NULL,
      cost_per_denominator  REAL NOT NULL,
      units_per_denominator REAL,
      purchase_events       INTEGER NOT NULL,
      confidence            TEXT NOT NULL,
      expected_units        REAL,
      variance_units        REAL,
      variance_pct          REAL
    );
    CREATE INDEX IF NOT EXISTS idx_cb_consumable ON consumable_baselines(consumable_id, computed_at);

    CREATE TABLE IF NOT EXISTS price_observations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
      sku_key       TEXT NOT NULL,
      observed_date TEXT NOT NULL,
      unit_price    REAL NOT NULL,
      unit          TEXT,
      invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_po_key ON price_observations(vendor_id, sku_key, observed_date);

    CREATE TABLE IF NOT EXISTS price_alerts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
      sku_key       TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'price',
      old_price     REAL NOT NULL,
      new_price     REAL NOT NULL,
      pct_change    REAL NOT NULL,
      old_unit      TEXT,
      new_unit      TEXT,
      old_date      TEXT NOT NULL,
      new_date      TEXT NOT NULL,
      invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      acknowledged  INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS square_daily_metrics (
      date              TEXT PRIMARY KEY,
      transaction_count INTEGER NOT NULL,
      drink_count       INTEGER NOT NULL,
      item_counts       TEXT NOT NULL,
      category_counts   TEXT NOT NULL,
      synced_at         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      provider      TEXT PRIMARY KEY,
      account_email TEXT,
      access_token  TEXT,
      refresh_token TEXT,
      expires_at    TEXT,
      scope         TEXT,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type     TEXT NOT NULL,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      status       TEXT NOT NULL,
      message      TEXT,
      items_processed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- ─── Hub: delegation core ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL UNIQUE,
      pin_hash  TEXT NOT NULL,
      role      TEXT NOT NULL DEFAULT 'member',   -- 'owner' | 'member'
      active    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS domains (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id       INTEGER REFERENCES users(id),
      name                TEXT NOT NULL,
      standard_md         TEXT,
      authority_limits_md TEXT,
      cadence_days        INTEGER NOT NULL DEFAULT 7,
      active              INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS check_ins (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id    INTEGER NOT NULL REFERENCES domains(id),
      user_id      INTEGER NOT NULL REFERENCES users(id),
      status       TEXT NOT NULL,                 -- 'green' | 'yellow' | 'red'
      note         TEXT,
      metrics_json TEXT,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_checkins_domain ON check_ins(domain_id, created_at);

    CREATE TABLE IF NOT EXISTS commitments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id    INTEGER NOT NULL REFERENCES domains(id),
      title        TEXT NOT NULL,
      due_date     TEXT NOT NULL,                 -- 'YYYY-MM-DD'
      repeat_rule  TEXT NOT NULL DEFAULT 'none',  -- 'none' | 'weekly' | 'monthly' | 'annual' | 'every:<n>d'
      done_at      TEXT,
      equipment_id INTEGER,
      notes        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commitments_domain ON commitments(domain_id, due_date);

    CREATE TABLE IF NOT EXISTS kpi_targets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id   INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      key         TEXT NOT NULL,
      comparator  TEXT NOT NULL DEFAULT '>=',
      target      REAL NOT NULL,
      period      TEXT NOT NULL DEFAULT 'month'
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id   INTEGER REFERENCES domains(id),
      raised_by   INTEGER REFERENCES users(id),
      source      TEXT NOT NULL DEFAULT 'check_in',  -- 'check_in' | 'swap_check' | 'price_alert' | 'manual'
      source_ref  TEXT,
      title       TEXT NOT NULL,
      detail      TEXT,
      state       TEXT NOT NULL DEFAULT 'open',      -- 'open' | 'approved' | 'declined' | 'acknowledged'
      owner_note  TEXT,
      created_at  TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_state ON decisions(state, created_at);

    CREATE TABLE IF NOT EXISTS one_on_ones (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id            INTEGER NOT NULL REFERENCES domains(id),
      held_at              TEXT NOT NULL,
      agenda_snapshot_json TEXT,
      notes_md             TEXT
    );

    CREATE TABLE IF NOT EXISTS action_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      one_on_one_id   INTEGER REFERENCES one_on_ones(id),
      domain_id       INTEGER NOT NULL REFERENCES domains(id),
      text            TEXT NOT NULL,
      done_at         TEXT,
      carried_from_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS agenda_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id   INTEGER NOT NULL REFERENCES domains(id),
      text        TEXT NOT NULL,
      added_by    INTEGER REFERENCES users(id),
      created_at  TEXT NOT NULL,
      resolved_at TEXT
    );
  `);

  // Incremental ALTER TABLE migrations go here as [id, sql] pairs.
  const steps = [];
  const applied = new Set(db.prepare("SELECT id FROM schema_migrations").all().map(r => r.id));
  for (const [id, sql] of steps) {
    if (applied.has(id)) continue;
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(id, nowISO());
  }

  seedVendors();
  seedHub();
}

// ─── Hub seeds: the seven team members + owner, and their domains ─────────────
// Initial PIN is 0000 for everyone; the owner resets PINs from Settings.
const TEAM = [
  ["Alex",    "Team Wellness",        "Birthday checklists (cake, event, gift — pinned from T-30 until done), team dinners and events. One team event required every month, birthday or not. Spend above the limit goes to the owner."],
  ["Amin",    "Content Shooting",     "Shoot everything on the shot list ahead of its post date, guided by the monthly shooting brief. Upload footage to Drive/Dropbox and attach the folder link when marking an item filmed."],
  ["Ben",     "Supplies",             "Own both ordering streams: pastry standing orders and consumables. Keep items at par via counts, review and confirm invoices, act on price alerts. Vendor-switch decisions and stockout risks escalate."],
  ["Brandon", "Events & Pop-Ups",     "Run the pipeline inquiry → confirmed → executed → recapped. At least 2 events executed per month. Contracts or spend above the limit go to the owner."],
  ["Manny",   "Equipment Maintenance","Keep every machine on its maintenance schedule (sub-tasks per machine; cartridge changes are deadline-based). Anything overdue escalates to the owner immediately; machine down = decision immediately."],
  ["Travis",  "Side Works & OT",      "Track side works completion and keep overtime at zero. Check every shift swap with the OT checker; anything that triggers OT is raised to the owner before it happens."],
  ["Vicky",   "Social & Influencers", "Plan and post across Instagram, TikTok and Red with equal weight. Next week's posts agreed in the weekly 1:1. Write the monthly shooting brief before month start. Maintain the tiered influencer reference list; paid collabs above the limit escalate."],
];

function seedHub() {
  if (db.prepare("SELECT COUNT(*) n FROM users").get().n > 0) return;
  const now = nowISO();
  const defaultPin = hashPin("0000");
  const insertUser = db.prepare("INSERT INTO users (name, pin_hash, role, created_at) VALUES (?, ?, ?, ?)");
  const insertDomain = db.prepare(
    "INSERT INTO domains (owner_user_id, name, standard_md, authority_limits_md, cadence_days) VALUES (?, ?, ?, ?, 7)"
  );
  insertUser.run("Owner", defaultPin, "owner", now);
  for (const [name, domain, standard] of TEAM) {
    const { lastInsertRowid: userId } = insertUser.run(name, defaultPin, "member", now);
    insertDomain.run(userId, domain, standard, "[Authority limits to be set by the owner]");
  }
  console.log("👥 Hub seeded: Owner + 7 members (initial PIN 0000)");
}

function seedVendors() {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO vendors (name, kind, email_pattern, created_at) VALUES (?, ?, ?, ?)"
  );
  // email_pattern left NULL for supply vendors — filled from real invoice
  // emails via the Settings UI rather than hardcoded guesses.
  const seed = [
    ["Shoreline",    "supply"],
    ["Odeko",        "supply"],
    ["Sam Robinson", "pastry"],
    ["Oh La La",     "pastry"],
  ];
  for (const [name, kind] of seed) insert.run(name, kind, null, nowISO());
}

// ─── Settings ─────────────────────────────────────────────────────────────────
const SETTING_DEFAULTS = {
  price_alert_threshold_pct: 3,
  drink_categories: [],   // Square category names that count as a "drink"
  drink_items: [],        // Square item names that count as a "drink"
};

export function getSetting(key) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  if (!row) return SETTING_DEFAULTS[key];
  try { return JSON.parse(row.value); } catch { return SETTING_DEFAULTS[key]; }
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, JSON.stringify(value));
}

export function getAllSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const row of db.prepare("SELECT key, value FROM app_settings").all()) {
    try { out[row.key] = JSON.parse(row.value); } catch {}
  }
  return out;
}

// ─── Sync log helper ──────────────────────────────────────────────────────────
export function logJob(jobType, fn) {
  const started = nowISO();
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO sync_log (job_type, started_at, status) VALUES (?, ?, 'running')"
  ).run(jobType, started);
  const finish = (status, message, items = 0) =>
    db.prepare("UPDATE sync_log SET finished_at = ?, status = ?, message = ?, items_processed = ? WHERE id = ?")
      .run(nowISO(), status, message ?? null, items, id);
  return Promise.resolve()
    .then(fn)
    .then(result => {
      finish("success", result?.message, result?.items ?? 0);
      return result;
    })
    .catch(err => {
      finish("error", err.message);
      throw err;
    });
}

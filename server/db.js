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
      qty         REAL NOT NULL,
      unit_price  REAL
    );

    -- Timecard vs schedule variances over the threshold, recorded weekly
    CREATE TABLE IF NOT EXISTS labor_variances (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      week_monday  TEXT NOT NULL,
      member_name  TEXT NOT NULL,
      date         TEXT NOT NULL,
      kind         TEXT NOT NULL,            -- 'late_in' | 'early_in' | 'early_out' | 'late_out' | 'no_show' | 'unscheduled'
      scheduled_at TEXT,
      actual_at    TEXT,
      diff_min     INTEGER,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lv_week ON labor_variances(week_monday, member_name);

    -- Swap checker: Claude parses the request, code decides. Full audit trail.
    CREATE TABLE IF NOT EXISTS swap_checks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      requested_by INTEGER REFERENCES users(id),
      request_text TEXT NOT NULL,
      parsed_json  TEXT,
      verdict_json TEXT,
      decision_id  INTEGER REFERENCES decisions(id),
      source       TEXT NOT NULL DEFAULT 'claude',  -- 'claude' (pasted text) | 'member' (in-app form)
      swap_date    TEXT,                            -- YYYY-MM-DD for member requests
      created_at   TEXT NOT NULL
    );

    -- Vicky: content calendar posts (thumbnails stored on disk, path only)
    CREATE TABLE IF NOT EXISTS posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_date  TEXT NOT NULL,
      platforms  TEXT NOT NULL DEFAULT '',   -- csv of IG,TIKTOK,RED
      caption    TEXT,
      image_path TEXT,
      folder_url TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(post_date);

    CREATE TABLE IF NOT EXISTS week_notes (
      week_monday TEXT PRIMARY KEY,
      note        TEXT NOT NULL DEFAULT ''
    );

    -- Monthly shooting brief, shared between Vicky and Amin
    CREATE TABLE IF NOT EXISTS shooting_briefs (
      month      TEXT PRIMARY KEY,            -- 'YYYY-MM'
      text       TEXT NOT NULL DEFAULT '',
      folder_url TEXT,
      updated_at TEXT NOT NULL
    );

    -- Amin: content folders, links only — the hub never renders contents
    CREATE TABLE IF NOT EXISTS content_folders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      provider   TEXT,                        -- 'Google Drive' | 'Dropbox' | ...
      url        TEXT NOT NULL,
      note       TEXT,
      created_at TEXT NOT NULL
    );

    -- Vicky: influencer reference list, tiers 1 (pursue most) to 5 (inbound)
    CREATE TABLE IF NOT EXISTS influencers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      tier       INTEGER NOT NULL DEFAULT 3,
      platforms  TEXT,                        -- csv IG,TIKTOK,RED
      followers  TEXT,
      contact    TEXT,
      status     TEXT,
      next_step  TEXT,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collabs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
      when_text     TEXT NOT NULL,
      description   TEXT NOT NULL,
      cost          TEXT,
      result        TEXT
    );

    -- Brandon: events pipeline; pace KPI is two per month
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      event_date  TEXT NOT NULL,
      time_text   TEXT,
      venue       TEXT,
      status      TEXT NOT NULL DEFAULT 'hold',  -- 'hold' | 'confirmed' | 'done' | 'cancelled'
      staffing    TEXT,
      setup       TEXT,
      budget_note TEXT,
      recap       TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);

    -- Alex: birthdays pin at T-30 with three checkboxes until all resolved
    CREATE TABLE IF NOT EXISTS birthdays (
      member_name TEXT PRIMARY KEY,
      birth_date  TEXT NOT NULL                -- 'MM-DD'
    );
    CREATE TABLE IF NOT EXISTS birthday_tasks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      member_name   TEXT NOT NULL,
      year          INTEGER NOT NULL,
      cake_done_at  TEXT,
      event_done_at TEXT,
      gift_done_at  TEXT,
      UNIQUE(member_name, year)
    );
    -- Alex: one team event every month, birthdays or not
    CREATE TABLE IF NOT EXISTS team_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      month      TEXT NOT NULL,                -- 'YYYY-MM'
      title      TEXT NOT NULL,
      event_date TEXT,
      status     TEXT NOT NULL DEFAULT 'planned', -- 'planned' | 'done' | 'cancelled'
      notes      TEXT
    );

    -- Manny: equipment register, deadline tasks (overdue escalates), service log
    CREATE TABLE IF NOT EXISTS equipment (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      detail TEXT,
      status TEXT NOT NULL DEFAULT 'ok'        -- 'ok' | 'watch' | 'flag'
    );
    CREATE TABLE IF NOT EXISTS equipment_tasks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      due_date     TEXT NOT NULL,
      done_at      TEXT,
      escalated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS service_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
      entry_date   TEXT NOT NULL,
      text         TEXT NOT NULL,
      cost         TEXT
    );

    -- Standing staff schedule, versioned like the pastry order
    CREATE TABLE IF NOT EXISTS schedule_versions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      effective_date TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      note           TEXT
    );
    CREATE TABLE IF NOT EXISTS schedule_shifts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id  INTEGER NOT NULL REFERENCES schedule_versions(id) ON DELETE CASCADE,
      member_name TEXT NOT NULL,
      day_of_week TEXT NOT NULL,               -- 'Monday'..'Sunday'
      shift_code  TEXT NOT NULL,               -- 'OPEN' | 'MID' | 'CLOSE' | 'OFF' | 'ROASTERY'
      start_min   INTEGER,                     -- minutes from midnight LA; NULL for OFF/ROASTERY
      end_min     INTEGER
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
      must_change_pin INTEGER NOT NULL DEFAULT 1,
      square_name TEXT,                           -- exact Square team-member name
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
      active              INTEGER NOT NULL DEFAULT 1,
      oneonone_day        TEXT,                     -- 'Monday'..'Sunday'
      oneonone_time       TEXT                      -- 'HH:MM' 24h, LA time
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

    -- ─── Ben: item catalogue (three-level naming from the master sheet) ───────
    -- catalog_items = the Front-Facing level Ben counts at ("Almond Milk");
    -- catalog_listings = canonical product × vendor rows underneath it.
    CREATE TABLE IF NOT EXISTS catalog_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      front_name TEXT NOT NULL UNIQUE,
      parent     TEXT,
      category   TEXT,
      count_unit TEXT,
      par_level  REAL,
      active     INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS catalog_listings (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      catalog_item_id   INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      canonical_item    TEXT NOT NULL,
      vendor_id         INTEGER REFERENCES vendors(id),
      vendor_description TEXT,
      sku               TEXT,
      pack_qty          REAL,
      order_unit        TEXT,
      latest_pack_price REAL,
      latest_price_date TEXT,
      active            INTEGER NOT NULL DEFAULT 1,
      source            TEXT NOT NULL DEFAULT 'import'  -- 'import' (sheet) | 'app' (review queue)
    );
    CREATE INDEX IF NOT EXISTS idx_cl_item ON catalog_listings(catalog_item_id);
    CREATE INDEX IF NOT EXISTS idx_cl_vendor ON catalog_listings(vendor_id);

    -- Invoice lines that matched no catalogue listing: Ben reviews on the
    -- Catalogue tab and links, adds, or ignores. One row per vendor × sku_key;
    -- resolved rows stay so the same line never re-queues.
    CREATE TABLE IF NOT EXISTS catalog_review_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER REFERENCES vendors(id),
      sku_key     TEXT NOT NULL,
      sku         TEXT,
      description TEXT NOT NULL,
      unit        TEXT,
      unit_price  REAL,
      pack_qty    REAL,
      invoice_id  INTEGER REFERENCES invoices(id),
      suggested_catalog_item_id INTEGER REFERENCES catalog_items(id),
      status      TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'linked' | 'added' | 'ignored'
      created_at  TEXT NOT NULL,
      resolved_at TEXT,
      UNIQUE(vendor_id, sku_key)
    );

    CREATE TABLE IF NOT EXISTS count_sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER REFERENCES users(id),
      started_at   TEXT NOT NULL,
      confirmed_at TEXT,
      status       TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'confirmed' | 'abandoned'
      report_json  TEXT
    );

    CREATE TABLE IF NOT EXISTS count_lines (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      count_session_id INTEGER NOT NULL REFERENCES count_sessions(id) ON DELETE CASCADE,
      catalog_item_id  INTEGER NOT NULL REFERENCES catalog_items(id),
      units_counted    REAL
    );
    CREATE INDEX IF NOT EXISTS idx_cnl_session ON count_lines(count_session_id);

    -- ─── Ben: pastry billing reconciliation (Oh La La) ────────────────────────
    CREATE TABLE IF NOT EXISTS pastry_deliveries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      vendor_id     INTEGER REFERENCES vendors(id),
      delivery_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pastry_delivery_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      pastry_delivery_id  INTEGER NOT NULL REFERENCES pastry_deliveries(id) ON DELETE CASCADE,
      item_name           TEXT NOT NULL,
      qty_billed          REAL NOT NULL,
      unit_price          REAL,
      qty_expected        REAL                       -- from the standing order; NULL = no match
    );
    CREATE INDEX IF NOT EXISTS idx_pdl_delivery ON pastry_delivery_lines(pastry_delivery_id);

    -- Ben's Square-to-app item mapping: square_key is the normalized
    -- "Item (Variation)" label; app_item NULL means "ignore, not tracked".
    CREATE TABLE IF NOT EXISTS square_item_map (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      square_key   TEXT NOT NULL UNIQUE,
      square_label TEXT NOT NULL,
      app_item     TEXT,
      updated_at   TEXT NOT NULL
    );

    -- One-day schedule overrides from approved swaps: on this date this member
    -- works THIS instead of the weekly grid ('OFF' = freed by a cover;
    -- 'STACKED' = their own shift plus the covered one, span = the union).
    CREATE TABLE IF NOT EXISTS schedule_exceptions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      date           TEXT NOT NULL,
      member_name    TEXT NOT NULL,
      shift_code     TEXT NOT NULL,
      start_min      INTEGER,
      end_min        INTEGER,
      source_swap_id INTEGER REFERENCES swap_checks(id),
      created_at     TEXT NOT NULL,
      UNIQUE(date, member_name)
    );

    -- Published weekly pastry reports: frozen snapshots, one per Monday
    CREATE TABLE IF NOT EXISTS pastry_week_reports (
      monday       TEXT PRIMARY KEY,
      report_json  TEXT NOT NULL,
      published_at TEXT NOT NULL
    );

    -- Per-item pastry settings: Ben's ideal sell-out time, the benchmark the
    -- deep dive measures early sell-outs and order suggestions against.
    CREATE TABLE IF NOT EXISTS pastry_item_settings (
      item              TEXT PRIMARY KEY,           -- normKey of the item name
      ideal_sellout_min INTEGER,                    -- minutes from midnight LA
      updated_at        TEXT NOT NULL
    );

    -- ─── Team Board: one feed, two kinds of post ──────────────────────────────
    -- kind 'post' is a plain message; kind 'waiting_on' is a tracked blocker
    -- with an owner (waiting_on), a need-by date, and a lifecycle:
    -- open → delivered (holder says done) → cleared (author confirms).
    -- The TYPE is what the member picked in the composer — never inferred.
    CREATE TABLE IF NOT EXISTS board_posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id   INTEGER NOT NULL REFERENCES users(id),
      kind        TEXT NOT NULL DEFAULT 'post',   -- 'post' | 'waiting_on'
      text        TEXT NOT NULL,
      mentions    TEXT,                            -- JSON array of member names (literal @Name matches)
      attach_kind TEXT,                            -- 'event' | 'equipment' | 'invoice' | NULL
      attach_label TEXT,
      waiting_on  TEXT,                            -- member name (kind waiting_on)
      need_by     TEXT,                            -- YYYY-MM-DD
      delivered_at TEXT,
      cleared_at  TEXT,
      escalated_decision_id INTEGER REFERENCES decisions(id),
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bp_created ON board_posts(id);

    -- Per-user read marker: badge = posts past this that mention me or wait on me
    CREATE TABLE IF NOT EXISTS board_reads (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id),
      last_seen_id  INTEGER NOT NULL DEFAULT 0
    );

    -- Every Claude API call the app makes, metered from the response's real
    -- token usage. Feeds the owner's Costs tab in Settings.
    CREATE TABLE IF NOT EXISTS llm_usage (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      at            TEXT NOT NULL,
      purpose       TEXT NOT NULL,   -- 'invoice_extract' | 'order_image' | 'swap_parse'
      model         TEXT NOT NULL,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd      REAL NOT NULL DEFAULT 0,
      meta          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_llm_at ON llm_usage(at);
  `);

  // Incremental ALTER TABLE migrations go here as [id, sql] pairs.
  const steps = [
    [1, "ALTER TABLE users ADD COLUMN must_change_pin INTEGER NOT NULL DEFAULT 1"],
    // Sam Robinson discontinued (2026-09-18): Oh La La is the only pastry vendor.
    [2, "UPDATE vendors SET active = 0 WHERE name = 'Sam Robinson'"],
    // Standing orders now carry the unit price from the order sheet.
    [3, "ALTER TABLE standing_order_items ADD COLUMN unit_price REAL"],
    // Name matching became case/punctuation-insensitive (2026-09-21):
    // rebuild published reports with the corrected matching.
    [4, "DELETE FROM pastry_week_reports"],
    // Listings created from the invoice review queue survive re-imports.
    [5, "ALTER TABLE catalog_listings ADD COLUMN source TEXT NOT NULL DEFAULT 'import'"],
    // Members request swaps from a form in the app, no Claude parse needed.
    [6, "ALTER TABLE swap_checks ADD COLUMN source TEXT NOT NULL DEFAULT 'claude'"],
    [7, "ALTER TABLE swap_checks ADD COLUMN swap_date TEXT"],
    // Each 1:1 gets a standing weekly meeting slot, set in the app.
    [8, "ALTER TABLE domains ADD COLUMN oneonone_day TEXT"],
    [9, "ALTER TABLE domains ADD COLUMN oneonone_time TEXT"],
    // Approved swaps write one-day schedule exceptions; applied_at marks it.
    [10, "ALTER TABLE swap_checks ADD COLUMN applied_at TEXT"],
    // Explicit Square name per member for timecard matching (falls back to
    // first-name matching when unset).
    [11, "ALTER TABLE users ADD COLUMN square_name TEXT"],
    // Reports gained per-item hourly sale histograms (2026-09-23): rebuild.
    [12, "DELETE FROM pastry_week_reports"],
  ];
  const applied = new Set(db.prepare("SELECT id FROM schema_migrations").all().map(r => r.id));
  for (const [id, sql] of steps) {
    if (applied.has(id)) continue;
    try {
      db.exec(sql);
    } catch (err) {
      // A fresh DB already has the column from CREATE TABLE — that's fine.
      if (!/duplicate column/i.test(err.message)) throw err;
    }
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(id, nowISO());
  }

  seedVendors();
  seedHub();
  seedSchedule();
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

// The current standing schedule as provided 2026-09-20 (Amin newly added).
// Shift times: OPEN 6-12 / 6-1, MID 9-4, CLOSE 12-7 / 1-7. ROASTERY days have
// no store hours to check timecards against.
function seedSchedule() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM schedule_versions").get().n;
  if (existing > 0) return;
  const S = (code, from, to) => ({ code, from, to });
  const OFF = S("OFF", null, null), ROAST = S("ROASTERY", null, null);
  const O612 = S("OPEN", 360, 720), O61 = S("OPEN", 360, 780);
  const M94 = S("MID", 540, 960);
  const C127 = S("CLOSE", 720, 1140), C17 = S("CLOSE", 780, 1140);
  // Order: [Sun, Mon, Tue, Wed, Thu, Fri, Sat] as the sheet reads
  const GRID = {
    Alex:    [O612, C127, C127, OFF,  OFF,  O612, O612],
    Amin:    [C17,  OFF,  OFF,  OFF,  C17,  O612, OFF],
    Ben:     [C17,  OFF,  O61,  O61,  O61,  OFF,  C127],
    Brandon: [OFF,  O61,  O61,  O61,  C127, C17,  OFF],
    Manny:   [O61,  O61,  OFF,  OFF,  O61,  C17,  M94],
    Travis:  [OFF,  OFF,  ROAST, C127, ROAST, M94, C17],
    Vicky:   [M94,  C127, C127, C127, OFF,  OFF,  O612],
  };
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const { lastInsertRowid: versionId } = db.prepare(
    "INSERT INTO schedule_versions (effective_date, created_at, note) VALUES (?, ?, ?)"
  ).run("2026-09-14", nowISO(), "Initial schedule as provided (Amin added)");
  const ins = db.prepare(
    "INSERT INTO schedule_shifts (version_id, member_name, day_of_week, shift_code, start_min, end_min) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const [name, days] of Object.entries(GRID)) {
    days.forEach((s, i) => ins.run(versionId, name, DAYS[i], s.code, s.from, s.to));
  }
  console.log("🗓  Schedule seeded (v1, effective 2026-09-14)");
}

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
    "INSERT OR IGNORE INTO vendors (name, kind, email_pattern, active, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  // email_pattern left NULL for supply vendors — filled from real invoice
  // emails via the Settings UI rather than hardcoded guesses.
  // Sam Robinson is discontinued and seeds inactive (kept for history).
  const seed = [
    ["Shoreline",    "supply", 1],
    ["Odeko",        "supply", 1],
    ["Sam Robinson", "pastry", 0],
    ["Oh La La",     "pastry", 1],
  ];
  for (const [name, kind, active] of seed) insert.run(name, kind, null, active, nowISO());
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

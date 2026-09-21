import cron from "node-cron";
import { logJob } from "./db.js";
import { syncSquareMetricsLogged } from "./square.js";
import { runGmailSyncLogged, getStoredTokens } from "./gmail.js";
import { recomputeAllLogged } from "./baselines.js";
import { publishWeekReport, lastCompletedMonday, backfillReports } from "./pastryWeek.js";
import { submitWeekVariances } from "./labor.js";
import { escalateOverdueEquipment } from "./routes/pipelines.js";
import { escalateStaleBlockers } from "./routes/board.js";
import { db, setSetting } from "./db.js";
import { laDateStr } from "./dates.js";

// One card for the owner's Monday: what last week left behind.
export function buildMondayDigest() {
  const monday = lastCompletedMonday();
  const today = laDateStr();
  const rep = db.prepare("SELECT report_json FROM pastry_week_reports WHERE monday = ?").get(monday);
  const totals = rep ? JSON.parse(rep.report_json).totals : null;
  const variances = db.prepare("SELECT COUNT(*) AS n FROM labor_variances WHERE week_monday = ?").get(monday).n;
  const openDecisions = db.prepare("SELECT COUNT(*) AS n FROM decisions WHERE state = 'open'").get().n;
  const overdue = db.prepare("SELECT COUNT(*) AS n FROM commitments WHERE done_at IS NULL AND due_date < ?").get(today).n;
  const eventsMonth = db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_date LIKE ? AND status != 'cancelled'")
    .get(`${today.slice(0, 7)}%`).n;
  setSetting("monday_digest", JSON.stringify({
    week: monday, built_at: today,
    pastry: totals, variances, open_decisions: openDecisions,
    overdue_commitments: overdue, events_this_month: eventsMonth,
  }));
}
import { LA_TZ } from "./dates.js";

// Monday 06:00 America/Los_Angeles. Stages invoices as pending_review only —
// nothing auto-confirms. Each step is wrapped so one failure doesn't abort the
// rest, and each step writes its own sync_log row.
export function startCron() {
  cron.schedule("0 6 * * 1", runMondayJob, { timezone: LA_TZ });
  // Watch billing@ through the day: every 2 hours, 7am-7pm LA. Idempotent —
  // (gmail_message_id, gmail_attachment_id) is unique, so re-runs skip
  // anything already staged. Everything lands as pending_review, never
  // auto-confirmed.
  cron.schedule("0 7-19/2 * * *", async () => {
    if (!getStoredTokens()?.refresh_token) return;
    try {
      const r = await runGmailSyncLogged({ days: 3 });
      if (r.created > 0) console.log(`📧 billing@ watch: ${r.message}`);
    } catch (err) { console.error("billing@ watch:", err.message); }
  }, { timezone: LA_TZ });

  // Equipment deadlines escalate the morning they go overdue, not on Monday;
  // team-board blockers that sat 48h unanswered escalate the same way.
  cron.schedule("15 6 * * *", () => {
    try {
      const n = escalateOverdueEquipment();
      if (n > 0) logJob("equipment_escalation", async () => ({ message: `${n} overdue task(s) escalated`, items: n }));
    } catch (err) { console.error("equipment escalation:", err.message); }
    try {
      const n = escalateStaleBlockers();
      if (n > 0) logJob("blocker_escalation", async () => ({ message: `${n} stale blocker(s) escalated`, items: n }));
    } catch (err) { console.error("blocker escalation:", err.message); }
  }, { timezone: LA_TZ });
  console.log("⏰ Monday 06:00 + daily 06:15 + billing@ watch (2h, 7a-7p) scheduled");
}

export async function runMondayJob() {
  return logJob("monday_job", async () => {
    const results = [];

    try {
      const r = await syncSquareMetricsLogged({ days: 14 });
      results.push(`square: ${r.message}`);
    } catch (err) {
      results.push(`square FAILED: ${err.message}`);
    }

    if (getStoredTokens()?.refresh_token) {
      try {
        const r = await runGmailSyncLogged({ days: 14 });
        results.push(`gmail: ${r.message}`);
      } catch (err) {
        results.push(`gmail FAILED: ${err.message}`);
      }
    } else {
      results.push("gmail: skipped (not connected)");
    }

    try {
      const r = await recomputeAllLogged();
      results.push(`baselines: ${r.message}`);
    } catch (err) {
      results.push(`baselines FAILED: ${err.message}`);
    }

    try {
      const monday = lastCompletedMonday();
      await publishWeekReport(monday);
      const back = await backfillReports();
      results.push(`pastry report: published week of ${monday}${back.count ? ` + ${back.count} backfilled` : ""}`);
    } catch (err) {
      results.push(`pastry report FAILED: ${err.message}`);
    }

    try {
      const monday = lastCompletedMonday();
      const r = await submitWeekVariances(monday);
      results.push(`timecards: ${r.count} variances submitted for week of ${monday}`);
    } catch (err) {
      results.push(`timecards FAILED: ${err.message}`);
    }

    try {
      buildMondayDigest();
      results.push("digest: assembled");
    } catch (err) {
      results.push(`digest FAILED: ${err.message}`);
    }

    return { message: results.join(" | "), items: results.length };
  });
}

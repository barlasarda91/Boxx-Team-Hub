import cron from "node-cron";
import { logJob } from "./db.js";
import { syncSquareMetricsLogged } from "./square.js";
import { runGmailSyncLogged, getStoredTokens } from "./gmail.js";
import { recomputeAllLogged } from "./baselines.js";
import { publishWeekReport, lastCompletedMonday, backfillReports } from "./pastryWeek.js";
import { submitWeekVariances } from "./labor.js";
import { escalateOverdueEquipment } from "./routes/pipelines.js";
import { escalateStaleBlockers } from "./routes/board.js";
import { runBackup } from "./backup.js";
import { sweepOneOnOnes } from "./routes/hub.js";
import { db, setSetting } from "./db.js";
import { laDateStr } from "./dates.js";

// The owner's week in review: what last week left behind. Computed live for
// the Overview (all local SQLite, cheap) and frozen into a setting on Monday.
export function computeWeekDigest() {
  const monday = lastCompletedMonday();
  const today = laDateStr();
  const rep = db.prepare("SELECT report_json FROM pastry_week_reports WHERE monday = ?").get(monday);
  let totals = null, topWaste = [];
  if (rep) {
    const report = JSON.parse(rep.report_json);
    totals = report.totals;
    topWaste = (report.items || [])
      .filter(i => i.waste > 0)
      .sort((a, b) => (b.waste_value || 0) - (a.waste_value || 0) || b.waste - a.waste)
      .slice(0, 3)
      .map(i => ({ item: i.item, waste: i.waste, waste_value: i.waste_value ?? null }));
  }
  const varianceRows = db.prepare(
    "SELECT member_name, kind, COUNT(*) AS n FROM labor_variances WHERE week_monday = ? GROUP BY member_name, kind"
  ).all(monday);
  const byMember = {};
  let noShows = 0;
  for (const r of varianceRows) {
    byMember[r.member_name] = (byMember[r.member_name] || 0) + r.n;
    if (r.kind === "no_show") noShows += r.n;
  }
  const variancesByMember = Object.entries(byMember)
    .map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);

  // Detail rows for the tile pop-ups — small, bounded lists
  const varianceRowsDetail = db.prepare(`
    SELECT member_name, date, kind, diff_min FROM labor_variances
    WHERE week_monday = ? ORDER BY member_name, date LIMIT 80
  `).all(monday);
  const overdueList = db.prepare(`
    SELECT c.title, c.due_date, u.name AS owner_name FROM commitments c
    JOIN domains d ON d.id = c.domain_id LEFT JOIN users u ON u.id = d.owner_user_id
    WHERE c.done_at IS NULL AND c.due_date < ? ORDER BY c.due_date LIMIT 20
  `).all(today);
  const eventsList = db.prepare(
    "SELECT title, event_date, status FROM events WHERE event_date LIKE ? AND status != 'cancelled' ORDER BY event_date"
  ).all(`${today.slice(0, 7)}%`);
  const checkedInNames = db.prepare(`
    SELECT DISTINCT u.name FROM check_ins c JOIN users u ON u.id = c.user_id WHERE c.created_at >= ?
  `).all(new Date(Date.now() - 7 * 86400000).toISOString()).map(r => r.name);
  const allMembers = db.prepare("SELECT name FROM users WHERE active = 1 AND role != 'owner'").all().map(r => r.name);

  // Team presence: days with any in-app activity over the last 7 LA days.
  // The bar is once a day, every day.
  const weekAgo = laDateStr(new Date(Date.now() - 6 * 86400000));
  const presence = db.prepare(`
    SELECT u.name, COUNT(a.date) AS days FROM users u
    LEFT JOIN user_activity a ON a.user_id = u.id AND a.date >= ? AND a.date <= ?
    WHERE u.active = 1 AND u.role != 'owner'
    GROUP BY u.id ORDER BY days ASC, u.name
  `).all(weekAgo, today);
  const presenceAvg = presence.length
    ? Math.round(presence.reduce((a, p) => a + p.days, 0) / presence.length * 10) / 10 : null;

  const openDecisions = db.prepare("SELECT COUNT(*) AS n FROM decisions WHERE state = 'open'").get().n;

  return {
    week: monday, built_at: today,
    pastry: totals, top_waste: topWaste,
    variances: variancesByMember.reduce((a, v) => a + v.n, 0),
    variances_by_member: variancesByMember, no_shows: noShows,
    variance_rows: varianceRowsDetail,
    open_decisions: openDecisions,
    overdue_commitments: overdueList.length, overdue_list: overdueList,
    events_this_month: eventsList.length, events_list: eventsList,
    checked_in_week: checkedInNames.length,
    checked_in_names: checkedInNames,
    missing_check_ins: allMembers.filter(n => !checkedInNames.includes(n)),
    presence, presence_avg: presenceAvg,
  };
}

export function buildMondayDigest() {
  setSetting("monday_digest", JSON.stringify(computeWeekDigest()));
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
    // 1:1 lifecycle advances even if nobody opens the tab: overdue drafts
    // auto-publish, day-old published meetings close, fresh drafts open.
    try { sweepOneOnOnes(); } catch (err) { console.error("1:1 sweep:", err.message); }
  }, { timezone: LA_TZ });
  // Nightly snapshot before the morning jobs touch anything
  cron.schedule("45 5 * * *", () => {
    logJob("backup", runBackup).catch(err => console.error("backup:", err.message));
  }, { timezone: LA_TZ });

  console.log("⏰ Monday 06:00 + daily 05:45 backup + 06:15 + billing@ watch (2h, 7a-7p) scheduled");
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

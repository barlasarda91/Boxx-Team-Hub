import cron from "node-cron";
import { logJob } from "./db.js";
import { syncSquareMetricsLogged } from "./square.js";
import { runGmailSyncLogged, getStoredTokens } from "./gmail.js";
import { recomputeAllLogged } from "./baselines.js";
import { publishWeekReport, lastCompletedMonday } from "./pastryWeek.js";
import { submitWeekVariances } from "./labor.js";
import { LA_TZ } from "./dates.js";

// Monday 06:00 America/Los_Angeles. Stages invoices as pending_review only —
// nothing auto-confirms. Each step is wrapped so one failure doesn't abort the
// rest, and each step writes its own sync_log row.
export function startCron() {
  cron.schedule("0 6 * * 1", runMondayJob, { timezone: LA_TZ });
  console.log("⏰ Monday 06:00 PT job scheduled");
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
      results.push(`pastry report: published week of ${monday}`);
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

    return { message: results.join(" | "), items: results.length };
  });
}

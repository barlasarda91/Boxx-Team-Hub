import { db } from "./db.js";
import { laDateStr, laToUtcISO, addDaysStr, dateRange, nowISO, dayOfWeek } from "./dates.js";
import { recordLlmUsage } from "./usage.js";

const SQUARE_BASE = "https://connect.squareup.com";
const headers = () => ({
  "Authorization": `Bearer ${process.env.SQUARE_API_KEY}`,
  "Content-Type": "application/json",
  "Square-Version": "2024-01-17",
});

const VARIANCE_MIN = 5;               // minutes of grace either side
const HUB_NAMES = ["Alex", "Amin", "Ben", "Brandon", "Manny", "Travis", "Vicky"];

async function squarePost(path, body) {
  if (!process.env.SQUARE_API_KEY) throw new Error("SQUARE_API_KEY is not configured");
  const res = await fetch(`${SQUARE_BASE}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `${path} returned ${res.status}`);
  return data || {};
}

async function teamMemberNames() {
  const map = {};
  let cursor = null;
  do {
    const data = await squarePost("/v2/team-members/search", { limit: 200, ...(cursor ? { cursor } : {}) });
    for (const tm of data.team_members || []) {
      const given = (tm.given_name || "").trim();
      const full = `${given} ${(tm.family_name || "").trim()}`.trim();
      const hub = HUB_NAMES.find(n => n.toLowerCase() === given.toLowerCase());
      map[tm.id] = hub || full || tm.id;
    }
    cursor = data.cursor || null;
  } while (cursor);
  return map;
}

async function fetchTimecards(mondayStr) {
  const sundayStr = addDaysStr(mondayStr, 6);
  let shifts = [], cursor = null;
  do {
    const data = await squarePost("/v2/labor/shifts/search", {
      query: {
        filter: {
          workday: {
            date_range: { start_date: mondayStr, end_date: sundayStr },
            match_shifts_by: "START_AT",
            default_timezone: "America/Los_Angeles",
          },
        },
        sort: { field: "START_AT", order: "ASC" },
      },
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    shifts = shifts.concat(data.shifts || []);
    cursor = data.cursor || null;
  } while (cursor);
  return shifts;
}

function scheduleFor(dateStr) {
  const v = db.prepare(
    "SELECT id FROM schedule_versions WHERE effective_date <= ? ORDER BY effective_date DESC, id DESC LIMIT 1"
  ).get(dateStr);
  if (!v) return {};
  const rows = db.prepare(
    "SELECT member_name, shift_code, start_min, end_min FROM schedule_shifts WHERE version_id = ? AND day_of_week = ?"
  ).all(v.id, dayOfWeek(dateStr));
  return Object.fromEntries(rows.map(r => [r.member_name, r]));
}

const laMinutes = (iso) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  return Number(parts.find(p => p.type === "hour").value) * 60 + Number(parts.find(p => p.type === "minute").value);
};

export const minLabel = (m) => {
  if (m == null) return null;
  const h = Math.floor(m / 60), mm = m % 60;
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(mm).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
};

// One week of labor: per member per day, scheduled vs clocked, variances
// over the 5-minute grace, daily and weekly overtime (CA rules, estimate).
export async function buildWeekLabor(mondayStr) {
  const today = laDateStr();
  const names = await teamMemberNames();
  const cards = await fetchTimecards(mondayStr);

  // Bucket timecards by member and LA date
  const byMemberDate = {};
  for (const c of cards) {
    const name = names[c.team_member_id || c.employee_id] || "Unknown";
    const date = laDateStr(c.start_at);
    const key = `${name}|${date}`;
    (byMemberDate[key] = byMemberDate[key] || []).push(c);
  }

  const days = dateRange(mondayStr, addDaysStr(mondayStr, 6));
  const memberSet = new Set([...HUB_NAMES]);
  for (const k of Object.keys(byMemberDate)) memberSet.add(k.split("|")[0]);

  let hasSchedule = false;
  const members = [];
  for (const name of memberSet) {
    const dayRows = [];
    const variances = [];
    let weekMins = 0, dailyOtMins = 0;

    for (const date of days) {
      const sched = scheduleFor(date)[name] || null;
      if (sched && sched.shift_code !== "OFF") hasSchedule = true;
      const cardsToday = (byMemberDate[`${name}|${date}`] || [])
        .sort((a, b) => (a.start_at || "").localeCompare(b.start_at || ""));

      let clockIn = null, clockOut = null, mins = 0, openShift = false;
      for (const c of cardsToday) {
        const inMin = laMinutes(c.start_at);
        if (clockIn == null || inMin < clockIn) clockIn = inMin;
        if (c.end_at) {
          const outMin = laMinutes(c.end_at);
          if (clockOut == null || outMin > clockOut) clockOut = outMin;
          let worked = (new Date(c.end_at) - new Date(c.start_at)) / 60000;
          for (const b of c.breaks || []) {
            if (b.end_at && b.start_at && !b.is_paid) worked -= (new Date(b.end_at) - new Date(b.start_at)) / 60000;
          }
          mins += Math.max(0, Math.round(worked));
        } else {
          openShift = true;
        }
      }
      weekMins += mins;
      const dayOt = Math.max(0, mins - 480);
      dailyOtMins += dayOt;

      const dayVariances = [];
      const past = date < today;
      const schedTimes = sched && sched.start_min != null;
      if (schedTimes && clockIn != null) {
        const dIn = clockIn - sched.start_min;
        if (Math.abs(dIn) > VARIANCE_MIN) dayVariances.push({
          kind: dIn > 0 ? "late_in" : "early_in", diff_min: Math.abs(Math.round(dIn)),
          scheduled: minLabel(sched.start_min), actual: minLabel(clockIn),
        });
        if (!openShift && clockOut != null) {
          const dOut = clockOut - sched.end_min;
          if (Math.abs(dOut) > VARIANCE_MIN) dayVariances.push({
            kind: dOut < 0 ? "early_out" : "late_out", diff_min: Math.abs(Math.round(dOut)),
            scheduled: minLabel(sched.end_min), actual: minLabel(clockOut),
          });
        }
      } else if (schedTimes && clockIn == null && past) {
        dayVariances.push({ kind: "no_show", diff_min: null, scheduled: minLabel(sched.start_min), actual: null });
      } else if ((!sched || sched.shift_code === "OFF") && clockIn != null) {
        dayVariances.push({ kind: "unscheduled", diff_min: null, scheduled: null, actual: minLabel(clockIn) });
      }
      for (const v of dayVariances) variances.push({ date, ...v });

      dayRows.push({
        date, day: dayOfWeek(date),
        shift_code: sched?.shift_code || "OFF",
        scheduled: schedTimes ? `${minLabel(sched.start_min)} · ${minLabel(sched.end_min)}` : null,
        clocked: clockIn != null ? `${minLabel(clockIn)} · ${openShift ? "on the clock" : minLabel(clockOut)}` : null,
        minutes: mins, day_ot_min: dayOt, open: openShift,
        variances: dayVariances,
        live: date === today,
      });
    }

    const weeklyOtMins = Math.max(0, weekMins - 2400 - dailyOtMins);
    if (weekMins === 0 && variances.length === 0 && !HUB_NAMES.includes(name)) continue;
    members.push({
      name, days: dayRows,
      week_minutes: weekMins, daily_ot_min: dailyOtMins, weekly_ot_min: weeklyOtMins,
      variances,
    });
  }
  members.sort((a, b) => b.week_minutes - a.week_minutes);

  return {
    monday: mondayStr, to: addDaysStr(mondayStr, 6), today,
    has_schedule: hasSchedule,
    grace_min: VARIANCE_MIN,
    members,
  };
}
// Record last week's variances and raise one summary decision to the owner
export async function submitWeekVariances(mondayStr) {
  const week = await buildWeekLabor(mondayStr);
  db.prepare("DELETE FROM labor_variances WHERE week_monday = ?").run(mondayStr);
  const ins = db.prepare(`
    INSERT INTO labor_variances (week_monday, member_name, date, kind, scheduled_at, actual_at, diff_min, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  for (const m of week.members) {
    for (const v of m.variances) {
      ins.run(mondayStr, m.name, v.date, v.kind, v.scheduled, v.actual, v.diff_min, nowISO());
      count++;
    }
  }
  if (count > 0) {
    const travis = db.prepare("SELECT d.id AS domain_id, u.id AS user_id FROM domains d JOIN users u ON u.id = d.owner_user_id WHERE u.name = 'Travis'").get();
    if (travis) {
      db.prepare(`
        INSERT INTO decisions (domain_id, raised_by, title, detail, state, created_at)
        VALUES (?, ?, ?, ?, 'open', ?)
      `).run(
        travis.domain_id, travis.user_id,
        `Timecards: ${count} variance${count === 1 ? "" : "s"} over ${VARIANCE_MIN} minutes, week of ${mondayStr}`,
        week.members.filter(m => m.variances.length)
          .map(m => `${m.name}: ${m.variances.map(v => `${v.date.slice(5)} ${v.kind.replace("_", " ")}${v.diff_min ? ` ${v.diff_min}m` : ""}`).join(", ")}`)
          .join(" · "),
        nowISO()
      );
    }
  }
  return { count };
}

// ─── Swap checker: Claude parses the request, code decides ───────────────────
// The verdict never comes from the model. Claude only turns free text into
// structured legs; scheduled minutes and CA OT rules do the deciding.

const SWAP_PROMPT = `A cafe staff member pasted a shift swap request. The team: Alex, Amin, Ben, Brandon, Manny, Travis, Vicky.

Return ONLY a JSON object - no prose, no markdown fences. Schema:

{
  "legs": [
    { "taker": "string", "giver": "string", "day": "Monday|...|Sunday" }
  ],
  "summary": "one short sentence restating the swap"
}

Rules:
- One leg per shift changing hands: taker works giver's shift that day.
- A one-way pickup has one leg; a two-way swap has two legs.
- Use exact team member names. Days are full English day names.
- If the request is not actually about shifts, return {"legs": [], "summary": "reason"}.`;

export async function parseSwapRequest(text) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: `${SWAP_PROMPT}\n\nRequest:\n${text}` }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Anthropic error ${response.status}`);
  recordLlmUsage({ purpose: "swap_parse", model: "claude-sonnet-4-6", usage: data.usage });
  const raw = (data.content || []).map(c => c.text || "").join("");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse the request");
  return JSON.parse(match[0]);
}

// Deterministic: rebuild each affected member's scheduled week with the legs
// applied, then check daily >8h and weekly >40h.
export function decideSwap(parsed) {
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const legs = (parsed.legs || []).filter(l => l.taker && l.giver && DAYS.includes(l.day));
  if (legs.length === 0) {
    return { ok: false, creates_ot: false, notes: ["Nothing shift-shaped in that request."], members: [] };
  }
  const v = db.prepare("SELECT id FROM schedule_versions ORDER BY effective_date DESC, id DESC LIMIT 1").get();
  if (!v) return { ok: false, creates_ot: false, notes: ["No schedule on file."], members: [] };
  const shifts = db.prepare("SELECT member_name, day_of_week, shift_code, start_min, end_min FROM schedule_shifts WHERE version_id = ?").all(v.id);
  const grid = {};
  for (const s of shifts) (grid[s.member_name] = grid[s.member_name] || {})[s.day_of_week] = s;

  const affected = new Set();
  for (const l of legs) { affected.add(l.taker); affected.add(l.giver); }

  const notes = [];
  // Validate legs against the schedule
  for (const l of legs) {
    const giverShift = grid[l.giver]?.[l.day];
    if (!giverShift || giverShift.shift_code === "OFF") {
      notes.push(`${l.giver} has no shift on ${l.day} to give away.`);
    }
    const takerShift = grid[l.taker]?.[l.day];
    if (takerShift && takerShift.shift_code !== "OFF" && !legs.some(o => o.giver === l.taker && o.day === l.day)) {
      notes.push(`${l.taker} already works ${l.day} (${takerShift.shift_code}); the two shifts would stack.`);
    }
  }

  const mins = (s) => s && s.start_min != null ? s.end_min - s.start_min : 0;
  const members = [...affected].map(name => {
    const week = {};
    for (const d of DAYS) week[d] = mins(grid[name]?.[d]);
    for (const l of legs) {
      if (l.giver === name) week[l.day] = Math.max(0, week[l.day] - mins(grid[l.giver]?.[l.day]));
      if (l.taker === name) week[l.day] += mins(grid[l.giver]?.[l.day]);
    }
    const dailyOt = DAYS.reduce((a, d) => a + Math.max(0, week[d] - 480), 0);
    const total = DAYS.reduce((a, d) => a + week[d], 0);
    const weeklyOt = Math.max(0, total - 2400 - dailyOt);
    return {
      name, week_minutes: total,
      daily_ot_min: Math.round(dailyOt), weekly_ot_min: Math.round(weeklyOt),
      ot_days: DAYS.filter(d => week[d] > 480).map(d => `${d} ${(week[d] / 60).toFixed(1)}h`),
    };
  });

  const otMembers = members.filter(m => m.daily_ot_min + m.weekly_ot_min > 0);
  return {
    ok: notes.length === 0,
    creates_ot: otMembers.length > 0,
    notes,
    members,
    verdict_text: otMembers.length === 0
      ? "No overtime created. Swap is clean under CA rules."
      : otMembers.map(m => {
          const bits = [];
          if (m.daily_ot_min > 0) bits.push(`${(m.daily_ot_min / 60).toFixed(1)}h daily OT (${m.ot_days.join(", ")})`);
          if (m.weekly_ot_min > 0) bits.push(`${(m.weekly_ot_min / 60).toFixed(1)}h weekly OT (${(m.week_minutes / 60).toFixed(1)}h total)`);
          return `${m.name}: ${bits.join(" and ")}`;
        }).join(" · ") + ". Needs the owner's approval.",
  };
}

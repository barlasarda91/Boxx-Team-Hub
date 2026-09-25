import { db } from "./db.js";
import { laDateStr, laToUtcISO, addDaysStr, dateRange, nowISO, dayOfWeek } from "./dates.js";
import { recordLlmUsage } from "./usage.js";
import { pushToNames } from "./push.js";

const SQUARE_BASE = "https://connect.squareup.com";
const headers = () => ({
  "Authorization": `Bearer ${process.env.SQUARE_API_KEY}`,
  "Content-Type": "application/json",
  "Square-Version": "2024-01-17",
});

const VARIANCE_MIN = 5;               // minutes of grace either side
// The roster is the users table, not a hardcoded list — hiring or deactivating
// someone in Settings changes everything downstream.
function hubNames() {
  return db.prepare("SELECT name FROM users WHERE active = 1 AND role != 'owner'").all().map(u => u.name);
}

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
    const members = db.prepare("SELECT name, square_name FROM users WHERE active = 1 AND role != 'owner'").all();
    for (const tm of data.team_members || []) {
      const given = (tm.given_name || "").trim();
      const full = `${given} ${(tm.family_name || "").trim()}`.trim();
      // Explicit Square-name mapping wins (set in Settings → Team); exact first
      // name next; then a hub name that starts the Square given name, but only
      // when exactly one qualifies (Alex → Alexandra, Ben → Benjamin — never a
      // guess between two candidates).
      const explicit = members.find(m => m.square_name &&
        (m.square_name.toLowerCase() === full.toLowerCase() || m.square_name.toLowerCase() === given.toLowerCase()));
      const byFirst = members.find(m => m.name.toLowerCase() === given.toLowerCase());
      const byPrefix = !explicit && !byFirst && given.length >= 3
        ? members.filter(m => given.toLowerCase().startsWith(m.name.toLowerCase()))
        : [];
      map[tm.id] = explicit?.name || byFirst?.name
        || (byPrefix.length === 1 ? byPrefix[0].name : null) || full || tm.id;
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

// dayOfWeek() returns 0-6; schedule_shifts stores full day names.
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function dayNameOf(dateStr) { return DAY_NAMES[dayOfWeek(dateStr)]; }

export function scheduleFor(dateStr) {
  const v = db.prepare(
    "SELECT id FROM schedule_versions WHERE effective_date <= ? ORDER BY effective_date DESC, id DESC LIMIT 1"
  ).get(dateStr);
  if (!v) return {};
  const rows = db.prepare(
    "SELECT member_name, shift_code, start_min, end_min FROM schedule_shifts WHERE version_id = ? AND day_of_week = ?"
  ).all(v.id, dayNameOf(dateStr));
  const map = Object.fromEntries(rows.map(r => [r.member_name, r]));
  // Approved swaps override the grid for single dates
  const exceptions = db.prepare(
    "SELECT member_name, shift_code, start_min, end_min FROM schedule_exceptions WHERE date = ?"
  ).all(dateStr);
  for (const e of exceptions) map[e.member_name] = e;
  return map;
}

// Apply an approved swap: write schedule exceptions for each dated leg so the
// variance checker sees the swapped reality, not the original grid. Only
// member-form requests carry exact dates; pasted-text swaps (day names only)
// can't auto-apply and say so.
export function applySwap(swapCheckId) {
  const row = db.prepare("SELECT * FROM swap_checks WHERE id = ?").get(swapCheckId);
  if (!row) throw new Error("Swap not found");
  if (row.applied_at) return { already_applied: true };
  const legs = (JSON.parse(row.parsed_json || "{}").legs || []).filter(l => l.date);
  if (legs.length === 0) {
    throw new Error("This request has no exact dates (pasted-text swaps are applied to the schedule by hand)");
  }
  const upsert = db.prepare(`
    INSERT INTO schedule_exceptions (date, member_name, shift_code, start_min, end_min, source_swap_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, member_name) DO UPDATE SET
      shift_code = excluded.shift_code, start_min = excluded.start_min,
      end_min = excluded.end_min, source_swap_id = excluded.source_swap_id
  `);
  // Snapshot each date's schedule BEFORE writing anything — a same-date switch
  // must read both original shifts, not the first leg's freshly written override.
  const before = {};
  for (const l of legs) before[l.date] = before[l.date] || scheduleFor(l.date);
  const run = db.transaction(() => {
    for (const l of legs) {
      const sched = before[l.date];
      const giverShift = sched[l.giver];
      if (!giverShift || giverShift.shift_code === "OFF") {
        throw new Error(`${l.giver} has no shift on ${l.day} ${l.date} to hand over`);
      }
      const takerShift = sched[l.taker];
      const takerWorks = takerShift && takerShift.shift_code !== "OFF" && takerShift.start_min != null;
      // Taker: giver's shift, or the union span when they already work that day
      if (takerWorks && giverShift.start_min != null) {
        upsert.run(l.date, l.taker, "STACKED",
          Math.min(takerShift.start_min, giverShift.start_min),
          Math.max(takerShift.end_min, giverShift.end_min), row.id, nowISO());
      } else {
        upsert.run(l.date, l.taker, giverShift.shift_code, giverShift.start_min, giverShift.end_min, row.id, nowISO());
      }
      // Giver is off that date unless another leg hands them a shift the same day
      if (!legs.some(o => o.taker === l.giver && o.date === l.date)) {
        upsert.run(l.date, l.giver, "OFF", null, null, row.id, nowISO());
      }
    }
    db.prepare("UPDATE swap_checks SET applied_at = ? WHERE id = ?").run(nowISO(), row.id);
  });
  run();

  // Push the change to the two people it touches: a targeted dashboard strip
  // each (clears when they open My Schedule) and one board post naming both.
  try {
    const fmt = (d) => `${dayNameOf(d).slice(0, 3)} ${d.slice(5).replace("-", "/")}`;
    const notice = db.prepare(
      "INSERT INTO schedule_notices (kind, member_name, effective_date, note, created_at) VALUES ('swap', ?, ?, ?, ?)"
    );
    for (const l of legs) {
      notice.run(l.taker, l.date, `You now cover ${l.giver}'s ${fmt(l.date)} shift`, nowISO());
      if (!legs.some(o => o.taker === l.giver && o.date === l.date)) {
        notice.run(l.giver, l.date, `Your ${fmt(l.date)} shift goes to ${l.taker}`, nowISO());
      }
    }
    const people = [...new Set(legs.flatMap(l => [l.giver, l.taker]))];
    const summary = JSON.parse(row.parsed_json || "{}").summary || "shift swap";
    db.prepare("INSERT INTO board_posts (author_id, kind, text, mentions, created_at) VALUES (?, 'post', ?, ?, ?)")
      .run(row.requested_by, `Swap applied — the schedule is updated: ${summary} ${people.map(p => `@${p}`).join(" ")}`,
        JSON.stringify(people), nowISO());
    pushToNames(people, {
      title: "Swap approved — schedule updated",
      body: summary, tag: `swap-${row.id}`,
    });
  } catch (err) { console.error("swap push:", err.message); }

  return { applied: legs.length };
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
  const rosterNames = hubNames();
  const memberSet = new Set(rosterNames);
  for (const k of Object.keys(byMemberDate)) memberSet.add(k.split("|")[0]);

  const schedByDate = {};
  for (const date of days) schedByDate[date] = scheduleFor(date);

  let hasSchedule = false;
  const members = [];
  for (const name of memberSet) {
    // The schedule of record is the one that lives in the app. Square supplies
    // clock-ins only, so a Square name that maps to nobody on the roster gets
    // hours tracked but NO variance checks — there is nothing to compare
    // against, and flagging them "unscheduled" would treat Square as the
    // schedule authority. They surface as unmatched instead.
    const isRoster = rosterNames.includes(name);
    // Someone the app schedule doesn't manage (no row on this week's grid at
    // all, e.g. events-only roles) can't deviate from it — no "unscheduled"
    // noise for their clock-ins.
    const onGrid = isRoster && days.some(d => schedByDate[d][name]);
    const dayRows = [];
    const variances = [];
    let weekMins = 0, dailyOtMins = 0;

    for (const date of days) {
      const sched = isRoster ? schedByDate[date][name] || null : null;
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
      } else if (onGrid && (!sched || sched.shift_code === "OFF") && clockIn != null) {
        dayVariances.push({ kind: "unscheduled", diff_min: null, scheduled: null, actual: minLabel(clockIn) });
      }
      for (const v of dayVariances) variances.push({ date, ...v });

      dayRows.push({
        date, day: dayNameOf(date),
        shift_code: isRoster ? (sched?.shift_code || "OFF") : null,
        scheduled: schedTimes ? `${minLabel(sched.start_min)} · ${minLabel(sched.end_min)}` : null,
        clocked: clockIn != null ? `${minLabel(clockIn)} · ${openShift ? "on the clock" : minLabel(clockOut)}` : null,
        minutes: mins, day_ot_min: dayOt, open: openShift,
        variances: dayVariances,
        live: date === today,
      });
    }

    const weeklyOtMins = Math.max(0, weekMins - 2400 - dailyOtMins);
    if (weekMins === 0 && variances.length === 0 && !isRoster) continue;
    members.push({
      name, days: dayRows,
      week_minutes: weekMins, daily_ot_min: dailyOtMins, weekly_ot_min: weeklyOtMins,
      variances, unmatched: !isRoster,
    });
  }
  members.sort((a, b) => b.week_minutes - a.week_minutes);

  return {
    monday: mondayStr, to: addDaysStr(mondayStr, 6), today,
    has_schedule: hasSchedule,
    grace_min: VARIANCE_MIN,
    members,
    unmatched_names: members.filter(m => m.unmatched).map(m => m.name),
  };
}
// Record last week's variances and raise one summary decision to the owner
export async function submitWeekVariances(mondayStr) {
  const week = await buildWeekLabor(mondayStr);
  // No in-app schedule covering this week means there is nothing to compare
  // timecards against — recording variances would just be noise.
  if (!week.has_schedule) {
    db.prepare("DELETE FROM labor_variances WHERE week_monday = ?").run(mondayStr);
    return { count: 0, skipped: "no in-app schedule covers this week" };
  }
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

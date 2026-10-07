import { BX, label, tag, bodyText } from "../lib/boxx.js";
import BxModal from "./BxModal.jsx";

// The field guide: how the hub works, tailored to whoever is reading. Opens
// by itself on a device's first visit; reopens anytime from Guide in the
// sidebar (desktop) or More (phone).

const COMMON = (first) => [
  {
    title: "Your domain",
    lines: [
      "My Domain is your workspace: The Standard (what good looks like), your commitments with due dates, and your work tabs.",
      "Add a commitment when you promise something by a date — overdue ones color your card and reach Arda.",
    ],
  },
  {
    title: "Direct line — private, fast",
    lines: [
      "The Direct tab is a private thread between you and Arda. Nobody else can read it — not the Board, not your card.",
      "Send a Message for anything quiet, or flag it Decision needed — Arda approves or declines in one tap and it's recorded in the decision log.",
      "Trivial stuff? The ✕ on a message deletes it for both of you once it's served its purpose.",
    ],
  },
  {
    title: "The Board — public, team-wide",
    lines: [
      "Everything on the Board is visible to the whole team. Use it for coordination: @Name, @everyone, @Arda all notify.",
      "WAITING ON posts name who you need and by when — they see it pinned until they hand over, and blockers that sit 48 hours escalate to Arda.",
    ],
  },
  {
    title: "Schedule & swaps",
    lines: [
      "My schedule (button on your domain) shows your week — swaps already applied — plus a Whole team grid, up to three weeks ahead.",
      "When a new schedule publishes you get a strip and a push; opening your schedule clears it.",
      "Swap shift: Cover gives a shift away, Switch trades two. Travis approves, both of you get notified, and the schedule updates itself.",
    ],
  },
  {
    title: "Your 1:1 with Arda",
    lines: [
      "Add agenda items all week — they collect in an unpublished draft on the 1:1 tab.",
      "From three days out a prep box pins to your dashboard, darker each day. Publish before the meeting; unpublished agendas publish themselves at meeting time.",
      "After the meeting, decisions and actions are logged against it — open actions chase themselves onto next week's agenda.",
    ],
  },
  {
    title: "Notifications",
    lines: [
      "Settings → Notifications → Enable on this device. Schedule changes, swaps, @mentions, direct messages and decisions reach your phone.",
      "iPhone: add the site to your home screen first (Safari → Share → Add to Home Screen), then enable.",
    ],
  },
];

const WORK = {
  Ben: {
    domain: "Supplies",
    lines: [
      "Pastry: weekly sell-through, live from Square. Tap any item for the deep dive — trends, waste by weekday, demand density, and your ideal sell-out time per item (10a–5p).",
      "Orders: the standing order, versioned. Changes show as ▲ markers in the deep dives.",
      "Catalogue: item mappings. New items from invoices queue here with an alert — accept the suggestion or map by hand.",
      "Count: enter the inventory count, then Log Inventory to lock it in.",
      "Invoices: PDFs arrive from billing@ pre-read — check the numbers against the PDF, fix anything, Confirm. Confirming writes price history; nothing confirms itself.",
    ],
  },
  Travis: {
    domain: "Side Works & OT",
    lines: [
      "Hours: Square timecards against the in-app schedule, 5-minute grace. Variances collect weekly for Arda; roastery days never raise them.",
      "Swap Check: member swap requests land here. Clean ones you approve and apply; anything creating overtime goes to Arda's queue instead.",
      "Schedule: publish new versions in the editor or Upload week (.xlsx) from the planner — review, set the effective date, publish. The team gets pushed and you see who's opened it.",
    ],
  },
  Vicky: {
    domain: "Social & Influencers",
    lines: [
      "Calendar: the content calendar — posts per day, details in the pop-ups.",
      "Influencers: the pipeline from first contact to posted collab.",
      "Brief: the running brief for the look and voice of the feed.",
    ],
  },
  Amin: {
    domain: "Content Shooting",
    lines: [
      "Folders: where shot content lives, organized by shoot.",
      "Brief: shoot briefs — what's needed, for when, and the look.",
    ],
  },
  Brandon: {
    domain: "Events & Pop-Ups",
    lines: [
      "Events: the pipeline — holds and confirmed, dates and notes. The pace to keep: two a month.",
    ],
  },
  Alex: {
    domain: "Team Wellness",
    lines: [
      "Birthdays: keep everyone's date in — type it any way you like, the app cleans it up. Banners pin to dashboards a month out.",
      "Team Events: plan the monthly team thing and keep its status current.",
    ],
  },
  Manny: {
    domain: "Equipment Maintenance",
    lines: [
      "Equipment: every machine's tasks with deadlines. Anything that goes overdue escalates to Arda the next morning — close tasks as you do them.",
    ],
  },
};

const OWNER = [
  {
    title: "Overview — the cockpit",
    lines: [
      "Week-in-review tiles are clickable: pastry, waste, variances (member-by-member breakdown), overdue, events, team presence.",
      "Live schedule opens the whole-team week grid, swaps applied. Pay-period hours land 8pm on the 12th and 28th, straight from Square timecards.",
      "The rust strip at the top means an automatic job failed — the app is telling you it's running on stale data.",
    ],
  },
  {
    title: "Decision queue",
    lines: [
      "Everything needing you lands here: direct-line decisions, OT swaps, escalated blockers and equipment. Approve, decline or ack — your note travels back and pushes to whoever asked.",
      "Timecard decisions open the per-member breakdown on tap, with the schedule version the week was checked against.",
    ],
  },
  {
    title: "Direct lines",
    lines: [
      "One private thread per person. Amber means a decision is waiting — approve it in the thread or in the queue, same log either way.",
      "The ✕ clears trivia for both of you; resolved decisions stay in the log no matter what's swept.",
    ],
  },
  {
    title: "1:1s",
    lines: [
      "You see nothing until a member publishes — then an olive strip with their agenda. The tab shows where the last meeting left off while you prep.",
      "You close the meeting once outcomes are logged; the record archives and the next draft opens itself.",
    ],
  },
  {
    title: "Settings",
    lines: [
      "Team: hire, deactivate, reset PINs, map Square names (timecard matching).",
      "Costs tracks Claude API spend per feature; Backups run nightly at 5:45 with on-demand download; Notifications per device.",
    ],
  },
];

export default function GuideModal({ me, onClose }) {
  const isOwner = me.user.role === "owner";
  const work = WORK[me.user.name];
  const sections = isOwner
    ? OWNER
    : [
        ...(work ? [{ title: `Your tools · ${work.domain}`, lines: work.lines, work: true }] : []),
        ...COMMON(me.user.name),
      ];

  return (
    <BxModal title={`FIELD GUIDE · ${me.user.name.toUpperCase()}`} onClose={onClose} width={640}>
      <div style={{ fontFamily: BX.MONO, fontWeight: 400, color: BX.INK, padding: "4px 0 18px" }}>
        <div style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.LINEN}`, fontSize: 11, color: BX.DRIFTWOOD }}>
          How the hub works, for your seat. Reopen it anytime — <b style={{ color: BX.OLIVE, fontWeight: 500 }}>Guide</b>
          {" "}in the sidebar, or More on your phone.
        </div>
        {sections.map((s, i) => (
          <div key={i} style={{ padding: "14px 22px 4px", borderBottom: `1px solid ${BX.STONE}`,
            background: s.work ? "rgba(107,110,74,0.06)" : "transparent" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 8 }}>
              <span style={label({ color: s.work ? BX.OLIVE : BX.INK, letterSpacing: "0.2em" })}>{s.title}</span>
              {s.work && <span style={tag(BX.OLIVE)}>YOURS</span>}
            </div>
            {s.lines.map((l, j) => (
              <div key={j} style={{ display: "flex", gap: 9, padding: "0 0 10px" }}>
                <span style={{ color: BX.DRIFTWOOD, flexShrink: 0 }}>·</span>
                <span style={bodyText({ fontSize: 12, lineHeight: 1.6 })}>{l}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </BxModal>
  );
}

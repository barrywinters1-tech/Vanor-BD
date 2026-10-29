# Vanor BD: brief for an outside review (29 Oct 2026)

Read this first. It is written for a reviewer (human or model) who has not seen the system. The ask is not "add features". It is: **make this simpler to use and make follow-ups impossible to lose.**

## What the business needs from it

Vanor Advisory is two partners (Barry Winters, Graeme Kyle) selling owner-side project recovery, delivery assurance, PM/EA and lender monitoring to developers, owners and lenders in UK construction. No staff. Barry uses the board at a laptop for a few minutes several times a day; everything else should run on its own.

The only outcome that matters: **lead → meeting → priced proposal with a decision date → paid fee.**

Funnel since 25 April 2026 (board data): 182 emails sent → 147 replies → 48 meetings held → 5 proposals → 0 won, 1 paid (£2,000 review). Meetings are not the problem. What happens after a meeting is.

## What exists

Next.js app on Vercel (`vanor-bd.vercel.app`), Supabase store, auto-deploys from `main`.

| Area | Where | What it does |
|---|---|---|
| Board UI (single-page, plain JS) | `public/vanor-runtime.js` (776 dense lines), `app/vanor.css`, `app/vanor-workspace.tsx` | "Today" screen: one ranked list. Buttons: Yes / No / Later on new leads; Email issued; Replied; Meeting; Proposal; Won; Lost; Undo. Proposals strip. "See everything" shows the older tabbed views. |
| Ranking and buckets | `public/vanor-priority.js` (`queue()`), `lib/priority.ts` | Every contact lands in one bucket: followup, todo, inbox, waiting, later, off. Rank within bucket. Older "lanes" (Now/Next/Later/Off) and A1–C "cells" still exist underneath. |
| Lead classifier | `public/vanor-classify.js` (`route()`, `actionLine()`), `lib/lead-classify.ts`, `lib/lead-categorisation.ts` | Type (developer, lender, operator, introducer…), stage, region, size; approach / watch / ignore for incoming signals. |
| Pursuit flow | `lib/pursuit.ts`, `lib/pursuit-logic.ts` | triage → step → follow-up clock (5 working days, 7 after two chases) → chase tasks. Proposals: price, decision date, decision-due tasks. |
| Funnel | `lib/funnel.ts`, `lib/funnel-logic.ts` | Outcome events (sent, reply, meeting, proposal, won) and the funnel report. |
| Prices | `lib/fees.ts` | Price list, first-step offer per lead, decision date, offer sentences. |
| Tasks | `lib/tasks.ts` | Founder task list; chase and decision tasks are generated here. |
| Signals / intel | `lib/intel.ts`, `lib/intel-ingest.ts`, `lib/company-intel*.ts`, `lib/signals-feed.ts` | Press, Gazette, Companies House, planning feeds → graded signals → inbox. |
| Outreach drafts | `lib/outreach*.ts`, `lib/bd-automation.ts` | Engine-written first-approach drafts and templates. |
| Store | `lib/bd-store.ts`, `lib/supabase/` | Entities: source (contact), decision (per-contact state incl. `pursuit`, `oneDay`, `proposal`), event, task, work. |
| MCP tools (for Claude jobs) | `app/api/mcp/[key]/route.ts` | ~45 tools. The ones that matter: work_queue, triage_lead, pursuit_step, follow_ups_due, price_list, record_proposal, proposals_open, log_outcome, add_task, list_tasks. |
| Workspace API (for the UI) | `app/api/workspace/[[...action]]/route.ts` | Same operations for the board. |
| Cron | `vercel.json` → `app/api/jobs/intel` (weekdays 05:40), `app/api/jobs/backup` | Daily: ingest signals, derive tasks, follow-ups due, decisions due, sweep tasks. |
| Scheduled Claude jobs (outside the repo) | Hourly 09:25–18:25: Outlook drafts, meeting capture from Pocket transcripts, sent-mail → "email issued" / "proposal". Weekly Sunday: scoring, research, digest. Weekly Tuesday: events scout. Daily distress watch. | Prompts live in the Claude scheduled-task settings, not in git. |

Tests: `node --test --experimental-strip-types tests/*.test.ts` (71 pass). Types: `npx tsc --noEmit -p .`.

## What the owner says is wrong

- "Too complicated and difficult to use." Too many concepts stacked on each other: lanes, cells, grades, heat, buckets, steps, tasks, drafts, signals, one-day answer.
- Follow-ups are hard to track. There are at least four places a follow-up can live: the pursuit clock (`decision.pursuit.followUpAt`), a chase task, the "next ask" field on a work item, and an Outlook draft. They are not one list.
- 2,148 contacts, 258 with an email, ~46 worth working. The rest is noise the UI still has to carry.
- Seven scheduled jobs feed the top of the funnel; nothing closes the bottom.

## Constraints

- Microsoft 365 is the system of record for mail and calendar. The board never sends email; it writes Outlook drafts and reads Sent Items.
- Two users, no admin. Anything that needs training or configuration is wrong.
- Do not add lead volume. Conversion, not reach.
- Keep the data (events are the evidence); the UI and the model on top can change freely.

## Questions for the reviewer

1. What is the smallest data model that answers "what do I do today, and what am I waiting on?" One suggested answer: one `thread` per contact with `state` (new, writing, sent, replied, met, proposed, won, lost, parked), `nextAction`, `dueOn`, `price`, `decisionOn`. Everything else derived. Is that right, and what breaks?
2. Which of lanes / cells / grades / heat / buckets should go? Can ranking be one number with one plain-English reason?
3. How should follow-ups be shown so none can be missed on a phone or a laptop in under a minute a day?
4. Which of the seven scheduled jobs earn their keep against the funnel above? Which should be paused?
5. What would you delete from `vanor-runtime.js` first?

Answer with a cut list and a target screen, not a feature list.

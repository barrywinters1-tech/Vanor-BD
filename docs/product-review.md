# Product review, 6–7 October 2026 (overnight)

## What was tested
- Every view (Today, Priority, Review, Board, Relationships, Events, Method) driven with Playwright on desktop (1400px) and phone (390px) against a copy of the live data (1,943 records) plus synthetic events, work cards and planned events. No page errors. Console errors: favicon 404 only.
- Interactions: matrix cell selection, opening a priority row, review record, board card drawer, Prepare modal, Ctrl+K search, Add event modal.

## Defects found and fixed
1. Today overflowed horizontally on a phone: the new funnel table inherited `table{min-width:800px}`. Fixed (`.funnel-table{min-width:0}`).
2. Priority matrix clipped on a phone; third column and buttons cut off; labels overlapped. Fixed with a responsive `.prio-matrix` grid and wrapping labels.
3. Priority ranked table unusable on a phone (800px table inside a scroll box). Now a card list under 700px with "Way in" and "Owner" labels.
4. Review queue meta (cell, fit, signal tags, owner, type) wrapped inside tags and ran into each other. Tags no longer wrap; owner/type separated.
5. Review record had no history: Claude-logged emails, meetings and outcomes were invisible unless the contact had a board card. Added section 05 "What has actually happened" with outcome steps highlighted and a Way-in line.

## Improvements shipped
- Way in: warmest known person at the same company, shown on Priority and on the record (borrowed from Affinity/Introhive-style warm-path mapping).
- Chase and reactivate panel on Today: sent 7–35 days ago with no reply; A/B warm contacts quiet for 45/90 days (borrowed from Cloze-style gone-quiet nudges).
- Funnel panel moved to the top of Today's right column so it is above the fold on desktop.
- Closed loop: `log_outcome` (idempotent on Outlook message/event id), `funnel_report`, `move_events`; daily 08:10 run now logs sent/reply/meeting/proposal from Outlook and adds unknown correspondents as leads.

## Market comparison (web research, 6 Oct 2026; prices are third-party summaries unless noted)
Ranked features worth adding, with effort:
1. Relationship strength + warm path across both partners' mailboxes (Affinity, Introhive). Tonight: same-company warm contact only. M.
2. Gone-quiet nudges (Cloze). Shipped tonight. S.
3. Transcript → cited CRM updates into the seven conditions (HubSpot Smart Deal Progression, Attio). M.
4. Job-change tracking on A/B contacts via RocketReach monthly (Clay, Apollo). S.
5. Reply-triggered second/third touches, human-approved (Apollo, Folk). M.
6. Lapsed/expiring consent signal (Nimbus). S–M.
7. Daily "do these five" feed (Pipedrive Pulse). Partly covered by Today. S.
8. One-click LinkedIn capture (folkX). M, browser extension.

Do not copy: autonomous AI SDR sending (11x/Artisan; reported 847 emails → 1 meeting), volume-first enrichment credit meters (Clay/Apollo), pay-per-lead generic prospecting agents (HubSpot).

Sources: stacksync.com (Attio), lightfield.app (Folk), knowlee.ai (Clay), tomba.io (Affinity, Cloze), spotdev.co.uk and docket.io (HubSpot), pipedrive.com newsroom (Pulse), zeliq.com (Apollo), joinvalley.co (11x vs Artisan), capterra.com (Introhive), glenigan.com, barbour-abi.com, land.tech, nimbusmaps.co.uk, reapit.com.

## Known gaps
- The scheduled runs live in Barry's Claude account; a product for other firms needs them server-side on the API with per-customer Microsoft 365 OAuth.
- Graeme's mailbox is not in the loop.
- Ten backfilled events were filed against the wrong contacts on 6 Oct; the 08:10 run re-files them with `move_events`.

## 7 October (evening): outreach volume build
Shipped in 46db26f (runtime v29):
- Template library: nine editable templates (first_approach, signal_cold, signal_warm, nurture, chase1, chase2, intro_ask, post_meeting, proposal_cover) with placeholders; founders edit them in the new Templates & settings view (sidebar); engine renders every draft from the live template; Reset to default.
- Touches 2 and 3: chase1 from day 4 after an unanswered send, chase2 day 9–20 after two, then stop. Chases regenerate after each push.
- Daily quota (default 10) and sent/approved-today counters on Today. Batch approve: "Approve top N polished" only approves drafts Claude polished or a founder edited, never raw engine text; cap per press.
- Proposals: Claude drafts a staged proposal after a meeting that names a scheme (save_proposal); section 07 on the record; Today section 6 "Proposals to issue"; approved ones go to Outlook Drafts at 08:10 with the cover note.
- Scheduled runs: 08:10 now pushes proposals, polishes 12 drafts incl. chases, reports quota; Sunday now does RocketReach person_search for two decision-makers per T1/A1/A2 company (cap 200 lookups, 40 new people), polishes 25.
Not done: Graeme's mailbox; lapsed-consent trigger; server-side runs.

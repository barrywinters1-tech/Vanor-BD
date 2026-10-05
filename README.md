# Vanor BD

Shared business development board for Vanor Advisory, with Claude as the engine.

- **Board**: the original Vanor BD interface (`public/vanor-runtime.js`, `app/vanor.css`) on Next.js, hosted on Vercel.
- **Data**: Supabase Postgres, locked to Barry and Graeme (`supabase/setup.sql`).
- **Claude connector**: `/api/mcp/<key>` lets Claude search, log interactions, set next actions, score contacts, add leads to the review queue and enrich via RocketReach. Claude suggests; founders confirm.
- **Backups**: daily JSON snapshot to Supabase storage, plus Supabase Pro's own backups.

Setup: `SETUP.md`. Claude prompts: `docs/claude-daily-run.md`.

```
npm install
npm test          # logic tests
npm run typecheck
npm run build
```

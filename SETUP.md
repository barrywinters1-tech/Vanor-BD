# Vanor BD — setup (Stage 1)

About an hour, done once. You need: GitHub, Supabase and Vercel accounts, and a fresh backup JSON from the old ChatGPT-hosted app.

## 1. Supabase (database and sign-in)

1. supabase.com → New project → name `vanor-bd`, region **London (eu-west-2)**. Save the database password in your password manager.
2. Upgrade the project to **Pro** (the free tier pauses when idle and has no daily backups).
3. Left menu → **SQL Editor** → New query → paste the whole of `supabase/setup.sql` → **Run**. You should see "Success. No rows returned".
   This creates the tables, locks them down and pre-authorises barryw@ and graemek@vanoradvisory.co.uk.
4. **Project Settings → API Keys**. Keep this tab open. You need:
   - Project URL
   - Publishable key
   - Secret key (the old name is "service_role"). Treat it like a bank password and never paste it into chat or email.

## 2. Vercel (hosting)

1. vercel.com → Add New → Project → import the `vanor-bd` GitHub repo.
2. Before you press Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key |
| `VANOR_MCP_KEY` | 40 random letters and numbers (password-manager generator, no symbols) |
| `CRON_SECRET` | another 40 random letters and numbers |
| `ROCKETREACH_API_KEY` | from RocketReach → Account → API (can be added later) |

3. Deploy. Note the address it gives you, e.g. `https://vanor-bd.vercel.app`.

## 3. Point Supabase sign-in at the app

Supabase → **Authentication → URL Configuration**:
- Site URL: your Vercel address
- Redirect URLs: add `https://<your-vercel-address>/auth/callback`

## 4. First sign-in and import

1. Open the Vercel address → enter `barryw@vanoradvisory.co.uk` → click the link in the email.
2. You'll see **Set up Vanor BD**. Choose the backup JSON from the old app, check the counts, then click **Import this backup**.
3. Graeme signs in the same way with his address. He gets the same workspace automatically.

Anyone else who requests a link can create an account but sees nothing.

## 5. Connect Claude

claude.ai → Settings → Connectors → **Add custom connector**:
- Name: `Vanor BD`
- URL: `https://<your-vercel-address>/api/mcp/<VANOR_MCP_KEY>`

The URL contains the key, so treat it like a password. If it ever leaks, change `VANOR_MCP_KEY` in Vercel, redeploy and update the connector.

## What runs automatically

- **01:30 UK time daily**: a full JSON snapshot goes to the private Supabase `backups` bucket, and the last 30 are kept. Supabase Pro also keeps its own 7 days of database backups.
- **Claude's daily BD run** is a scheduled task in Claude that uses the connector. See `docs/claude-daily-run.md`.

## Checks if something is wrong

- "Your account has not been added to a Vanor workspace": you signed in with a different email. Use the vanoradvisory.co.uk address.
- The sign-in link opens localhost: step 3 hasn't been done.
- Claude says the connector failed: check the URL ends with the exact `VANOR_MCP_KEY` value.

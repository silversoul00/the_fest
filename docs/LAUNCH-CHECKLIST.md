# Deploy guide — THE FEST on Vercel + Supabase

Step by step, made to follow on a phone. Do the parts in order. Each part says where to tap.

**Rules while you do this**
- Never paste a real key, password or connection string into GitHub, chat, or any file in the repo. They only go into Vercel / GitHub **secrets** screens.
- After you add or change **any** Vercel environment variable, **redeploy** (Deployments → newest → ⋯ → Redeploy). Vercel only picks up changes on a new deploy.
- Nothing here has been changed in your Vercel, Supabase, Cashfree, Razorpay or Resend accounts. You make every change yourself.

---

## Part 1 — Where does thefest.in live today?

1. Open **vercel.com** → your dashboard → open the project for this repo (`the_fest`).
2. Tap **Settings → Domains**.
   - `thefest.in` is listed → your site is on **Vercel**. Use **Path A** below.
   - Not listed, or there is no Vercel project → check **app.netlify.com → Sites → Domain management**. If thefest.in is there, it's on **Netlify**. Use **Path B**.
3. Also note where the domain's DNS is managed (GoDaddy, Hostinger, Cloudflare…). You need it in Part 4 (email) and Part 9 (Path B).

Both paths end the same way: the new app runs as a **Preview** first, the old prototype stays live until you switch.

---

## Part 2 — Database (Supabase)

Your production database is the Supabase project **thefest** (ref `uxhpvbgxftsdpcyycxpq`, Mumbai). Its main tables are set up; the Oct 17 update below is **not applied yet**.

**2a. Apply the small update from Oct 17, 2026** (adds three tables: login protection, error log, alert timer — nothing existing changes). **Do this before the new app uses this database.** Until it's done, `/api/health` answers 503 with `database setup incomplete: login_attempts, app_errors, app_alert_state`.
1. Open `https://supabase.com/dashboard/project/uxhpvbgxftsdpcyycxpq` → **SQL Editor** (left bar) → **New query**.
2. Paste this and tap **Run**. It is safe to run twice.

```sql
create table if not exists login_attempts (
  key text primary key, fails int not null default 0, window_start timestamptz not null default now());
create table if not exists app_errors (
  id bigserial primary key, at timestamptz not null default now(), where_ text, message text, digest text, path text,
  repeats int not null default 1);
alter table app_errors add column if not exists repeats int not null default 1;
create index if not exists app_errors_at_idx on app_errors(at desc);
create table if not exists app_alert_state (
  id int primary key default 1 check (id = 1), last_alert_at timestamptz not null default now());
alter table login_attempts  enable row level security;
alter table app_errors      enable row level security;
alter table app_alert_state enable row level security;
```
(Running all of `db/schema.sql` does the same — it only adds what's missing.)

**2b. Copy the connection string (`DATABASE_URL`)**
1. In the project, tap the **Connect** button at the top of the page.
2. Choose the **Connection string** tab, then **Transaction pooler** (port **6543**). Copy the URI.
   - Don't use "Direct connection" (`db.uxhpvbgxftsdpcyycxpq.supabase.co`): it's IPv6-only and doesn't work from Vercel.
   - The host looks like `aws-0-ap-south-1.pooler.supabase.com` or `aws-1-…` — copy it exactly as shown.
3. Replace `[YOUR-PASSWORD]` with the database password. If the password has special characters, encode them: `@`→`%40`, `#`→`%23`, `/`→`%2F`, `:`→`%3A`, `?`→`%3F`.
   Forgot it? **Project Settings → Database → Reset database password**.
4. For backups (Part 10) also copy the **Session pooler** string (same host, port **5432**).

**2c. A separate database for Previews (required).** Previews must **never** use the production database: on a Preview, Cashfree *sandbox* (pretend) payments count as paid, so test purchases there would become real-looking paid orders and valid tickets in thefest — counted in organizers' sales and payouts, and their typed codes would open a real gate.
- Use a second free Supabase project, e.g. `thefest-preview` (region Mumbai). Claude will ask you before creating it, or you can create it yourself: **New project** → run all of `db/schema.sql` in its SQL Editor.
- Put *its* transaction-pooler string in Vercel as `DATABASE_URL` for **Preview** only (Part 5). The thefest string goes in **Production** only.

**Never** run `npm run db:seed` against Supabase — it fills the database with demo accounts (password `password123`, including an admin). The script now refuses any non-local database.

---

## Part 3 — Ticket signing keys

Every ticket QR is signed with these keys, so nobody can fake one.

**Make the Preview pair and the Production pair in one sitting**, one after the other:
1. Deploy once (Part 6 — the site builds without keys), then open **`https://<your-preview-address>/setup/keys`**.
2. Tap **Make keys**. Two values appear: `TICKET_PRIVATE_KEY` and `TICKET_PUBLIC_KEY`. Tap **Copy** on each and paste into Vercel (Part 5) with only **Preview** ticked. The keys are made in your browser; the private key is never sent anywhere.
3. Straight away, tap **Make a different pair** and paste that pair into Vercel with only **Production** ticked.
4. After a redeploy the page shows **"Keys are already set"**. If you still need a pair later (e.g. for Production), open the same page and tap **Need keys for another environment?** → **Make a pair for another environment**. It never shows or changes the keys the site already uses.

Computer alternative: `npm run keys` prints the same two lines.
⚠️ **Never change the production keys after tickets are sold** — every ticket already issued would stop scanning.

---

## Part 4 — Email (Resend)

Without email, nobody can confirm their account, reset a password, or become admin.

1. Sign up at **resend.com** with **the same email you'll put in `ADMIN_EMAILS`**.
2. **API Keys → Create API key** → copy it → this is `RESEND_API_KEY`.
3. **Verify thefest.in first:** **Domains → Add domain → thefest.in**, add the DNS records Resend shows at your DNS provider, wait for "Verified", then set `EMAIL_FROM` = `THE FEST <tickets@thefest.in>` and redeploy.
   - Until the domain is verified (and `EMAIL_FROM` is empty), Resend's test sender delivers **only to your own inbox** (the one you signed up to Resend with). That is enough to confirm your admin account, but **every other email is silently not delivered**: student sign-up confirmations, password resets, volunteers confirming their email, ticket emails. Any step below that needs someone else's email only works after this step.

Free plan: 3,000 emails a month, **100 a day**.

---

## Part 5 — Environment variables

Vercel → project → **Settings → Environment Variables**. For each one, tick the environment(s) shown. "Preview" can be limited to the `full-app` branch.

**Required in production** — if one is missing, `/api/health` answers 503 and names it.

- **`DATABASE_URL`** — Production: thefest transaction pooler (Part 2b). Preview: the **separate** preview project's pooler (2c) — never the production one. *The database.*
- **`TICKET_PRIVATE_KEY`**, **`TICKET_PUBLIC_KEY`** — Production and Preview, **different pairs** (Part 3). *Sign and check ticket QR codes.*
- **`NEXT_PUBLIC_SITE_URL`** — Production: `https://thefest.in`. Preview: **leave empty** (the preview uses its own address). *Links in emails, payment return links, booth QR codes. Production never falls back to localhost.*
- **`RESEND_API_KEY`** — Production and Preview (Part 4). *Sends email.*
- **`EMAIL_FROM`** — empty until thefest.in is verified in Resend, then `THE FEST <tickets@thefest.in>`.
- **`ADMIN_EMAILS`** — your email (comma-separate several). Production and Preview. *Who gets `/admin` (after confirming their email) and the "new errors" alert emails.*

**Card payments (optional)** — without them card checkout is switched off and the buy screen says so; **bank UPI and free tickets still work**.
- **`CASHFREE_APP_ID`**, **`CASHFREE_SECRET_KEY`**, **`CASHFREE_ENV`** — Preview: sandbox (test) keys (app id starts with `TEST`) + `sandbox`. Production: **live** keys + `production` (after Cashfree KYC). Test keys in production are refused on purpose: they'd issue real tickets with no money. `/api/health` names them as `GATEWAY_TEST_KEYS_IN_PRODUCTION`.
- **`RAZORPAY_KEY_ID`**, **`RAZORPAY_KEY_SECRET`**, **`RAZORPAY_WEBHOOK_SECRET`** — optional fallback. Production accepts only `rzp_live_…` keys.
- **`PAYMENT_GATEWAY`** — optional: `cashfree` or `razorpay` to force one when both are set.

**Optional (defaults are fine)**
- `PLATFORM_FEE_MODE`, `PLATFORM_FEE_PAISE` (default 1500 = ₹15), `PLATFORM_FEE_PERCENT/MIN_PAISE/MAX_PAISE`, `PLATFORM_FEE_PAYER`, `GATEWAY_RATE`, `PASS_GATEWAY_FEE` — your commission.
- `REQUIRE_FEST_APPROVAL` — leave unset (on): new fests wait for your approval.
- `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_LEGAL_ADDRESS`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_SUPPORT_PHONE`, `NEXT_PUBLIC_GRIEVANCE_OFFICER`, `NEXT_PUBLIC_LEGAL_FINAL` — business details on the policy pages; set before taking money.
- `UPI_ALERT_SENDERS` — bank domains allowed to confirm UPI orders by forwarded email.

**Never set in Vercel:** `DEMO_PAYMENTS`, `APP_ENV` (local testing only). Production never runs pretend payments, and `/api/health` reports `DEMO_PAYMENTS_IN_PRODUCTION` if it's set there.

**Pasting `.env.example` into Vercel is safe**: all its defaults are empty or safe (no test settings switched on). Then fill in the required ones above.

---

## Part 6 — Deploy `full-app` as a Preview

`vercel.json` on `full-app` already tells Vercel: build as **Next.js**, run in **Mumbai (bom1)**. The `main` branch (the prototype) keeps building as before. Don't change the project's Framework setting.

**Path A — the site is on Vercel, and the project is linked to GitHub (`silversoul00/the_fest`)**
1. When `full-app` is pushed, Vercel builds a Preview by itself. Find it under **Deployments** (branch `full-app`).
2. Add the Preview environment variables (Part 5) → **Redeploy** that deployment.
3. Not linked to GitHub? **Settings → Git → Connect Git Repository** → pick `silversoul00/the_fest`.

**Path B — the site is on Netlify (or there's no Vercel project)**
1. Vercel → **Add New… → Project** → import `silversoul00/the_fest`. Leave the settings as they are and deploy. Its production branch is `main` (just the prototype on a `….vercel.app` address); **thefest.in stays on Netlify**.
2. Pushes to `full-app` now create Previews, exactly like Path A. Add the Preview variables (Part 5) and redeploy.

**Payment webhooks on a Preview:** previews sit behind Vercel login, so Cashfree can't reach them. Turn on **Settings → Deployment Protection → Protection Bypass for Automation**, copy the secret, and in the Cashfree **sandbox** dashboard set the webhook to
`https://<preview-address>/api/webhooks/cashfree?x-vercel-protection-bypass=<secret>`

**Plans:** Vercel's free Hobby plan doesn't allow sites that take payments — move to **Pro** on the day card payments go live. Supabase free has **no backups** and **pauses after a week without activity** — Supabase Pro fixes both.

---

## Part 7 — Become admin

1. `ADMIN_EMAILS` = your email, and `RESEND_API_KEY` set (Part 4–5). Redeploy.
2. On the site, **Sign up** with that same email.
3. Open the confirmation email → tap the link.
4. Open **`/admin`**. (It only works after the email is confirmed — so nobody can sign up with your address first.)

If email can't be set up yet, and only if you're sure: Supabase → SQL Editor →
`update users set email_verified_at = now(), is_admin = true where email = 'your@email';`

---

## Part 8 — Test the Preview (on your phone)

Before you start: the Preview must be using the **separate preview database** (Part 2c), never thefest. The emails below need thefest.in **verified in Resend** (Part 4 step 3) — until then only your own inbox gets email.

- [ ] `https://<preview>/api/health` shows `{"status":"ok","db":"up"}`. If it says `misconfigured`, the `problems` list names exactly which variable to fix.
- [ ] `/admin` → the **System** card says "all good" and **Environment: preview**.
- [ ] Sign up a new student (with a different email than yours) → confirmation email arrives → link works. *(Needs the verified domain.)*
- [ ] Forgot password → email arrives → reset works. *(Needs the verified domain, or use your own email.)*
- [ ] Create a fest as an organizer → approve it in `/admin` → it shows on `/fests`.
- [ ] Free ticket → appears in My tickets.
- [ ] Bank UPI: turn it on for a test fest, pay ₹1-something, enter the UTR, paste the bank SMS in Payments → ticket issued.
- [ ] Cashfree sandbox purchase → ticket appears → refund one ticket from Sales → refund shows in Cashfree.
- [ ] Scan a ticket at the "gate" with a real phone → "Welcome in!"; scan again → "Already in".
- [ ] `/admin/errors` is empty (or only shows things you expected).

---

## Part 9 — Go live

1. Supabase update from Part 2a is applied on **thefest** (production).
2. Set the **Production** variables (Part 5): production DB, the production key pair, `NEXT_PUBLIC_SITE_URL=https://thefest.in`, Resend, `ADMIN_EMAILS`. Card payments: live Cashfree keys + `CASHFREE_ENV=production` — or leave them out and run bank UPI only for now.
3. Point production at the new app (no merge to `main` needed):
   - **Vercel → Settings → Environments → Production → Branch Tracking → `full-app`** → save.
   - Then **Deployments** → the newest `full-app` deployment → **⋯ → Promote to Production** (Vercel builds it again with the Production variables; no new push needed). Wait until it shows **Ready** with the **Production** label.
   - **Path B only:** Vercel project → **Settings → Domains** → add `thefest.in` and `www.thefest.in` → change the DNS records at your DNS provider to exactly what Vercel shows. When Vercel shows them as valid, remove the domain from Netlify.
4. Cashfree **production** dashboard → webhook `https://thefest.in/api/webhooks/cashfree`.
5. Check `https://thefest.in/api/health` → `ok`, and `/admin` → System card all green and **Environment: production**. (If it says anything else, stop and tell Claude: production safety checks key off this.)
6. Open thefest.in on a phone that had the old prototype: by the second visit it should show the new app.

**Rollback (if something breaks)**
- Path A: **Deployments** → the last prototype deployment → ⋯ → **Instant Rollback** (or set Branch Tracking back to `main`).
- Path B: point the DNS back to Netlify.
- ⚠️ Once real tickets are sold, rolling back to the prototype hides everyone's tickets and stops the gate scanner. Roll back only for a few minutes while a fix is made, and tell organizers.

---

## Part 10 — After launch

**Uptime alert.** Create one free monitor at **StatusCake** or **HetrixTools** (check their terms allow business use) on `https://thefest.in/api/health`, every 5 minutes, alerting your email/phone. It alerts when the database is down **or** a required setting is missing.

**Error alerts.** Built in: server errors appear at `/admin/errors`, and `ADMIN_EMAILS` get at most one email per 15 minutes.

**Backups — ⚠️ NOT running yet. Your decision needed.** Supabase free makes no backups. The repo has a daily encrypted backup job (`.github/workflows/db-backup.yml`), but **GitHub only runs scheduled jobs (and only shows the "Run workflow" button) when the workflow file is on the repo's default branch**, which is `main`. The file is only on `full-app`, so today there are **no backups at all**. Pick one:
1. **Put just that one file on `main`.** The prototype site isn't affected. (Claude won't touch `main` without your OK.)
2. **Make `full-app` the default branch**: GitHub → repo → **Settings → General → Default branch** → `full-app`.
3. **Supabase Pro** ($25/month): daily backups by Supabase, kept 7 days. The GitHub job can be added later as an extra copy.

Once 1 or 2 is done, set the secrets — GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**:
- `BACKUP_DATABASE_URL` = the **Session pooler** string (Part 2b step 4).
- `BACKUP_PASSPHRASE` = a long random passphrase. Save it in your password manager — without it a backup can't be opened.

Then **Actions → Database backup → Run workflow** once to test. It runs daily at 2 AM and keeps each encrypted backup for 30 days. GitHub pauses the schedule after 60 days with no repo activity — re-enable it under Actions if so. To restore into an empty database: `scripts/restore.sh` (see the comments at its top).

**A volunteer can't log in at the gate ("Too many attempts")?** Someone typed wrong passwords for that email from the same network. They can switch to mobile data / another Wi-Fi, or wait 15 minutes, or you add another volunteer's email under **Volunteers**.

**What `/api/health` problems mean**

| Name | Fix |
|---|---|
| `DATABASE_URL` | not set |
| `DATABASE_URL_NOT_TRANSACTION_POOLER` | use the Transaction pooler string (port 6543), not Direct |
| `TICKET_PRIVATE_KEY` / `TICKET_PUBLIC_KEY` | missing or can't be read — make keys at `/setup/keys` |
| `TICKET_KEYS_MISMATCH` | the two keys are from different pairs |
| `NEXT_PUBLIC_SITE_URL` | set `https://thefest.in` |
| `RESEND_API_KEY`, `ADMIN_EMAILS` | set them (Part 4–5) |
| `GATEWAY_TEST_KEYS_IN_PRODUCTION` | test/sandbox payment keys in production (Cashfree `TEST…` app id or `…_test_…` secret, Razorpay `rzp_test_…`) — use live keys or remove them |
| `CASHFREE_ENV` | live-looking Cashfree keys but `CASHFREE_ENV` isn't `production` |
| `DEMO_PAYMENTS_IN_PRODUCTION` | delete `DEMO_PAYMENTS` from Vercel (it's ignored, but must not be set) |
| `database setup incomplete: <names>` | the database is missing those tables/columns — run Part 2a (or all of `db/schema.sql`) in Supabase → SQL Editor |
| warning `NO_LIVE_GATEWAY` | card checkout is off; bank UPI and free tickets work |
| warning `TEST_SETTING_IN_PRODUCTION` | `APP_ENV` is set in Vercel — not needed there; delete it |

---

## Local release check (for Claude)
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh` — local Postgres only. Runs every browser flow, the UPI, refund, password, team, analytics, error-log and production-mode checks, the concurrency tests, the backup/restore round-trip and a build with no environment variables.

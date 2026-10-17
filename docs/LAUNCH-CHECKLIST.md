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

Your production database is the Supabase project **thefest** (ref `uxhpvbgxftsdpcyycxpq`, Mumbai). Its tables are already set up.

**2a. Apply the small update from Oct 17, 2026** (adds three tables: login protection, error log, alert timer — nothing existing changes):
1. Open `https://supabase.com/dashboard/project/uxhpvbgxftsdpcyycxpq` → **SQL Editor** (left bar) → **New query**.
2. Paste this and tap **Run**. It is safe to run twice.

```sql
create table if not exists login_attempts (
  key text primary key, fails int not null default 0, window_start timestamptz not null default now());
create table if not exists app_errors (
  id bigserial primary key, at timestamptz not null default now(), where_ text, message text, digest text, path text);
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

**2c. A separate database for the preview (recommended).** Create a second free project `thefest-preview` (region Mumbai), run all of `db/schema.sql` in its SQL Editor, and use *its* transaction-pooler string for Preview. Then test orders never land in the real database.

**Never** run `npm run db:seed` against Supabase — it fills the database with demo accounts (password `password123`, including an admin). The script now refuses any non-local database.

---

## Part 3 — Ticket signing keys

Every ticket QR is signed with these keys, so nobody can fake one.

1. Deploy once (Part 6 — the site builds without keys), then open **`https://<your-preview-address>/setup/keys`**.
2. Tap **Make keys**. Two values appear: `TICKET_PRIVATE_KEY` and `TICKET_PUBLIC_KEY`. Tap **Copy** on each and paste into Vercel (Part 5). The keys are made in your browser; the private key is never sent anywhere.
3. Make **one pair for Preview** and **a different pair for Production**.
4. After a redeploy the page shows **"Keys are already set"**.

Computer alternative: `npm run keys` prints the same two lines.
⚠️ **Never change the production keys after tickets are sold** — every ticket already issued would stop scanning.

---

## Part 4 — Email (Resend)

Without email, nobody can confirm their account, reset a password, or become admin.

1. Sign up at **resend.com** with **the same email you'll put in `ADMIN_EMAILS`**.
2. **API Keys → Create API key** → copy it → this is `RESEND_API_KEY`.
3. Leave `EMAIL_FROM` **empty** for now. Resend's test sender then delivers **only to your own inbox** — enough to confirm your admin account.
4. Before real users sign up: **Domains → Add domain → thefest.in**, add the DNS records Resend shows at your DNS provider, wait for "Verified", then set `EMAIL_FROM` = `THE FEST <tickets@thefest.in>` and redeploy.

Free plan: 3,000 emails a month, **100 a day**.

---

## Part 5 — Environment variables

Vercel → project → **Settings → Environment Variables**. For each one, tick the environment(s) shown. "Preview" can be limited to the `full-app` branch.

**Required in production** — if one is missing, `/api/health` answers 503 and names it.

- **`DATABASE_URL`** — Production: thefest transaction pooler (Part 2b). Preview: thefest-preview pooler (2c). *The database.*
- **`TICKET_PRIVATE_KEY`**, **`TICKET_PUBLIC_KEY`** — Production and Preview, **different pairs** (Part 3). *Sign and check ticket QR codes.*
- **`NEXT_PUBLIC_SITE_URL`** — Production: `https://thefest.in`. Preview: **leave empty** (the preview uses its own address). *Links in emails, payment return links, booth QR codes. Production never falls back to localhost.*
- **`RESEND_API_KEY`** — Production and Preview (Part 4). *Sends email.*
- **`EMAIL_FROM`** — empty until thefest.in is verified in Resend, then `THE FEST <tickets@thefest.in>`.
- **`ADMIN_EMAILS`** — your email (comma-separate several). Production and Preview. *Who gets `/admin` (after confirming their email) and the "new errors" alert emails.*

**Card payments (optional)** — without them card checkout is switched off and the buy screen says so; **bank UPI and free tickets still work**.
- **`CASHFREE_APP_ID`**, **`CASHFREE_SECRET_KEY`**, **`CASHFREE_ENV`** — Preview: sandbox (test) keys + `sandbox`. Production: **live** keys + `production` (after Cashfree KYC). Test keys in production are refused on purpose: they'd issue real tickets with no money.
- **`RAZORPAY_KEY_ID`**, **`RAZORPAY_KEY_SECRET`**, **`RAZORPAY_WEBHOOK_SECRET`** — optional fallback. Production accepts only `rzp_live_…` keys.
- **`PAYMENT_GATEWAY`** — optional: `cashfree` or `razorpay` to force one when both are set.

**Optional (defaults are fine)**
- `PLATFORM_FEE_MODE`, `PLATFORM_FEE_PAISE` (default 1500 = ₹15), `PLATFORM_FEE_PERCENT/MIN_PAISE/MAX_PAISE`, `PLATFORM_FEE_PAYER`, `GATEWAY_RATE`, `PASS_GATEWAY_FEE` — your commission.
- `REQUIRE_FEST_APPROVAL` — leave unset (on): new fests wait for your approval.
- `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_LEGAL_ADDRESS`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_SUPPORT_PHONE`, `NEXT_PUBLIC_GRIEVANCE_OFFICER`, `NEXT_PUBLIC_LEGAL_FINAL` — business details on the policy pages; set before taking money.
- `UPI_ALERT_SENDERS` — bank domains allowed to confirm UPI orders by forwarded email.

**Never set in Vercel:** `DEMO_PAYMENTS`, `APP_ENV` (local testing only; ignored in production anyway).

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

- [ ] `https://<preview>/api/health` shows `{"status":"ok","db":"up"}`. If it says `misconfigured`, the `problems` list names exactly which variable to fix.
- [ ] `/admin` → the **System** card says "all good".
- [ ] Sign up a new student → confirmation email arrives → link works.
- [ ] Forgot password → email arrives → reset works.
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
   - **Vercel → Settings → Environments → Production → Branch Tracking → `full-app`** → save. The next push to `full-app` becomes the production deployment — ask Claude to push (a tiny commit is enough) and wait until Deployments shows it **Ready** with the **Production** label.
   - **Path B only:** Vercel project → **Settings → Domains** → add `thefest.in` and `www.thefest.in` → change the DNS records at your DNS provider to exactly what Vercel shows. When Vercel shows them as valid, remove the domain from Netlify.
4. Cashfree **production** dashboard → webhook `https://thefest.in/api/webhooks/cashfree`.
5. Check `https://thefest.in/api/health` → `ok`, and `/admin` → System card all green.
6. Open thefest.in on a phone that had the old prototype: by the second visit it should show the new app.

**Rollback (if something breaks)**
- Path A: **Deployments** → the last prototype deployment → ⋯ → **Instant Rollback** (or set Branch Tracking back to `main`).
- Path B: point the DNS back to Netlify.

---

## Part 10 — After launch

**Uptime alert.** Create one free monitor at **StatusCake** or **HetrixTools** (check their terms allow business use) on `https://thefest.in/api/health`, every 5 minutes, alerting your email/phone. It alerts when the database is down **or** a required setting is missing.

**Error alerts.** Built in: server errors appear at `/admin/errors`, and `ADMIN_EMAILS` get at most one email per 15 minutes.

**Backups** (Supabase free has none). GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**:
- `BACKUP_DATABASE_URL` = the **Session pooler** string (Part 2b step 4).
- `BACKUP_PASSPHRASE` = a long random passphrase. Save it in your password manager — without it a backup can't be opened.

Then **Actions → Database backup → Run workflow** once to test. It runs daily at 2 AM and keeps each encrypted backup for 30 days. GitHub pauses the schedule after 60 days with no repo activity — re-enable it under Actions if so. To restore into an empty database: `scripts/restore.sh` (see the comments at its top).

**What `/api/health` problems mean**

| Name | Fix |
|---|---|
| `DATABASE_URL` | not set |
| `DATABASE_URL_NOT_TRANSACTION_POOLER` | use the Transaction pooler string (port 6543), not Direct |
| `TICKET_PRIVATE_KEY` / `TICKET_PUBLIC_KEY` | missing or can't be read — make keys at `/setup/keys` |
| `TICKET_KEYS_MISMATCH` | the two keys are from different pairs |
| `NEXT_PUBLIC_SITE_URL` | set `https://thefest.in` |
| `RESEND_API_KEY`, `ADMIN_EMAILS` | set them (Part 4–5) |
| `GATEWAY_TEST_KEYS_IN_PRODUCTION` | test payment keys in production — use live keys or remove them |
| warning `NO_LIVE_GATEWAY` | card checkout is off; bank UPI and free tickets work |

---

## Local release check (for Claude)
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh` — local Postgres only. Runs every browser flow, the UPI, refund, password, team, analytics, error-log and production-mode checks, the concurrency tests, the backup/restore round-trip and a build with no environment variables.

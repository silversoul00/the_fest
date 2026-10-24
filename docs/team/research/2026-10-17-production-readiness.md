# Research brief — Production readiness (Vercel + Supabase)

Date: 2026-10-17 · Researcher · Branch `full-app`

## 1. Goal

Harshith wants THE FEST to stop being a prototype and run as a real web app on **thefest.in**: students buy real
tickets, gates scan them on fest day, and he runs it alone, often from his phone. This means the Next.js app on
`full-app` has to run reliably on **Vercel** (serverless functions) talking to the new **Supabase** project `thefest`
(Mumbai, free plan, empty, schema already applied). It must fail loudly when something is misconfigured and must
**never** issue "paid" tickets without real money. It also needs backups, alerts and a safe way to go live: preview
first, then production, and a way back to the current prototype if something breaks.

## 2. What Harshith already decided (from BRIEF.md)

- "Real full web app, not just a front end … Stack chosen by Harshith: **Next.js + Supabase**."
- "Domain target: thefest.in. Hosting: Vercel. Database: Supabase."
- "Harshith: 'build it for deployment … no longer just a prototype but a fully functional web app.'"
- "a new free project **thefest** (Mumbai) was created with his OK and the tables set up."
- "Hosting stays Vercel; there is no Vercel connection here, so Harshith sets Vercel settings himself from our checklist."
- "**Cashfree** is the main gateway (0% offer), Razorpay the fallback." "**Zero-fee UPI straight to the fest's bank account** must be supported."
- "**The gate scanner always asks to log in again.**"
- "Never merge to `main`; work goes to the `full-app` review branch." "Never change Harshith's Supabase, Vercel, Cashfree or Razorpay accounts without him."
- "Explain results in plain language; Harshith reads on his phone."
- Open decision 2: "Add `RESEND_API_KEY` and `ADMIN_EMAILS` in Vercel."

## 3. Findings

### A. Where the live site is today (from the repo)
- `main` holds the static prototype (`index.html`, `sw.js`). It has **both** `netlify.toml` and `vercel.json`, and its
  README says "**Vercel** or **Netlify** (both free): import this repo, no build command, publish directory `/`."
  `.gitignore` lists both `.vercel/` and `.netlify/`. The `full-app` README says "Framework Preset: Next.js (it was
  'Other' for the old static page)", which points to an existing **Vercel** project.
- **Not confirmed.** GitHub shows no deployments or commit statuses for this repo, and from here I could not reach
  thefest.in or a DNS resolver (proxy blocked). So we don't know whether thefest.in points at Vercel or Netlify, or
  whether the Vercel project is linked to Git. Harshith has to check this (Question 5).
- The repo `silversoul00/the_fest` is **public** (GitHub API: `"visibility":"public"`). No secrets were found in the
  git history.

### B. Database connection (Supabase ↔ Vercel)
- Supabase connection types: direct `db.<ref>.supabase.co:5432` is **IPv6** (IPv4 is a paid add-on). The shared pooler
  `aws-[INDEX]-[REGION].pooler.supabase.com` is IPv4 on all plans, in session mode on **5432** and transaction mode on
  **6543**. Transaction mode is "for serverless and edge functions", and "Transaction mode does not support prepared
  statements". Set SSL to `require`. — [Supabase: connection strings](https://supabase.com/docs/reference/postgres/connection-strings)
- Supabase lists **Vercel and GitHub Actions** as IPv4-only platforms, so the direct connection won't work from either. — [Supabase: IPv4 address](https://supabase.com/docs/guides/platform/ipv4-address.md)
- The pooler host has an `[INDEX]` part (`aws-0-…` or `aws-1-…`), so the host in `.env.example`
  (`aws-0-ap-south-1…`) may be wrong for this project. Always copy the string from the dashboard.
- Limits on the free plan (Nano compute): **60** direct DB connections and **200** pooler clients. "Compute resources on the
  Free plan are subject to change." — [Supabase: compute add-ons](https://supabase.com/docs/guides/platform/compute-add-ons)
- Supabase discussion: in session mode, clients above Pool Size wait up to a minute and then fail. Transaction mode is
  for serverless. "Start with a low count" of connections per app instance. — [supabase/discussions/22305](https://github.com/orgs/supabase/discussions/22305)
- Vercel (Fluid compute): create the pool at module scope, use a **short idle timeout (~5 s)**, and don't set max to 1
  because it "harms concurrency in Fluid Compute". `attachDatabasePool` is documented for `pg`, mysql2, ioredis and
  similar, but **not postgres.js**. — [Vercel: connection pooling with functions](https://vercel.com/kb/guide/connection-pooling-with-functions), [Vercel: manage pools with Fluid](https://vercel.com/kb/guide/efficiently-manage-database-connection-pools-with-fluid-compute)
- Fluid compute is on by default for new projects since 23 Apr 2025. One instance handles many requests at once, so
  module-level state is **shared across concurrent requests** on that instance, but **not** across instances.
  Default and maximum duration on Hobby is 300 s. — [Vercel: Fluid compute](https://vercel.com/docs/fluid-compute)
- **Vercel functions default to `iad1` (Washington DC)** for new projects. Mumbai (`bom1`, ap-south-1) is available,
  and Hobby can pick any single region with `"regions"` in `vercel.json`. — [Vercel: function regions](https://vercel.com/docs/functions/configuring-functions/region), [Vercel: region list](https://vercel.com/docs/regions)
- Current `src/lib/db.ts`: `prepare: false` ✔, `ssl: 'require'` for non-local ✔, `max: 5` in production (OK under
  Fluid), `idle_timeout: 20` (longer than Vercel's suggested ~5 s), pool cached on `globalThis` ✔, lazy so build needs
  no DB ✔ (last build prerendered only static pages: legal, offline, forgot-password, scan/login). No session-level
  features are used (only `pg_advisory_xact_lock`, which is transaction-scoped and safe with the pooler).

### C. Code that assumes one long-running server
- `src/lib/auth.ts` lines 111–123: the login throttle is an **in-memory `Map`**. On Vercel each instance has its own
  copy, and a cold start wipes it, so the "10 failed logins per 15 min" protection mostly doesn't work. It's used by
  `login` (`src/app/(auth)/actions.ts`) and `scannerLogin` (`src/app/scan/actions.ts`).
- Un-awaited work after the response ("fire-and-forget") in server code:
  `src/app/api/checkout/route.ts:41`, `src/app/api/checkout/demo-confirm/route.ts:23`,
  `src/app/api/checkout/verify/route.ts:28`, `src/lib/confirm.ts:18`, `src/lib/upi.ts:101,142`,
  `src/lib/refunds.ts:64,144`, `src/lib/transfer.ts:47,50`. On serverless, work that isn't attached to the request can
  be frozen or dropped when the response ends, so ticket, refund and transfer emails may never go out. Next.js `after()`
  (stable since 15.1; this repo has 15.5.28) runs work after the response and uses Vercel's `waitUntil`. It works in
  route handlers and server actions. — [Next.js: after](https://nextjs.org/docs/15/app/api-reference/functions/after)
- Module caches in `src/lib/ticket-crypto.ts` (parsed keys) and `db.ts` (pool) are safe: each instance builds its own.
- No filesystem writes, `setInterval` or server timers in server code. (`AutoRefresh`, `Scanner` and `SwRegister`
  timers are client-side.) Seat holds are released lazily inside `createOrder`, so no cron is needed.
- `src/components/AutoRefresh.tsx` polls by doing a full server render. The ticket page refreshes every **8 s** while the
  ticket is unused (`src/app/(student)/tickets/[id]/page.tsx:52`). On fest day every student waiting in the queue with
  the page open costs one function call every 8 s.

### D. Payments and demo mode
- `activeGateway()` (`src/lib/payments.ts`) returns `'demo'` whenever no Cashfree or Razorpay keys are set, **in any
  environment**. `demo-confirm` then marks the order paid and issues real tickets with no money. If production is ever
  deployed without keys, or a key is mistyped or removed, students get free "paid" tickets and organizers see revenue
  that doesn't exist. The fest page also offers the demo flow (`BuyTickets.tsx:64`).
- `CASHFREE_ENV` defaults to `sandbox` (`src/lib/cashfree.ts:13`), and Razorpay `rzp_test_` keys are accepted anywhere.
  Test-mode keys in production = tickets marked paid with **no real money**.
- The local release check (`tests/run-e2e.sh`) runs `next start` (so `NODE_ENV=production`) with **no gateway keys**,
  and its tests depend on demo mode. A rule like "no demo when NODE_ENV=production" would break the suite. Demo mode
  needs an explicit opt-in instead.

### E. Environment variables and first run
- If `TICKET_PRIVATE_KEY` is missing, the error only appears when a ticket is signed (`ticket-crypto.ts:17`), which is
  in the middle of a purchase.
- `NEXT_PUBLIC_SITE_URL` falls back to `http://localhost:3000` in about 8 files (`mail.ts`, `verify.ts`, `transfer.ts`,
  `checkout/route.ts`, `reset-actions.ts`, `admin/actions.ts`, `organizer/actions.ts`, organizer settings/payments pages,
  booth print). In production that sends emails with localhost links and gives Cashfree a localhost `return_url`/`notify_url`.
- Vercel provides `VERCEL_ENV` (production/preview/development), `VERCEL_BRANCH_URL` and
  `VERCEL_PROJECT_PRODUCTION_URL` at build time and runtime. — [Vercel: system env vars](https://vercel.com/docs/environment-variables/system-environment-variables)
- Email: if `RESEND_API_KEY` is missing, emails are only written to `email_outbox` (status `logged`), and the raw
  reset/verify token stays in `body_text`. Admin rights need **email verified** + `ADMIN_EMAILS` (`auth.ts:80`), so
  without a working sender Harshith can't become admin.
- Resend: the `resend.dev` test sender "can only send testing emails to your own email address". Sending to anyone
  else needs a verified domain (DNS records). — [Resend: 403 resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain.md)
- Resend Free plan: 3,000 emails a month and **100 per day**. Pro is $20/mo for 50,000 a month with no daily limit. — [Resend pricing](https://www.resend.com/pricing.md)
  One fest selling more than 100 orders in a day would exceed the free daily cap.
- Empty database: page code takes single rows only where an empty result is handled (`queries.ts:25,39`). No obvious crash
  path, but this hasn't been verified in a browser with an unseeded DB. The Tester must check it (criterion 14).

### F. Security headers and cookies
- Cookies (`auth.ts:42`): `httpOnly`, `secure` when `NODE_ENV=production`, `sameSite: 'lax'`. The scanner cookie has no
  expiry, so it dies when the browser closes ✔.
- Server Actions: "Next.js compares the origin of a Server Action request with the host domain… If not provided, only
  the same origin is allowed." `allowedOrigins` is only needed behind proxies, and we have none. — [Next.js: serverActions](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/serverActions)
- The JSON APIs use `sameOrigin()` (`src/lib/http.ts`), which works on Vercel.
- Vercel adds HSTS automatically. Custom domains get `Strict-Transport-Security: max-age=63072000;` and HTTP is
  redirected to HTTPS with a 308. — [Vercel: encryption](https://vercel.com/docs/encryption)
- `next.config.mjs` already sends nosniff, Referrer-Policy, `X-Frame-Options: SAMEORIGIN` and Permissions-Policy
  (camera=self). There's no CSP. A full script CSP in Next.js needs nonces, which force dynamic rendering, or
  `'unsafe-inline'`. — [Next.js: CSP](https://nextjs.org/docs/15/app/guides/content-security-policy)
- Checkout loads `https://sdk.cashfree.com/js/v3/cashfree.js` and `https://checkout.razorpay.com/v1/checkout.js`
  (`BuyTickets.tsx:68,80`). Cashfree doesn't publish the full list of domains a CSP would need, so a strict script CSP
  could break checkout.
- `/api/health` is public and returns gateway name, email mode and whether signing is set. That's harmless but more
  than an outsider needs.

### G. Plans, backups, pausing and monitoring
- **Vercel Hobby is non-commercial only**: "Any method of requesting or processing payment from visitors of the site"
  counts as commercial use and needs Pro. — [Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines)
- Hobby limits: 1M function invocations, 4 active CPU-hours and 360 GB-hrs memory per month. If they're exceeded you
  "wait until 30 days have passed". **Runtime logs are kept for 1 hour.** Pro is $20 per user per month. — [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- Supabase Free: "paused after 1 week of inactivity". Pausing depends on whether there was "sufficient user database
  activity", which isn't defined, so a health ping may or may not count. A paused project can be restored for up to
  1 year. That fits what happened to the old project (paused > 400 days). — [Supabase: pausing](https://supabase.com/docs/guides/platform/free-project-pausing.md)
- Supabase Free has **no backups**. Pro (from $25/mo) has daily backups kept 7 days and no pausing. Free allows
  2 active projects. — [Supabase pricing](https://supabase.com/pricing.md)
- GitHub Actions: anyone signed in with read access can download workflow artifacts. Because this repo is public, that
  likely means anyone. Default retention is 90 days. — [GitHub: download artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)
  "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in
  60 days." — [GitHub: disable workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)
  So a backup dump uploaded as an artifact **must be encrypted**, because it contains personal data (DPDP).
- UptimeRobot's free plan has been personal/non-commercial only since Nov 2024. Free alternatives that allow commercial
  use: StatusCake (10 monitors, 5 min), HetrixTools (15 monitors, 1 min), Pulsetic (10 monitors). This comes from a
  vendor blog, so verify on each site before signing up. — [dev.to comparison](https://dev.to/velprove/uptimerobot-commercial-use-free-alternatives-for-business-sites-in-2026-5d75)
- Sentry Developer (free): 5k errors a month, 1 user, email alerts. — [last9 Sentry pricing](https://last9.io/blog/sentry-pricing.md)
- Next.js `instrumentation.ts` `onRequestError` (since 15.0) catches server errors in render, route handlers and server
  actions, but not errors our code catches and only `console.error`s. — [Next.js: instrumentation](https://nextjs.org/docs/15/app/api-reference/file-conventions/instrumentation)

### H. Preview, production and the domain
- Vercel deploys every pushed branch as a **Preview** with its own URL. Production follows the "production branch",
  which can be changed under Settings → Environments → Production → Branch Tracking. — [Vercel: Git](https://vercel.com/docs/git)
- `vercel.json` `framework` "overrides the Framework Preset in Project Settings". `buildCommand`, `installCommand` and
  `regions` can also be set per deployment. — [Vercel: vercel.json](https://vercel.com/docs/project-configuration/vercel-json)
  So `full-app` can build as Next.js without touching the project settings the live prototype (`main`) uses.
- Preview URLs are behind Vercel Authentication by default (Standard Protection), so external webhooks such as Cashfree
  can't reach them. "Protection Bypass for Automation is available on all plans" via a
  `?x-vercel-protection-bypass=<secret>` query parameter. — [Vercel: deployment protection](https://vercel.com/docs/deployment-protection), [Vercel: bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
- Node on Vercel: 24.x (default) and 22.x. A range like `>=22.0.0` maps to 24.x. `package.json` has `"node": ">=20"`,
  and Node 20 was deprecated on 1 Oct 2026. Local is v22.22.0. — [Vercel: Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- The old prototype's `sw.js` (`thefest-v1`) does network-first page loads and stale-while-revalidate for other GETs.
  The new `/sw.js` (`thefest-v2`) has a different body, so browsers update it on the next visit, and its `activate` step
  deletes old caches. Expect at most one stale load, but check it manually after the switch.

### I. Fest-day load (estimates, not measured)
- Gate: 500 people in 10 minutes is about **1 scan per second** overall. One scan ≈ 2 session/permission queries +
  verify + 1 atomic update + 1 log insert + 1 count query, about 6–7 short queries. With functions in Mumbai next to the
  database, that's small for Nano (200 pooler clients, 60 DB connections).
- Ticket rush: `createOrder` locks the ticket-type row (`for update of tt`) for the whole transaction (about 6–8
  queries), so buyers of one ticket type go **one at a time**. With functions in `bom1` each query is a few ms (my
  estimate). With the default `iad1`, each query crosses US↔India (roughly 200 ms, my estimate, not measured), so one
  checkout holds the lock for over a second and a rush of buyers queues and times out. **Choosing the `bom1` region is
  the most important performance setting.**
- Vercel Hobby budget: 1M invocations a month is fine for early fests. The 8-second ticket-page polling is the biggest
  avoidable cost. Login uses bcryptjs (pure JS, cost 11), which burns CPU, but at early volumes that's acceptable.
- No load test has been run against Supabase. Treat these numbers as estimates.

## 4. Recommendation

Nothing here changes what users see, except that checkout stops offering fake payments in production. All changes stay
on `full-app`.

### 4.1 One place for environment and config: `src/lib/env.ts` (new)
- `appEnv()`: `'production'` if `VERCEL_ENV === 'production'` **or** `APP_ENV === 'production'` (APP_ENV lets the
  Tester simulate production locally). Otherwise `'preview'` if `VERCEL_ENV === 'preview'`, else `'development'`.
- `siteUrl()`: returns `NEXT_PUBLIC_SITE_URL` if set. In preview it falls back to `https://${VERCEL_BRANCH_URL}`. In
  production it falls back to `https://${VERCEL_PROJECT_PRODUCTION_URL}`, otherwise `http://localhost:3000` (dev only).
  Replace every `process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'` with it (list in Finding E).
  `layout.tsx` metadata can keep the build-time value.
- `configProblems(): string[]` returns **names only, never values**. It checks:
  - `DATABASE_URL` is missing; or (production, non-local) doesn't contain `:6543`; or the host starts with `db.` → `DATABASE_URL_NOT_TRANSACTION_POOLER`.
  - `TICKET_PRIVATE_KEY` is missing or unparseable. `TICKET_PUBLIC_KEY` is set but doesn't match the private key → `TICKET_KEYS_MISMATCH` (sign a fixed string and verify it).
  - Production only: `NEXT_PUBLIC_SITE_URL` is missing, not `https://`, or contains localhost.
  - Production only: `RESEND_API_KEY` or `ADMIN_EMAILS` is missing.
  - Production only: Cashfree keys are set but `CASHFREE_ENV !== 'production'`, or Razorpay key doesn't start with `rzp_live_` → `GATEWAY_TEST_KEYS_IN_PRODUCTION`.
  - Production only: no live gateway configured → `NO_LIVE_GATEWAY`. This is a warning, not an outage, so bank UPI and free tickets still work.
- Don't throw at import time. `next build` must still work with no env vars.

### 4.2 Payments can never be fake in production
- Add `DEMO_PAYMENTS` (`1` = allowed). Change `activeGateway()`:
  - `'demo'` is returned only when no gateway is configured **and** `DEMO_PAYMENTS === '1'` **and** `appEnv() !== 'production'`.
  - In production, test-mode keys (Cashfree `CASHFREE_ENV` ≠ `production`, or a non-`rzp_live_` Razorpay key) are
    treated as "no gateway" (Question 2).
  - Otherwise the result is a new `'none'`.
- `'none'` behaviour:
  - `POST /api/checkout` with `method: 'gateway'` for a paid ticket → **503** `{"error":"Card/UPI checkout isn't open yet. Use bank UPI if the fest offers it."}`, and **no order is created and no seat held**. Check this *before* `createOrder`.
  - `POST /api/checkout/demo-confirm` → **404** whenever `activeGateway() !== 'demo'`. Today it's 403; use 404 so it looks like the endpoint doesn't exist.
  - Free tickets and `upi_direct` work as today.
  - The fest page (`BuyTickets.tsx`) hides the card option and shows "Online card/UPI payment opens soon". The bank-UPI
    option still shows when the fest has it on. If neither is available, paid ticket types show "Not on sale online yet"
    with a disabled button. This must fit at 390px.
- `tests/run-e2e.sh`: `export DEMO_PAYMENTS=1` before `next start`, and add it to `.env.example` with a comment (local
  testing only, ignored in production).

### 4.3 Serverless fixes
- **Login throttle → database.** Add a table in `db/schema.sql` (idempotent, RLS enabled, no policies, like the other tables):
  `login_attempts (key text primary key, fails int not null default 0, window_start timestamptz not null default now())`.
  - `noteFailedLogin(email)` is one upsert: reset to 1 if `window_start < now() - interval '15 minutes'`, otherwise increment.
  - `loginThrottled(email)` is true when `fails >= 10` inside the window. `clearFailedLogins` deletes the row.
  - The functions become `async`, so update both call sites (`(auth)/actions.ts`, `scan/actions.ts`).
  - Key = normalized email, same behaviour as now.
  - This changes the production schema. The Builder **must not** apply it to Supabase. Harshith (or Claude, with his
    explicit OK) runs `db/schema.sql` / `npm run db:setup` against production. Put this in the deploy checklist.
- **After-response work → `after()`.** Replace every un-awaited `x().catch(() => {})` in server code (list in Finding C)
  with `after(() => x().catch(e => reportError(e, …)))` from `next/server`. In `src/lib/*` helpers that may be called
  outside a request (seed scripts don't import them, but check), keep a safe fallback: `await` the work instead.
- **DB pool tuning** (`db.ts`): keep `prepare: false` and `ssl: 'require'`. In production use `max: 5`, `idle_timeout: 5`
  (Vercel's guidance) and `connect_timeout: 10`. Add a comment explaining why. Optional: `max_lifetime: 60 * 10`.
  Don't add `@vercel/functions` (postgres.js isn't listed as supported).
- **Ticket page polling**: raise `AutoRefresh` on `tickets/[id]` from 8 s to 15 s, and stop polling after 10 minutes
  on the page (a "Tap to refresh" link appears). Same rule on `tickets` (10 s → 20 s). This keeps fest day within Hobby
  and Pro included usage.

### 4.4 Health endpoint and error alerts
- `GET /api/health`:
  - All good → 200 `{"status":"ok","db":"up"}`.
  - DB down → 503 `{"status":"down","db":"down"}`.
  - Config problems → 503 `{"status":"misconfigured","db":"up","problems":["TICKET_PRIVATE_KEY", …]}`.
  - Warnings (like `NO_LIVE_GATEWAY`) go in `"warnings":[…]` with 200. Keep `force-dynamic` and add
    `Cache-Control: no-store`.
  - Remove the `payments` and `email` mode fields from the public output. The admin page shows them instead.
- **Error log, free and built in.** New table `app_errors (id bigserial, at timestamptz default now(), where_ text, message text, digest text, path text)` (RLS on).
  - `src/lib/errors.ts` `reportError(err, where)` inserts a row, truncated to 1,000 characters. It never throws.
  - Call it from `src/instrumentation.ts` `onRequestError` and from the existing `catch` blocks that only `console.error`
    (checkout, webhooks, email failures in `mail.ts`).
  - Alerts: at most **one email every 15 minutes** to `ADMIN_EMAILS` saying "N new errors on THE FEST" with a link to
    `/admin/errors`. Track the last alert time in a one-row table or in `app_errors` itself.
  - New admin tab **Errors**: latest 100 errors, newest first, readable at 390px. Admin only, everyone else is redirected
    as on other admin pages.
- The **admin overview** gets a small "System" card: DB up/down, gateway (`cashfree live` / `razorpay live` / `none` /
  `demo`), email (`resend` / `not configured`), signing keys OK, the config problem list and app environment. Only admins see it.
- **Uptime**: Harshith adds one free monitor (StatusCake or HetrixTools; check that the terms allow commercial use) on
  `https://thefest.in/api/health` every 5 minutes, alerting his email or phone. This also gives the DB regular activity
  (whether that prevents pausing is unconfirmed, see Finding G).

### 4.5 First run in production
- **Ticket keys from a phone**: new page `/setup/keys`. It generates an ECDSA P-256 key pair **in the browser** with WebCrypto
  (`generateKey` → export `pkcs8` / `spki` → PEM → one line with `\n`, the same format as `scripts/gen-keys.mjs`).
  - It shows both values with Copy buttons and the warning "never change these after tickets are sold". The private key
    is never sent to the server.
  - It works on any environment, but shows only "Keys are already set" once `TICKET_PRIVATE_KEY` is valid.
  - Use different key pairs for Preview and Production.
- **Admin account**:
  1. Set `ADMIN_EMAILS` = Harshith's email in Vercel.
  2. Set up Resend.
     - Best: verify the `thefest.in` domain in Resend (needs DNS access) and set `EMAIL_FROM=THE FEST <tickets@thefest.in>`.
     - Before the domain is verified: create the Resend account with the **same email as `ADMIN_EMAILS`** and leave
       `EMAIL_FROM` empty (the app falls back to `onboarding@resend.dev`). Resend then delivers only to his own inbox,
       which is enough to confirm his own account.
  3. Sign up on the site with that email → open the confirmation link → `/admin` works.
  4. Fallback only with his explicit OK: run this through the Supabase SQL editor:
     `update users set email_verified_at = now(), is_admin = true where email = '<his email>';`
- **Never** run `db:seed` against production. Today `scripts/seed.mjs` only skips when fests already exist (line 38),
  and it refuses `--reset` on Supabase (line 44). The production DB is **empty**, so one accidental `npm run db:seed`
  would fill it with demo accounts using password `password123`, including a demo **admin** (`is_admin = true`, line 61).
  Make it refuse any non-local `DATABASE_URL` unless `--allow-remote` is passed.

### 4.6 Headers and cookies
- Keep the current headers. Add `Content-Security-Policy: frame-ancestors 'self'; base-uri 'self'; object-src 'none'`.
  This is anti-clickjacking without touching scripts, so payment SDKs keep working.
- No `allowedOrigins`.
- Add a redirect from `/index.html` to `/` (old prototype links).
- Cookies are fine as they are: Vercel always serves HTTPS and `NODE_ENV=production` there, so `Secure` is set.

### 4.7 Vercel build config on `full-app` (new `vercel.json`)
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "npm ci",
  "buildCommand": "next build",
  "regions": ["bom1"]
}
```
- Change `package.json` `engines.node` to `"22.x"` to match local.
- The `vercel.json` on `main` stays untouched, so the prototype keeps building as a static site.
- If the old project has an Output Directory override (e.g. `.`), the Next.js build may fail. This is uncertain. If the
  preview build log complains, add `"outputDirectory": ".next"` and record it in the checklist.

### 4.8 Backups (free, until Supabase Pro)
- `.github/workflows/db-backup.yml`: daily schedule plus a manual run button.
  1. Install a `pg_dump` matching the server's Postgres major version. Check it with `select version()` via the
     connector (read-only).
  2. Dump through the **session pooler (port 5432 on the pooler host; GitHub runners are IPv4-only)** with secret `BACKUP_DATABASE_URL`.
  3. Encrypt with `age` or `gpg --symmetric` using secret `BACKUP_PASSPHRASE`.
  4. Upload as an artifact with `retention-days: 30`.
  - Never upload unencrypted.
  - Note in the doc that GitHub disables the schedule after 60 days without repo activity.
- `scripts/backup.sh` and `scripts/restore.sh` hold the same steps for local use. The Tester runs them against local Postgres.
- Once Supabase Pro is on, daily backups are included. Keep the workflow as an off-site copy.

### 4.9 Deploy plan (goes into new `docs/DEPLOY.md`; replaces the Vercel parts of README and LAUNCH-CHECKLIST)
Short numbered steps, one screen each, phone-friendly:
1. **Check where thefest.in lives** (Question 5): Vercel → Project → Domains. If thefest.in is listed there, use Path A. Otherwise use Path B.
2. **Path A (prototype already on Vercel and linked to this GitHub repo):**
   - Pushing `full-app` creates a Preview automatically.
   - Add env vars scoped to **Preview** (optionally only to branch `full-app`): preview DB URL, preview keys from
     `/setup/keys`, Cashfree **sandbox** keys, `CASHFREE_ENV=sandbox`, Resend, `ADMIN_EMAILS`.
   - Leave `NEXT_PUBLIC_SITE_URL` empty for preview (`siteUrl()` uses the branch URL).
   - Settings → Functions → region is already forced to `bom1` by `vercel.json`.
   - For the Cashfree sandbox webhook, use `https://<branch-url>/api/webhooks/cashfree?x-vercel-protection-bypass=<secret>`.
3. **Path B (prototype on Netlify, or the Vercel project isn't linked):**
   - Create a **new** Vercel project from the repo with Production Branch = `full-app`. It deploys only to a
     `*.vercel.app` URL, so thefest.in keeps showing the prototype.
   - Use the same env vars, but scoped to Production on that new project, with sandbox keys at first.
4. **Smoke test on preview**: the LAUNCH-CHECKLIST §3 items, plus `/api/health` = ok, plus a scan on a real phone at 390px.
5. **Go live**:
   - Run `db/schema.sql` on production with Harshith's OK.
   - Set the Production env vars: live keys and `CASHFREE_ENV=production`, or leave gateway keys out and run bank-UPI only.
     Set `NEXT_PUBLIC_SITE_URL=https://thefest.in`.
   - Then: Path A → Settings → Environments → Production → Branch Tracking → `full-app` (no merge to `main` needed).
     Path B → add `thefest.in` and `www.thefest.in` to the Vercel project and change DNS to the exact records Vercel shows.
   - Then set the Cashfree production webhook to `https://thefest.in/api/webhooks/cashfree`.
6. **Rollback**: Path A → Deployments → previous prototype deployment → Instant Rollback (or set the production branch back to `main`).
   Path B → point DNS back to Netlify.
7. **After every env-var change → Redeploy.** Vercel only applies env changes on a new deployment.
8. Turn on the uptime monitor. Check `/admin` → System card is all green.

Also update `.env.example`:
- Placeholder pooler host `aws-?-ap-south-1.pooler.supabase.com` with the comment "copy from Supabase → Connect → Transaction pooler; URL-encode special characters in the password".
- Add `DEMO_PAYMENTS` and `APP_ENV`.
- Mark which variables are **required in production**.

### Environment variables summary (for DEPLOY.md)
| Variable | Prod | Preview | If missing in production |
|---|---|---|---|
| `DATABASE_URL` (transaction pooler, 6543) | required | required (separate DB, Q3) | health 503 `down` |
| `TICKET_PRIVATE_KEY` / `TICKET_PUBLIC_KEY` | required (own pair) | required (own pair) | health 503; paid/free checkout returns a clear error, not a crash |
| `NEXT_PUBLIC_SITE_URL` | `https://thefest.in` | leave empty | health 503 |
| `RESEND_API_KEY`, `EMAIL_FROM` | required | optional | health 503; emails kept in outbox |
| `ADMIN_EMAILS` | required | required | health 503 |
| `CASHFREE_APP_ID/SECRET_KEY`, `CASHFREE_ENV` | live keys + `production` | sandbox + `sandbox` | gateway off (`NO_LIVE_GATEWAY` warning) |
| `RAZORPAY_*` | optional fallback (live keys only) | optional | — |
| `PLATFORM_FEE_*`, `GATEWAY_RATE`, `PASS_GATEWAY_FEE`, `REQUIRE_FEST_APPROVAL` | optional (defaults) | optional | defaults |
| `NEXT_PUBLIC_LEGAL_*`, `NEXT_PUBLIC_SUPPORT_*` | before taking money | optional | "[… — to fill]" shown |
| `DEMO_PAYMENTS`, `APP_ENV` | **never set** | never set | — |
| `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE` | GitHub repo secrets (session pooler 5432) | — | no backups |

## 5. Acceptance criteria

All of these can be checked locally with `next build && next start` against local Postgres unless marked (manual).
"Production mode" means `APP_ENV=production` on `next start`.

**Money**
1. Local, no gateway keys, `DEMO_PAYMENTS` unset: `POST /api/checkout` (logged-in student, paid ticket, `method:"gateway"`) returns **503** with the "isn't open yet" message, and `ticket_types.sold` is unchanged.
2. Same setup: `POST /api/checkout/demo-confirm` with a valid own order id returns **404**.
3. `DEMO_PAYMENTS=1`, no `APP_ENV`: the existing demo purchase works (the full `tests/run-e2e.sh` passes).
4. `DEMO_PAYMENTS=1` **and** `APP_ENV=production`: `demo-confirm` returns 404 and checkout doesn't return `mode:"demo"`. Afterwards `select count(*) from orders where provider='demo' and status='paid'` is unchanged.
5. `APP_ENV=production` with `CASHFREE_APP_ID/SECRET_KEY` set and `CASHFREE_ENV=sandbox`: gateway checkout returns 503 (no Cashfree call is made), and `/api/health` lists `GATEWAY_TEST_KEYS_IN_PRODUCTION`. Same with a `rzp_test_` Razorpay key.
6. With the gateway off: free tickets still issue, bank-UPI checkout still returns `mode:"upi"` when the fest has UPI on, and the fest page at **390px** shows no card button, shows the "opens soon" note, and doesn't scroll sideways.

**Config and health**
7. Everything set (local): `GET /api/health` → 200 `{"status":"ok","db":"up"}`, `Cache-Control: no-store`, and the body has no gateway or email mode fields.
8. Production mode without `TICKET_PRIVATE_KEY` → 503, `problems` contains `"TICKET_PRIVATE_KEY"`, and the body contains no secret values (grep the body for `BEGIN`, `postgres://` and key fragments).
9. `TICKET_PUBLIC_KEY` from a different pair → `TICKET_KEYS_MISMATCH`.
10. Production mode with `DATABASE_URL` on port 5432 or a `db.` host (non-local) → problem `DATABASE_URL_NOT_TRANSACTION_POOLER`. Database stopped → 503 `db:"down"`.
11. Production mode with `NEXT_PUBLIC_SITE_URL` unset: no email in `email_outbox` and no Cashfree `return_url` contains `localhost`. Health lists `NEXT_PUBLIC_SITE_URL`. With `VERCEL_ENV=preview` and `VERCEL_BRANCH_URL=x-git-full-app.vercel.app`, a password-reset email link starts with `https://x-git-full-app.vercel.app/`.
12. `next build` succeeds with **no** env vars at all (no DB, no keys).

**Serverless behaviour**
13. Login throttle works across processes: start two servers on :3000 and :3001 on the same DB. Make 10 wrong-password attempts on :3000. The 11th attempt on **:3001**, even with the right password, shows "Too many attempts". After `update login_attempts set window_start = now() - interval '16 minutes'`, the right password works. Scanner login shares the same counter. Restarting the server doesn't reset it.
14. Empty database (schema only, no seed): these all return non-500 responses with sensible empty states, checked at 390px with no sideways scroll:
    - logged out: `/`, `/fests`, `/login`, `/signup`, `/scan/login`, `/legal/*`, `/api/health`
    - new organizer: `/organizer`, `/organizer/new`
    - new student: `/tickets`, `/me`
    - new sponsor: `/sponsor`
    - admin: `/admin`, `/admin/fests`, `/admin/orders`, `/admin/errors`
15. No server file in `src/app/api`, `src/lib` or server actions has an un-awaited promise with `.catch(() => {})`. A grep finds them only in `'use client'` files. Paid, free, bank-UPI, refund and transfer flows still create their `email_outbox` rows, so the existing tests pass.
16. The ticket page stops auto-refreshing after 10 minutes and shows a "Tap to refresh" control. While it's polling, the interval is ≥15 s.

**Errors and admin**
17. Force a server error (e.g. a test-only route, or temporarily wrong SQL in a test build): a row appears in `app_errors` and on `/admin/errors`. A non-admin who opens `/admin/errors` is redirected away. Two errors within 15 minutes produce **one** alert email row in `email_outbox`.
18. The admin "System" card shows the gateway (`none`/`demo`/`cashfree live`…), email mode, signing OK and the problems list. Students and organizers never see it.
19. A signed-up user whose email is in `ADMIN_EMAILS` gets `/admin` **only after** confirming the email link (existing behaviour, retest).

**Keys page**
20. `/setup/keys` produces a key pair in the browser with no network request carrying the private key (check the Playwright network log). Putting the pair into `.env.local` and restarting lets a ticket be bought and scanned as "Welcome in!". Once valid keys are set, the page shows only "Keys are already set". It works at 390px.

**Headers, cookies, config**
21. Responses include `Content-Security-Policy` containing `frame-ancestors 'self'`, plus the existing nosniff, Referrer-Policy and Permissions-Policy. Checkout still opens the Cashfree sandbox modal (manual, on preview).
22. Production-mode login sets `tf_session` with `HttpOnly; Secure; SameSite=Lax` and an expiry. `tf_scan` has `HttpOnly; Secure; SameSite=Lax` and **no** `Expires`/`Max-Age`.
23. `vercel.json` on `full-app` has `framework: "nextjs"` and `regions: ["bom1"]`, and `package.json` has `engines.node: "22.x"`. `git diff origin/main -- vercel.json` shows `main`'s file is untouched (no commits to `main`).
24. `scripts/seed.mjs` refuses a non-local `DATABASE_URL` without `--allow-remote`.
25. `db/schema.sql` re-runs cleanly twice on a local DB (idempotent), and the new tables have RLS enabled.

**Backups and docs**
26. `scripts/backup.sh` then `scripts/restore.sh` on local Postgres: dump → encrypted file (not readable as plain SQL, so `grep -c "CREATE TABLE"` = 0) → restore into a fresh DB gives the same row counts for users, fests, orders and tickets.
27. `.github/workflows/db-backup.yml` uses only `secrets.*` for the URL and passphrase, uploads only the encrypted file, and sets `retention-days`. (Supervisor reviews; it can't run here.)
28. `docs/DEPLOY.md` exists with numbered phone-friendly steps covering Path A and B, preview → production, rollback, "redeploy after env change" and the env table. `README.md`, `.env.example` and `docs/LAUNCH-CHECKLIST.md` don't contradict it.
29. (Manual, after go-live) A phone that had the old prototype installed shows the new app by its second visit, and the `thefest-v1` cache is gone (DevTools → Application → Cache Storage).

## 6. Out of scope (now)

- A strict script CSP with nonces or SRI (needs full page-by-page testing with both payment SDKs).
- Sentry or other paid observability. The built-in error table and email alerts are enough for now.
- Offline gate mode and offline ticket QR (students with no signal at the gate). This is a real fest-day risk; recommend it as the next feature.
- IP-based rate limiting, Vercel WAF rules, signup throttling (college Wi-Fi shares IPs; needs its own research).
- Multi-region functions, read replicas, Supabase PITR, verified-certificate SSL (`verify-full`).
- Pruning old `sessions` / `email_outbox` rows (tiny at current scale).
- A load test against the real Supabase project.
- Legal / DPDP review of the policy pages (open decision 3).

## 7. Questions for Harshith

1. **Paid plans.** Vercel's free plan forbids sites that take payments, so card checkout needs **Vercel Pro ($20/month)**.
   Supabase free has **no backups** and **pauses after a week of no activity**. Supabase Pro (from $25/month) fixes both.
   Resend free sends only **100 emails a day**.
   *Recommendation:* upgrade **Vercel Pro on the day card payments go live**, and **Supabase Pro before the first real
   fest**. Stay on Resend free until a fest expects more than about 80 orders a day. Until then we rely on the encrypted
   GitHub backup and the uptime ping.
2. **No live payment keys yet.** If production goes live before Cashfree KYC, should card/UPI checkout be **switched off**
   (only bank-UPI and free tickets work), or should sandbox "test" payments be allowed on thefest.in?
   *Recommendation:* switch it off. Sandbox on the real site would issue real-looking tickets with no money.
3. **Separate test database.** Can we create a second free Supabase project, `thefest-preview` (Mumbai), for the preview
   site, so test orders never land in the real database?
   *Recommendation:* yes. It's free, and we only create it with your OK.
4. **How to go live.** Point Vercel's production at the `full-app` branch (a settings switch you can undo), or merge into `main`?
   *Recommendation:* switch the production branch to `full-app`. This keeps the "never merge to main" rule and allows a
   one-tap rollback.
5. **Where is thefest.in today?** Please open Vercel → your project → Domains and tell us whether thefest.in is listed
   (or whether it's on Netlify), and where the domain's DNS is managed (GoDaddy, Hostinger, Cloudflare…). This decides
   which deploy steps you follow and how to verify the email domain.
   *Recommendation:* keep the site on Vercel and add Resend's DNS records at the same DNS provider.
6. **Error alerts.** Built-in alerts (errors stored in the app, one email every 15 minutes at most) or a Sentry account?
   *Recommendation:* built-in now (free, no new account). Add Sentry only if we need deeper traces later.

# Supervisor review: production readiness (commit bea0a53), round 1

Date: 2026-10-17 · Supervisor · Branch `full-app` (local only; `origin/full-app` is still at abc3924, so nothing is pushed)
Inputs: `docs/team/BRIEF.md`, `docs/team/research/2026-10-17-production-readiness.md`, `git show bea0a53`.

## Verdict: CHANGES NEEDED

The money rules hold. In production, demo checkout can't run and sandbox or test keys can't issue a paid ticket.
Health reports problems by name only. The error log is admin-only.

Three things stop it shipping as written:
1. The documented backups will never run, because GitHub only runs workflows from `main`.
2. Login breaks on production until the new tables are added, and `/api/health` still says "ok".
3. A phone-only owner can't make the production ticket keys once the preview keys are set.

There are also a few doc fixes, and one question that needs Harshith (does the preview share the production database?).

---

## Brief check

| BRIEF.md line | Result |
|---|---|
| "build it for deployment … fully functional web app" | OK. It covers env checks, health, error log, serverless fixes, Mumbai region, the deploy guide and backups. |
| Hosting Vercel, DB Supabase, domain thefest.in | OK. `vercel.json` pins Next.js and region bom1. The guide covers thefest.in on both Path A and Path B. |
| Cashfree main, Razorpay fallback, zero-fee bank UPI must work | OK. With no live gateway, bank UPI and free tickets still work (`checkout/route.ts:41-49`, `BuyTickets.tsx:157,185,193`). |
| Never merge to `main` | OK. `main` = `origin/main` = bf49622. But see Finding 1: the backup workflow only works from `main`. |
| Don't push small changes | OK, nothing is pushed. Minor: LAUNCH-CHECKLIST.md:168 tells Harshith to "ask Claude to push (a tiny commit is enough)". A Vercel Redeploy/Promote does the same job without a push (Finding 10). |
| Never change his Supabase/Vercel/Cashfree/Razorpay accounts | Can't confirm from the repo. Nothing in the commit touches them, and the SQL is handed to Harshith (Part 2a). The Tester should confirm read-only that `login_attempts` is not yet in production, unless Harshith OK'd it. |
| Decisions needing Harshith are written down, not guessed | VIOLATED (process, small). The coordinator's calls (card checkout off in production, DEMO_PAYMENTS, bom1, DB throttle, after()) are not in BRIEF.md. By BRIEF's own rule they belong under "Open decisions" until Harshith confirms them. Also, CLAUDE.md now says production "Tables match db/schema.sql", which is false after this commit (three new tables are not applied). |
| Explain in plain language; he reads on his phone | Mostly OK. The guide is in numbered parts with tap paths. Doc gaps are in Findings 6, 9 and 10. |
| Gate scanner always asks to log in again | OK. The `tf_scan` cookie still has no expiry (tested in prod.py). |
| Organizer analytics refreshed on open, not live | OK, untouched. Polling only changed on the ticket pages, as the research brief asked. |
| Harshith's financial assumptions | Not touched. |

## Acceptance criteria (research brief §5)

| # | Result | Evidence |
|---|---|---|
| 1 | Met | `checkout/route.ts:41-46` checks before `createOrder`. `tests/prod.py:78-85` checks `sold` and the order count. |
| 2 | Met | `demo-confirm/route.ts:12`. `prod.py:107`. |
| 3 | Met | `run-e2e.sh` exports DEMO_PAYMENTS=1. The builder's run artifacts are in /tmp/thefest-e2e. The Tester must re-run. |
| 4 | Met | `payments.ts:52` (`appEnv() !== 'production'`). `prod.py:179-183`. |
| 5 | Met | `env.ts:68` and `payments.ts:42-43` refuse test keys in production, so checkout returns 503 before any Cashfree call. `prod.py:218,235`. |
| 6 | Met | `BuyTickets.tsx:166-198`. `prod.py:110-128` covers 390px. |
| 7 | Met | `health/route.ts`. `errors.py:37-39`. |
| 8 | Met | `prod.py:245-246`. |
| 9 | Met | `ticket-crypto.ts` `checkTicketKeys`. `prod.py:227`. |
| 10 | Met | `prod.py:260-262`. |
| 11 | Met | `prod.py:201-207,274`. |
| 12 | Met | `ops.sh` builds with no env at all (`env -i`). |
| 13 | Met | `auth.ts:118-133`. `prod.py:135-151` covers two servers, a restart and the shared scanner counter. |
| 14 | Met | `prod.py:317-338`. |
| 15 | Met | My grep finds `.catch(() => {})` only in `'use client'` files. |
| 16 | Met | `AutoRefresh.tsx`. `errors.py:100-108` uses a fake clock. |
| 17 | Met | `errors.py:57-82`. |
| 18 | Met | `admin/page.tsx:13-42` is behind `requireAdmin`. `errors.py:75-84`. |
| 19 | Met | `prod.py:332`. |
| 20 | Met | `prod.py:292-308`, `errors.py:89`. |
| 21 | Partly met | The header is present (`next.config.mjs`). The Cashfree modal still has to be checked by hand on a preview. |
| 22 | Met | `prod.py:176,195`. |
| 23 | Met | `ops.sh`. `main` is untouched. |
| 24 | Met | `seed.mjs:16-22`. `ops.sh`. |
| 25 | Met | `schema.sql:346-373`, applied twice by `run-e2e.sh` and `ops.sh`. |
| 26 | Met, but the test is weak | See Finding 8. The check `grep -c 'CREATE TABLE' == 0` would also pass on an unencrypted custom-format dump, because that format is compressed. |
| 27 | Content met; in practice not met | The workflow uses only secrets, uploads only `.gpg` files, and sets `retention-days: 30`. But it can't run while it only exists on `full-app` (Finding 1). |
| 28 | Met | `docs/DEPLOY.md` points to LAUNCH-CHECKLIST.md, which covers Path A and B, rollback, redeploy and the variables. |
| 29 | Not testable here | Manual, after go-live. |

## The builder's "beyond the brief" items

- **Checkout returns 503 for every ticket (free and UPI too) when the signing keys are broken.** Fine. The research brief's env table asked for "paid/free checkout returns a clear error, not a crash". The message is plain ("Ticket sales are paused for a moment"). The ticket page falls back to the typed code, and the gate accepts typed codes without a signature (`scan.ts:37-43`), so tickets already sold still get people in.
- **Confirmations from test keys are refused in production.** Fine, and it follows the coordinator's "card off until real keys" decision.
  - Cashfree: `confirm.ts:12` returns `{ok:false}`, so the webhook answers 200 and Cashfree stops retrying. That only happens with sandbox keys, which means no real money.
  - Razorpay: `webhooks/razorpay/route.ts:14` answers 200 "ignored", checked after the signature.
  - The edge case of live keys with a mistyped `CASHFREE_ENV` is safe. Cashfree calls then go to the sandbox URL and fail with 500, so Cashfree retries and nothing is lost.
- **`siteUrl()` falls back to `VERCEL_PROJECT_PRODUCTION_URL`.** Fine. That value is the real production domain, and health still lists `NEXT_PUBLIC_SITE_URL` so it gets fixed. The fallback ignores localhost in production but not on preview (Finding 9).
- **`/setup/keys`.** Anyone can open it, which is acceptable.
  - Keys are made with WebCrypto in the visitor's own browser, and there is no server action or POST.
  - It can't write or overwrite anything. It reveals only whether keys are set, and `/api/health` already reveals that.
  - It has `robots: noindex`.
  - The network test confirms the private key never leaves the browser.
  - Usability problem: Finding 3.
- **`/api/test-error`.** Production can't enable it: the route needs `E2E_ERROR_ROUTE=1` and refuses when `appEnv()==='production'`. On a preview where someone sets that variable, anyone could fill `app_errors`. Low, because it's never documented for Vercel.
- **Error log, alert emails, Errors tab.**
  - The page and the System card are behind `requireAdmin()`.
  - The alert claim is atomic (`errors.ts:33-38`), so there is one email per 15 minutes across all servers.
  - Alert-send failures use `reportFailures:false`, so they can't loop.
  - The log has no pruning (Finding 7).
- **Backups and a workflow on a PUBLIC repo.**
  - No secret appears in the file. The job-level env comes only from `secrets.*`.
  - The plain dump is piped straight into gpg and never written to disk. Only `*.dump.gpg` is uploaded, kept 30 days, with `permissions: contents: read`.
  - psql/pg_dump error messages don't print the password, and GitHub masks secrets.
  - `actions/checkout@v4` and `upload-artifact@v4` are pinned by tag, not SHA. Acceptable.
  - Blocking problem: Finding 1. Restore risk: Finding 8.
- **CSP and security headers.** Safe for both gateways. The new CSP only sets `frame-ancestors 'self'; base-uri 'self'; object-src 'none'` and has no `script-src`, `frame-src` or `connect-src`. So `sdk.cashfree.com`, `checkout.razorpay.com`, their API calls and their iframes/popups are not restricted at all. Neither gateway frames our pages: Cashfree uses `redirectTarget: '_modal'` (`BuyTickets.tsx:72`) and Razorpay uses the handler, not `callback_url`. `X-Frame-Options: SAMEORIGIN` was already there. The criterion-21 manual check on a preview is still worth doing once.
- **`run-e2e.sh` exports DEMO_PAYMENTS, E2E_ERROR_ROUTE and ADMIN_EMAILS.** Production can't inherit these.
  - They're exported only in the test script's shell.
  - `.env.local` (which also has DEMO_PAYMENTS) is gitignored, so Vercel never sees it.
  - Production ignores DEMO_PAYMENTS anyway and warns `TEST_SETTING_IN_PRODUCTION`.
  - Remaining weak point: "production" is decided only by `VERCEL_ENV`/`APP_ENV` (Finding 4).

## Production SQL in the guide vs `db/schema.sql`

LAUNCH-CHECKLIST.md Part 2a matches `db/schema.sql:346-373` exactly:
- `login_attempts(key text pk, fails int not null default 0, window_start timestamptz not null default now())`
- `app_errors(id bigserial pk, at timestamptz not null default now(), where_, message, digest, path text)`
- the index `app_errors_at_idx (at desc)`
- `app_alert_state(id int pk default 1 check (id = 1), last_alert_at timestamptz not null default now())`
- RLS enabled on all three

All statements are idempotent. **OK.**

---

## Findings (most severe first)

### 1. HIGH: the backup workflow can never run from `full-app`, so there are no backups
`.github/workflows/db-backup.yml:16-18`, LAUNCH-CHECKLIST.md:190.

**What goes wrong:**
- GitHub runs scheduled workflows only from the **default branch** (`main` here; `origin/HEAD -> origin/main`).
- A `workflow_dispatch` workflow only shows the "Run workflow" button if the file exists on the default branch.
- The workflow exists only on `full-app`, and the standing rule is never to touch `main`.

So Harshith follows Part 10, finds no "Database backup" workflow under Actions, and production runs on Supabase Free (no backups of its own) with **no backups at all**. Everyone believes there is a daily copy.

**Fix (needs Harshith):** pick one.
- (a) Allow just this one file to be added to `main`. The prototype is unaffected.
- (b) Make `full-app` the repo's default branch. That is a GitHub setting he changes.
- (c) Go to Supabase Pro before real data and keep the workflow as an extra copy later.

Until he decides, the guide must say plainly that backups are not running. The Tester can't run Actions here.

### 2. MEDIUM-HIGH: login and gate-scanner login crash until the production SQL is applied, and health still says "ok"
`src/lib/auth.ts:118-133` (`loginThrottled` / `noteFailedLogin` query `login_attempts`), `src/app/api/health/route.ts:20`.

**What goes wrong:**
- CLAUDE.md says production "Tables match db/schema.sql", but the three new tables are not in production yet.
- If the new code is deployed (even as a Preview pointed at the production DB) before Part 2a is run, every login and every scanner unlock throws, and the user sees an error page.
- `/api/health` only runs `select 1`, so it answers 200 "ok" and the uptime monitor stays green.

**Fix:**
- In health and `configProblems()`, check the newest tables exist, e.g. `select to_regclass('public.login_attempts') is not null and to_regclass('public.app_errors') is not null`. If they don't, report problem `DATABASE_SCHEMA_OUTDATED`.
- Update the CLAUDE.md line to "Tables match db/schema.sql as of v2.1; v2.2 tables pending Harshith's OK".

### 3. MEDIUM: `/setup/keys` won't make the production pair once preview keys are set
`src/app/setup/keys/page.tsx:17`, LAUNCH-CHECKLIST.md:62-70.

**What goes wrong:**
- Harshith makes and sets the Preview keys first. The guide's order leads to this, and the page itself says "Redeploy. This page will then say Keys are already set".
- On Path A, production is still the static prototype, so `/setup/keys` doesn't exist there.
- When he comes back at go-live for the production pair, the only working page says "Keys are already set. Nothing to do here."
- He works from his phone, so `npm run keys` isn't an option.

**Fix (either):**
- When keys are valid, still offer a collapsed "Make a pair for another environment" button. Generating in the browser is harmless.
- Or change Part 3 to "make BOTH pairs now, one after the other (tap Make a different pair), and paste the production pair into Vercel's Production scope straight away". The page alone isn't enough for that.

### 4. MEDIUM (plausible): production detection relies only on `VERCEL_ENV`
`src/lib/env.ts:22-26`.

**What goes wrong:**
- Every production safeguard keys off `appEnv()`: test keys refused, demo blocked, no localhost links, production-only health checks.
- Vercel exposes system variables through a project setting ("Automatically expose System Environment Variables"). It is on by default, but this is an old project first set up for a static site. I couldn't confirm whether `VERCEL_ENV` is always present at runtime when that setting is off.
- If it's missing, production silently runs as `development`:
  - Cashfree **sandbox** keys would be accepted, and fake payments would issue real tickets.
  - Health wouldn't check the production-only settings.
  - Links could fall back to `localhost`.

**Fix:**
- Fail closed: treat it as production when `NODE_ENV === 'production'` and `DATABASE_URL` is not a local database and `VERCEL_ENV !== 'preview'`. The release check uses local Postgres, so it isn't affected.
- Also add to Part 9 step 5: "the System card must say **Environment: production**".

### 5. MEDIUM (needs Harshith): a preview that shares the production database writes sandbox "paid" orders into real data
LAUNCH-CHECKLIST.md:55 (Part 2c is only "recommended"), research brief Question 3 (still unanswered).

**What goes wrong:**
- On a preview, `appEnv()` is `preview`, so Cashfree **sandbox** payments are trusted.
- If Harshith skips 2c and points the preview at `thefest`, Part 8's test purchases become paid orders and valid tickets in the production database.
- They then count in organizer revenue, payouts and analytics. Their typed codes would admit at a real gate, because typed codes need no signature.

**Fix:** make 2c required, or add a red warning to Part 5/8: "if Preview uses the production database, don't buy on real fests, and delete test orders afterwards". This needs Harshith's answer to research Question 3.

### 6. MEDIUM-LOW: two Part 8 checks can't pass with the Resend test sender
LAUNCH-CHECKLIST.md:152-153 vs Part 4 step 3.

**What goes wrong:** while `EMAIL_FROM` is empty, Resend delivers only to Harshith's own address, and that address is already his admin account. So "Sign up a new student → confirmation email arrives" and "Forgot password → email arrives" fail for any other inbox. He'll think the app is broken.

**Fix:** say "do these two after the thefest.in domain is verified in Resend (Part 4 step 4)", or "use your own email for the reset test".

### 7. LOW: the error log can grow without limit, and normal users can add rows
`src/lib/errors.ts:14-25`, `src/app/(student)/tickets/[id]/page.tsx:52`.

**What goes wrong:**
- Every reported error is inserted, and nothing is ever deleted.
- If the signing keys break, every open ticket page writes a row every 15 s per student.
- Any logged-in user can repeat failing calls, such as `cashfree-verify` on an unpaid order when Cashfree errors.
- The free Supabase database is 500 MB.

**Fix:** skip the insert if the same `where_` + first line was logged in the last minute, and/or delete rows older than 30 days inside `reportError`, about 1% of the time.

### 8. LOW: the backup test is weak, and restoring a real Supabase dump is untested (plausible failure)
`tests/ops.sh:29`, `scripts/restore.sh:16-22`.

**What goes wrong:**
- `pg_dump -Fc` output is compressed, so the "not readable as SQL" grep would pass even without encryption.
- `restore.sh` creates `citext`/`pgcrypto` in the default schema. On Supabase, extensions often live in the `extensions` schema. A real dump could then reference `extensions.citext` and fail to restore into a fresh local database. This is unconfirmed: I didn't query production.

**Fix:**
- Make the test assert encryption directly: the file does not start with `PGDMP`, and `gpg --list-packets` shows a symmetric-key packet.
- After Finding 1 is fixed, do one real restore of a production backup into a scratch local database. Make `restore.sh` run `create schema if not exists extensions` and create the extensions there if needed.

### 9. LOW: `.env.example` defaults are unsafe if pasted wholesale into Vercel
`.env.example:43,70`, `src/lib/env.ts:40`.

**What goes wrong:**
- Vercel lets you paste a whole `.env` file.
- `NEXT_PUBLIC_SITE_URL=http://localhost:3000` on a Preview gives localhost links in emails and Cashfree return URLs, because `siteUrl()` ignores localhost only in production.
- `ADMIN_EMAILS=you@example.com` passes the health check.

**Fix:** leave both empty in `.env.example`, and have `siteUrl()` ignore a localhost value outside `development`.

### 10. LOW: guide polish
- **Part 9 step 3 (line 168).** Instead of asking Claude to push a tiny commit, use Vercel → Deployments → the latest `full-app` deployment → ⋯ → Redeploy / Promote to Production. That follows the "don't push small changes" rule.
- **Rollback (line 175).** Add one line: after real sales, rolling back to the prototype hides everyone's tickets, so roll back only for a few minutes and tell organizers.
- **Mismatched trimming.** `CASHFREE_ENV` with a stray space counts as "live" in `env.ts:68` (which trims) but as sandbox in `cashfree.ts:13` (which doesn't). Checkout would then fail with 502. There's no money risk, but both should use one helper.

### 11. LOW: lockout of gate volunteers is now real
`src/lib/auth.ts:118-133`, `src/app/scan/actions.ts:13`.

**What goes wrong:** the throttle now works across servers, as asked, and app and scanner login share it. Anyone who knows a volunteer's email can lock their scanner login for 15 minutes with 10 wrong passwords. On fest day that stops a gate. The table also gains a row per made-up email.

**Fix:** not for this round. It's IP-based or per-portal limiting, which the research brief puts out of scope. Record it as a known risk, and add a line to the guide: "if a volunteer is locked out, add another volunteer's email under Volunteers".

---

## Test plan for the Tester

Run the full release check first: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh`. Everything must pass. Then do these, which the builder did not automate or which need a closer look.

**Money / production safety**
1. `APP_ENV=production`, Cashfree **sandbox** keys and `CASHFREE_ENV=sandbox`. POST `/api/checkout/cashfree-verify` and `/api/webhooks/cashfree` for a pending order, faking a "PAID" answer by stubbing `getCashfreePayment` or with a local mock. Expect: the order stays `pending`, no tickets, the webhook answers 200 `{ok:false}`.
2. Same with an `rzp_test_` key: a correctly signed Razorpay webhook → 200 `ignored`, the order stays pending. POST `/api/checkout/verify` → 503.
3. `APP_ENV=production`, `CASHFREE_ENV="production "` (trailing space) with fake keys. Record what health says and what checkout does (Finding 10).
4. Production simulated **without** `APP_ENV` and `VERCEL_ENV` (`NODE_ENV=production`, non-local-looking DB URL, using a hosts alias or a DB URL that isn't localhost). Record whether sandbox keys are accepted. This shows Finding 4.
5. Change a ticket type's price to 0 → paid between the page load and checkout, with the gateway off. Expect 503, and `sold` back to where it was (`route.ts:77-80`).

**Schema / health**
6. Drop `login_attempts` on a scratch copy and start the app. Log in and unlock the scanner, and record the result. Check `/api/health` and record whether it still says ok (Finding 2).
7. Run the Part 2a SQL from LAUNCH-CHECKLIST.md twice on a fresh local DB built from the **v2.1** schema (checkout `abc3924:db/schema.sql`). No errors. The result matches `db/schema.sql` (compare `\d login_attempts`, `\d app_errors`, `\d app_alert_state`, RLS flags).

**Keys page**
8. With valid keys set, open `/setup/keys` at 390px and confirm there's no way to make a second pair (Finding 3). With keys unset, tap Make keys, then "Make a different pair". Both pairs differ and both work in `.env.local`.
9. Check the network log for `/setup/keys`: no POST or fetch carries `BEGIN PRIVATE KEY` or any base64 fragment of it.

**Error log**
10. Hit a failing path 50 times quickly (the test-error route locally). Confirm one alert email, and record how many `app_errors` rows were added (Finding 7). As a student and as an organizer, open `/admin/errors` and `/admin`: redirected, and no System card.
11. With the signing keys removed, keep a ticket page open for 2 minutes. Count the `app_errors` rows added.

**Backups**
12. Run `scripts/backup.sh` on local data and check `head -c 5 FILE` is not `PGDMP`. Run `gpg --list-packets` with no passphrase and confirm it shows a symmetric-key packet. Run `pg_restore --list FILE` and confirm it fails.
13. Make an **unencrypted** `pg_dump -Fc` and run the ops.sh grep on it. Record that it passes too (Finding 8).
14. Confirm by reading, not running, that no step in `db-backup.yml` echoes `$BACKUP_DATABASE_URL`, and that `path:` uploads only `*.dump.gpg`.

**Mobile / plain language**
15. At 390px: the fest page with the gateway off (UPI on and UPI off), `/admin` System card, `/admin/errors` with a long stack trace, and the ticket page after the 10-minute stop ("Tap to refresh" at the top). No sideways scroll. Read every new message aloud and flag anything a student wouldn't understand.

**Manual on a Vercel preview (once Harshith sets it up)**
16. The Cashfree sandbox modal opens and completes, and the webhook arrives with the protection-bypass query parameter.
17. Razorpay test checkout opens, if keys are set.
18. Response headers include the CSP, and the browser console shows no CSP errors during checkout.
19. `/api/health` = ok, and the System card shows `Environment: preview`.

**Read-only production check (with the coordinator; do not change anything)**
20. Confirm whether `login_attempts`, `app_errors` and `app_alert_state` exist in Supabase `thefest`. If they do, confirm Harshith OK'd it. Also record which schema `citext` lives in (`select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace`) for Finding 8.

## Questions for Harshith

1. **Backups (Finding 1).** GitHub only runs the daily backup from the `main` branch. Which do you prefer?
   - (a) Let us add just the backup file to `main` (the old site isn't affected).
   - (b) Make `full-app` the repo's main branch in GitHub settings.
   - (c) Skip GitHub backups and move Supabase to Pro ($25/month, daily backups) before the first real fest.
2. **Test database (Finding 5, research Question 3).** May we create a second free Supabase project `thefest-preview` for testing, so test payments never land in the real database?
3. **Confirm the coordinator's choices:**
   - card checkout stays OFF on thefest.in until Cashfree live keys exist (bank UPI and free tickets still work)
   - functions run in Mumbai
   - login protection is kept in the database

   These were chosen for you. Say yes and they'll be recorded as your decisions.

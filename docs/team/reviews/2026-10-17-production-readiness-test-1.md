# Tester report: production readiness (commit bea0a53), round 1

Date: 2026-10-17 · Tester · Branch `full-app` (local, nothing pushed) · Local Postgres only. No production database or real accounts were used.

## Result: FAILURES

Two ways exist for **production to issue a real ticket from a sandbox (fake) payment**: Failures 1 and 2. A missing table also takes down every login while health says "ok": Failure 3.

## Release check numbers

| Suite | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 (with new tests) |
|---|---|---|---|---|---|
| pricing / UPI parsing | pass | pass | pass | pass | pass |
| e2e.py | 53/53 | 53/53 | 53/53 | 53/53 | 53/53 |
| upi.py | 16/16 | 16/16 | 16/16 | 16/16 | 16/16 |
| refunds.py | 12/12 | 12/12 | 12/12 | 12/12 | 12/12 |
| password.py | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 |
| race.py | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| team.py | 33/33 | 33/33 | 33/33 | 33/33 | 33/33 |
| analytics.py | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 |
| errors.py | 24/24 | 24/24 | 24/24 | 24/24 | 24/24 |
| prod.py | 79/79 | 79/79 | 79/79 | 79/79 | 79/79 |
| ops.sh | 17/17 | 17/17 | 17/17 | 17/17 | 17/17 |
| **new** money.py | | | | | **34/38** |
| **new** schema_backup.sh | | | | | 14/14 |
| **new** prod_extra.py | | | | | **19/20** |

The existing release check passed 4 times out of 4. `run-e2e.sh` now stops at `money.py` until Failures 1 and 2 are fixed, because it runs with `set -e`. `schema_backup.sh` and `prod_extra.py` were run by hand on the same data.

## New tests (added to `tests/run-e2e.sh` after `ops.sh`)

- `tests/money.py`: production money safety. It runs on port 3003. Each refusal has a development-mode control that *does* issue the ticket, so a refusal proves the guard works.
- `tests/fake_cashfree.mjs`: a test-only stand-in for Cashfree, loaded with `NODE_OPTIONS=--import`. The sandbox host accepts only `TEST…` app ids and the production host only non-test ids. It logs every call.
- `tests/pg_tls_proxy.py`: a TLS front for local Postgres, so the app can be pointed at a non-local host (`vm:6543`). The app requires TLS for any non-localhost database.
- `tests/schema_backup.sh`: runs the Part 2a SQL twice on a v2.1 DB and compares it with `db/schema.sql`, and checks that backups are really encrypted.
- `tests/prod_extra.py`: covers the missing `login_attempts` table, `/setup/keys` making two pairs with nothing sent, an error burst, admin pages for non-admins, and a ticket page left open with the keys removed.

## Failures

### 1. HIGH: `CASHFREE_ENV="production "` (trailing space) with sandbox keys makes production trust sandbox payments
- **Did:** Started a server with `APP_ENV=production`, Cashfree sandbox keys (`TEST…`, `cfsk_ma_test_…`) and `CASHFREE_ENV="production "` (a paste with a trailing space or newline in Vercel). Then paid card checkout, then `cashfree-verify`.
- **Expected:** No ticket, and health flags test keys in production.
- **Happened:** Checkout opened a **sandbox** Cashfree order (`env: "sandbox"`), and the fake sandbox said PAID. The order became `paid` with 1 ticket.
  - Health listed no gateway problem and no `NO_LIVE_GATEWAY` warning: `{"problems":["RESEND_API_KEY","ADMIN_EMAILS"],"warnings":["TEST_SETTING_IN_PRODUCTION"]}`.
  - So health shows Cashfree as live. Without a mail key and admin list, health would say "ok".
- **Why:**
  - `src/lib/env.ts:13,67` trims, so `cashfreeLive()` is true and `providerTrusted('cashfree')` is true.
  - `src/lib/cashfree.ts:13-14` (`cashfreeMode`) does not trim, so every call goes to `sandbox.cashfree.com`, where sandbox keys work.
  - Nothing checks Cashfree's own test-key prefix (`TEST` app id).
- **Correction to review Finding 10:** the review calls the mismatched trim "no money risk". With **sandbox** keys it is a money risk. With live keys it fails safely (502, seat released; confirmed).
- **Likely files:** `src/lib/cashfree.ts:13`, `src/lib/env.ts:67`. Use one trimmed helper, and treat a `TEST`-prefixed app id as test keys.
- Test: `money.py`, "CASHFREE_ENV=\"production \" …" (2 checks).

### 2. HIGH (confirms review Finding 4): production without `APP_ENV`/`VERCEL_ENV` fails open
- **Did:** Ran `next start` (so `NODE_ENV=production`) with no `APP_ENV` or `VERCEL_ENV`, and `DATABASE_URL=postgres://postgres@vm:6543/thefest` (a non-local host, over TLS).
  - (a) With Cashfree sandbox keys.
  - (b) With no keys and `DEMO_PAYMENTS=1`.
- **Expected:** Treated as production, so no sandbox trust and no demo.
- **Happened:**
  - (a) A sandbox PAID order was paid and the ticket issued.
  - (b) Checkout returned `mode: "demo"`, and `demo-confirm` issued a **paid ticket with no money**.
  - `/api/health` = `200 {"status":"ok","db":"up"}`, so nothing warns.
- **When it bites:** only if Vercel ever runs without `VERCEL_ENV` (the review couldn't confirm this). For (b), `DEMO_PAYMENTS=1` would also have to be in Vercel's env.
- **Likely file:** `src/lib/env.ts:22-26` (`appEnv`). The supervisor's suggested fail-closed rule fits.
- Test: `money.py`, "no APP_ENV/VERCEL_ENV …" (2 checks).

### 3. MEDIUM-HIGH (confirms review Finding 2): missing `login_attempts` means every login fails and health says "ok"
- **Did:** Copied the seeded DB, dropped `login_attempts`, and started the app.
- **Happened:**
  - Student login: POST 500, "Something went wrong — It's on us."
  - Volunteer scanner unlock: the same 500.
  - `/api/health` → `200 {"status":"ok","db":"up"}`.
- **Expected:** Health reports the outdated schema (e.g. `DATABASE_SCHEMA_OUTDATED`).
- **Screenshot:** `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/extra/no_login_attempts_scan_390.png`
- **Likely files:** `src/app/api/health/route.ts:20`, `src/lib/env.ts` `configProblems()`, `src/lib/auth.ts:118-133`.
- Test: `prod_extra.py`, "missing login_attempts: /api/health is NOT ok" (login results are recorded as notes, not asserted).

### 4. LOW (pre-existing, affects the changed screens): admin pages have no side margin at 390px
- **Seen:** On `/admin` (System card), `/admin/errors`, `/admin/fests` and `/admin/orders`, headings, intro text and stat cards touch the left edge of the screen. The sponsor dashboard heading does too. It is fine at 1280px.
- **Cause:** `.page { padding: 20px 0 … }` (`src/app/globals.css:88`) overrides `.wrap`'s `padding: 0 var(--gutter)`, and `src/app/admin/layout.tsx:18` uses `className="wrap page …"`.
- **Screenshots:**
  - `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/shots/admin_system_card_390.png`
  - `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/shots/crop_errors_top_390.png`
  - `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/shots/sheet3.png`

### 5. LOW: intermittent React hydration error #418 (real, rare)
- **Captured** with a hook that logs every browser console error and page error from every test, with the page URL and recent navigation history.
- **Seen once in 3 full runs (run 4):**
  - Test: `refunds.py`, 05:31:12.
  - Page: `/organizer/<Commerce Carnival id>/sales`, organizer2, 1280px.
  - Steps: cancel the whole fest (Settings) → Sales → Payments → paste a bank alert → "Match payments" → `goto` Sales. The error fired on that last Sales load.
  - Message: `Minified React error #418; args[]=HTML` ("server rendered HTML didn't match the client").
- **Not reproduced** in 10 more `refunds.py` runs (reseeded each time), 100 looped rounds of Payments → Match → Sales → reload on live and cancelled fests (~400 loads), or run 5.
- No render-time `Date`/`Math.random`/`window` use was found in the client components on that page (`OrgShell`, `ActionForm`, `Submit`). It looks timing-related. The page recovers by re-rendering on the client, so users see nothing broken.
- **Likely area:** `src/app/organizer/[festId]/sales/page.tsx` or `src/components/OrgShell.tsx`. A non-minified (dev) build is needed to see the differing element.
- Log: `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/console-run4.jsonl` (line 6).

## Test plan results (review section "Test plan for the Tester")

| # | Result |
|---|---|
| 1 | PASS. Prod + sandbox keys: `cashfree-verify` → 409 "Card payments are switched off right now.". The webhook → 200 `{ok:false}`. Orders stay pending with 0 tickets, and `sold` is unchanged. The dev control issued exactly 1 ticket despite 6 parallel confirmations. |
| 2 | PASS. A signed `rzp_test_` webhook → 200 `{"ignored":"test keys are not trusted in production"}`, and the order stays pending. A correctly signed `/api/checkout/verify` → 503. The dev control issued the ticket. |
| 3 | **FAIL**, see Failure 1. |
| 4 | **FAIL**, see Failure 2. |
| 5 | PASS. A row lock forced the price change from ₹0 to ₹199 to land between the price check and the seat hold: 503, `sold` back to where it was, no ticket. The stale "free" page plus a double-tap after the price change: plain message, no ticket. |
| 6 | **FAIL**, see Failure 3. |
| 7 | PASS. Part 2a ran twice on an `abc3924` database with no errors. Columns, defaults, constraints, indexes and RLS match `db/schema.sql` exactly, and the full schema applies on top afterwards. |
| 8 | PASS, with an observation. Make keys → Make a different pair gives two different pairs. Each pair, set on a server, gives health 200 and a signed QR that scans. With keys set, the page has **no** button to make another pair (Finding 3 confirmed: 0 "Make…" buttons). |
| 9 | PASS. 16 requests were checked: no URL, body or header carries any 16-character base64 piece (or 12-byte hex piece) of either private key. No POST, no websocket. |
| 10 | PASS. 50 errors in a burst → all 500, **exactly 1** alert email, **50** `app_errors` rows (no de-duplication; Finding 7). Student, organizer and sponsor are redirected away from `/admin`, `/admin/errors` and `/admin/orders`, with no System card. Logged out → login. |
| 11 | Recorded. With keys removed, one open ticket page wrote **9 rows in 2 minutes** (about 4 per minute per phone, until the 10-minute stop). The page keeps showing the typed code. |
| 12 | PASS. The file doesn't start with `PGDMP`. `gpg --list-packets` with no passphrase shows a symmetric-key packet. `pg_restore --list` fails. |
| 13 | **Contradicts review Finding 8.** An unencrypted `pg_dump -Fc` contains `CREATE TABLE` 42 times in plain text (the table of contents isn't compressed), so the `ops.sh` grep **fails** on it. The existing check is meaningful. Only the email grep alone would be weak. |
| 14 | PASS (read only). No step echoes `$BACKUP_DATABASE_URL`. It is used only as a `psql`/`pg_dump` argument and comes from `secrets.*`. The upload `path:` is `backups/*.dump.gpg`, with `if-no-files-found: error` and `retention-days: 30`. |
| 15 | PASS, with Failure 4. Screenshots are below. No sideways scroll on any of 57 screens × 2 widths. |
| 16–19 | NOT RUN. These need a Vercel preview, which Harshith sets up. |
| 20 | NOT RUN. A read-only check of production Supabase is outside what the Tester may touch. The coordinator should do it. |

### Extra "no paid ticket without money" sweep (production, no gateway keys): all PASS
- Paid card checkout → 503. `demo-confirm` → 404.
- `cashfree-verify` on an old Cashfree order → 502, nothing issued.
- Cashfree webhook → 401. Razorpay webhook with an empty-secret signature → 401. Razorpay `verify` → 503.
- Bank UPI plus a typed UTR, submitted twice → order still pending, no ticket.
- qty `0`, `-1`, `11`, `1.5` and `1e9` → 409 "Choose between 1 and 10 tickets.". `"2"` and missing qty → handled.
- An unknown `method` is treated as card → 503. Logged out → 401.
- No new paid order with money appeared.
- Signup with Kannada and Hindi names works.

## Screenshots reviewed

All are in `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/shots/`, each at `_390.png` and `_1280.png`. On every one I checked for sideways scroll (measured), overlapping or cut-off text, and contrast.

- `buy_cardoff_upi_on`: Kalaa, production, no keys, UPI on. The "Online card/UPI payment opens soon…" note and the "Pay ₹414 by UPI" button are clear. OK.
- `buy_cardoff_upi_off_longname_hugeprice`: Hackverse, UPI off, with a long Hindi + Kannada ticket name and a ₹99,99,999 price. The name wraps cleanly and the price fits. "Not on sale online yet" is greyed out but readable. OK.
- `api_health_prod_nokeys`, `api_health_nokeys_dev`, `api_health_ok`: plain JSON, names only, no values. OK.
- `ticket_after_10min` (fake clock, 11 minutes): "↻ Tap to refresh" sits at the top above the ticket, and the QR and code are intact. OK. The bottom nav drawn over the page is an artifact of full-page screenshots.
- `admin_system_card`: rows aligned, problems and heads-up boxes wrap at 390px. OK, apart from the missing side margin (Failure 4). The heads-up shows raw codes (`NO_LIVE_GATEWAY, TEST_SETTING_IN_PRODUCTION`). That's admin-only, but `TEST_SETTING_IN_PRODUCTION` isn't in the LAUNCH-CHECKLIST "What /api/health problems mean" table.
- `admin_errors_longtrace`: a 200-character unbroken URL and a long stack wrap inside the card. No overflow. Missing side margin (Failure 4).
- `setup_keys_unset`, `setup_keys_made`, `setup_keys_set`: keys wrap in the boxes, and Copy / Make a different pair are visible. With keys set, it shows only "Keys are already set. Nothing to do here." (Finding 3).
- Empty database, all portals (`empty_*`): landing, discover ("No fests found"), login, signup, scanner login, organizer "Set up your fest" (Kannada welcome name), student tickets and profile (Hindi name and avatar initials), sponsor "No sponsorships linked yet", admin overview, fests, orders and errors (all empty states), and scanner unlock for a user who isn't on any gate team (clear message). All render. Admin pages have the missing side margin (Failure 4).

Plain-language read of the new student messages: "Online card/UPI payment opens soon. For now, pay by UPI straight to the fest — no extra fee.", "Card/UPI checkout isn't open yet. Use bank UPI if the fest offers it.", "Ticket sales are paused for a moment. Please try again later." and "The QR code can't be shown right now. Your ticket is safe — show the code below…". All are clear. "Bank UPI" is the only slightly technical phrase.

## Other notes
- `tests/run-e2e.sh`: the EXIT trap kills the `npx` wrapper, not the `next-server` child. When a test fails, the :3000 server stays up until the next run kills it. Harmless.
- The console-capture hook used for #418 is `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/hook/sitecustomize.py`. Use it with `PYTHONPATH=<dir> CONSOLE_LOG=<file>`; no test changes are needed.

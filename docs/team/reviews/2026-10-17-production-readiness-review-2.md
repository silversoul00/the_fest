# Supervisor review: production readiness, fix round 1 (commit 4d000bb), round 2

Date: 2026-10-17 · Supervisor (fresh reviewer) · Branch `full-app`, local only (`origin/full-app` is still abc3924, so nothing has been pushed)
Inputs:
- `docs/team/BRIEF.md`
- `docs/team/research/2026-10-17-production-readiness.md`
- round-1 review and test reports
- `git diff f2465d3 4d000bb`

What I ran:
- `tsc --noEmit`: clean.
- A login race on a scratch copy of the local database (`thefest_sup`, dropped afterwards).

I did not edit any app code and did not touch any production account.

## Verdict: PASS (no blocking issues; three small follow-ups recommended before go-live)

Every HIGH and MEDIUM item from round 1 is fixed or written down honestly as needing Harshith.

Money safety now holds in every case I could build:
- **Production never trusts sandbox or demo money.** This covers sandbox keys, test-prefixed keys, a stray space in `CASHFREE_ENV`, and a missing `VERCEL_ENV`.
- **A real Vercel preview can still use sandbox keys.**
- **The production SQL in the guide matches `db/schema.sql` exactly**, and it only adds things.

What's left is minor:
- The login limit can be overshot by sending many attempts at once. Confirmed: 21 checked guesses against a limit of 10.
- One line of guide advice is wrong for the per-email cap.
- One column is missing from the schema check.

---

## Brief check

| BRIEF.md line | Result |
|---|---|
| Never merge to `main` | OK. `main` untouched. The guide offers "put just the backup file on `main`" only as Harshith's choice ("Claude won't touch `main` without your OK"). |
| Don't push small changes | OK. Nothing pushed. The guide now uses Vercel **Promote to Production** instead of "push a tiny commit" (LAUNCH-CHECKLIST.md:177-179). |
| Never change his Supabase/Vercel/Cashfree/Razorpay accounts | OK. Nothing in the commit touches them. The v2.2 SQL is still unapplied in production; CLAUDE.md now says so. Creating `thefest-preview` is listed as a question, not done (BRIEF open decision 7; guide 2c says "Claude will ask you before creating it"). |
| Decisions needing Harshith are written down, not guessed | OK. Fixed since round 1. BRIEF "Open decisions" 6–8 record backups, the preview database and the coordinator's choices as **waiting for his yes**, not as decided. |
| Cashfree main, Razorpay fallback, zero-fee bank UPI must work | OK. With no live gateway, bank UPI and free tickets still work. Live Cashfree with `CASHFREE_ENV=production` (spaces and case ignored) works and goes to the production host. |
| Commission ₹15 flat default | OK. The `.env.example` fee defaults (`flat`, `1500`, `student`, `PASS_GATEWAY_FEE=true`) equal the code defaults in `payments.ts:12-27`, so pasting the file changes nothing. |
| Explain in plain language, phone-friendly | Mostly OK. The new guide text is clear, with tap paths. One inaccurate line: Finding 2. |
| Gate scanner always asks to log in again | Untouched. Still covered by prod.py. |
| Organizer analytics refreshed on open, not live | Untouched. |
| Hosting Vercel, DB Supabase, thefest.in | OK. |

## Round-1 status

### Supervisor review 1

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Backup workflow can't run from `full-app` | **Written down; still waiting on Harshith** | Workflow header comment (`db-backup.yml:11-12`). Guide Part 10 says "⚠️ NOT running yet" and gives 3 options. BRIEF open decision 6. Only Harshith can fix it. |
| 2 | Missing tables break login, health says ok | **FIXED** | `schema-check.ts` checks every table and later-added column; health returns 503 "database setup incomplete: …" (`health/route.ts:20-24`). The throttle fails open (`auth.ts:451-487`); fixes1.py:177-184 shows login and scanner unlock still work. CLAUDE.md is corrected. Small gap: Finding 3. |
| 3 | `/setup/keys` can't make a production pair once keys are set | **FIXED** | `setup/keys/page.tsx:18-25` adds a collapsed "Need keys for another environment?" section. KeyGen `other` never receives the current keys. The guide says "make both pairs in one sitting". Covered by fixes1.py:258-270. |
| 4 | Production detection relies only on `VERCEL_ENV` | **FIXED** | `env.ts:27-34`. Analysis is under "Production fail-safe" below. |
| 5 | Preview sharing the production DB | **Fixed in the guide; the decision is Harshith's** | Guide 2c is now "required", with the reason in plain words; Part 5 and Part 8 repeat it. The code still trusts sandbox payments on any preview, whatever its database. That is acceptable, and there is an optional code guard in Finding 6. |
| 6 | Resend test sender can't pass Part 8 email checks | **FIXED** | Part 4 step 3 says to verify the domain first. Part 8 marks the two steps "Needs the verified domain". |
| 7 | Error log grows without limit | **FIXED** | `errors.ts:24-62` merges repeats and prunes. Covered by fixes1.py:220-246. Concurrency is analysed below. |
| 8 | Backup test weak / restore of a real Supabase dump untested | **Test part: withdrawn** (Tester 1 showed the `CREATE TABLE` grep is meaningful). **Restore part: NOT FIXED** | `scripts/restore.sh` is unchanged, so the `extensions` schema risk is still unconfirmed (Finding 5). It can only be tested once backups run. |
| 9 | `.env.example` defaults unsafe to paste | **FIXED** | Site URL and admin emails are now empty; `CASHFREE_ENV`, `DEMO_PAYMENTS` and `APP_ENV` are empty or commented out. `siteUrl()` ignores a localhost value outside development (`env.ts:48`). Remaining nit: Finding 7. |
| 10 | Guide polish (Promote, rollback warning, mismatched trimming) | **FIXED** | Guide :177-179 and :187. `cashfreeMode()` now uses `cashfreeEnvSetting()` (`cashfree.ts:15`). Keys and secrets are trimmed everywhere (`cashfree.ts:16,25-26,75`, `payments.ts:70-108`). |
| 11 | Anyone can lock a volunteer out of the gate | **PARTLY** | Per email + IP limit of 10 (`auth.ts:441-444`). But the per-email cap of 50 can still be reached from about 5 networks, people on the same college Wi-Fi share an IP, and the guide's advice doesn't fit the cap (Finding 2). |

### Tester report 1

| # | Failure | Status | Evidence |
|---|---|---|---|
| 1 | `CASHFREE_ENV="production "` + sandbox keys → sandbox payment issues a ticket | **FIXED** | `cashfreeTestKeys()` treats a `TEST…` app id or a `_test_` secret as test keys (`env.ts:90-92`). `cashfreeLive()` is therefore false and `providerTrusted('cashfree')` refuses. Health names `GATEWAY_TEST_KEYS_IN_PRODUCTION` (`env.ts:124`). The Tester's check (`money.py:172-188`) is **unchanged** and still requires a 503 that names it, and no ticket. |
| 2 | No `APP_ENV`/`VERCEL_ENV` + remote DB → sandbox and demo trusted | **FIXED** | `env.ts:32`. The Tester's checks (`money.py:211-238`) are unchanged. |
| 3 | Missing `login_attempts` → all logins 500, health ok | **FIXED** | As in review Finding 2. |
| 4 | Admin/sponsor pages have no side margin at 390px | **FIXED** | `globals.css:89` (`.page` sets top/bottom padding only). Covered by fixes1.py:289-301. |
| 5 | Intermittent React hydration error #418 | **NOT ADDRESSED** | Not in the commit. It couldn't be reproduced and users see nothing broken. It stays open as LOW (Finding 9). |
| — | `TEST_SETTING_IN_PRODUCTION` missing from the guide's table | **FIXED** | Guide table, last row. |
| — | `run-e2e.sh` EXIT trap leaves `next-server` running | Not addressed. Harmless. |

---

## Points I was asked to scrutinise

### 1. The builder's change to the Tester's check in `tests/money.py`: legitimate

**What the old check asserted** (live keys + `CASHFREE_ENV="production "`): checkout **fails** with a 5xx and the seat is released. That was only "safe" because of the bug: `cashfree.ts` didn't trim, so calls went to the sandbox host and live keys were refused there. Round-1 review Finding 10 and Tester Failure 1 both asked for **one trimmed reading everywhere**. With that fix, live keys + "production " correctly means live Cashfree, so the old expectation can't hold any more. The other consistent choice is "don't trim anywhere", and that would make health report a live gateway that never works.

**Is the new check weaker?** No.
- It asserts more than before. Health shows no test-key problem and no `NO_LIVE_GATEWAY`. Checkout returns `env: "production"`. **Every** Cashfree call went to the production host (`money.py:198-200`). The fake Cashfree (`tests/fake_cashfree.mjs`) only accepts non-`TEST` ids on the production host, so this really checks routing.
- The money-risk scenario, **sandbox** keys with the stray space, is the check above it. It was not touched and still requires a 503 with `GATEWAY_TEST_KEYS_IN_PRODUCTION` and no ticket.
- The removed `sold == s0` assertion no longer applies, because the checkout now succeeds. The builder releases the seat by hand afterwards so later checks start clean. Fine.
- Small gap: it doesn't assert that the `CASHFREE_ENV` problem is **absent** from health. fixes1.py:137 covers that (`" production "` with spaces on both sides).

**`tests/prod.py:135-138`.** Legitimate. Only the key format changed (`ip:<email>|<ip>` and `e:<email>`). Both counters must read 10, and the "11th attempt on the other server is blocked" check is kept. Both servers see 127.0.0.1, so they share the same per-IP key.

**`tests/errors.py:54-63`.** Legitimate.
- "Both errors stored" now counts `sum(repeats)` instead of rows. That's correct after de-duplication, and it still requires ≥ 2.
- A new check requires the two identical errors to add **at most one** row.
- The one-alert-email check is unchanged.

### 2. Production fail-safe (`src/lib/env.ts:27-34`)

**Can a real production deploy take sandbox or demo money?** I found no way.
- **Vercel Production sets `VERCEL_ENV=production`.** That gives production.
- **`VERCEL_ENV` missing at runtime** (system variables not exposed): `NODE_ENV=production` (Next.js sets it in `next start` and on Vercel), and the Supabase pooler host isn't local, so it is production.
- **`DATABASE_URL` missing**: `isLocalDatabase('')` returns false, so it is still production (fails safe).
- **In production:**
  - Test keys don't count. Cashfree `TEST…` ids, `_test_` secrets and `rzp_test_` keys are all excluded (`env.ts:90-94`).
  - `cashfreeEnabled` and `razorpayEnabled` need live keys (`payments.ts:42-43`).
  - Demo checkout is blocked (`payments.ts:52`).
  - Confirmations are refused when the provider isn't trusted (`confirm.ts:12`, `verify/route.ts:23`, `webhooks/razorpay/route.ts:14`).
  - The only raw environment reads left for gateways are in env.ts and the trimmed helpers; my grep finds none elsewhere.
- **The only way to downgrade production** is to set `VERCEL_ENV` to `preview` or `development` explicitly. Vercel sets `VERCEL_ENV` itself, and I believe it doesn't let a project override it (plausible, not confirmed). Nothing in `.env.example` or the guide sets it. Acceptable.
- **The release check isn't affected.** It runs on a local database, so it is development unless `APP_ENV=production`. Unix-socket URLs count as local (`env.ts:74-75`; fixes1.py:117).

**Can a real preview still use sandbox keys?** Yes. `VERCEL_ENV=preview` returns preview before the `NODE_ENV` rule (`env.ts:30`), and preview trusts sandbox (`payments.ts:42`). Covered by fixes1.py:101.
- If a preview ever ran without `VERCEL_ENV`, it would be treated as production. Card checkout would then be off there, which is the safe direction. Guide Part 8 now has Harshith check that the System card shows "Environment: preview", so he'd notice.

### 3. `src/lib/schema-check.ts` and health

- **Nothing leaks.** Health lists only the names of missing tables or columns, and only when something is missing. It never shows table contents, row counts or setting values. A database error is reported as `db: "down"` with no message (`health/route.ts:22-24`).
- **It should work through the Supabase transaction pooler.** It's one statement with two text parameters. It deliberately doesn't use a JS array, which is right for `prepare:false`. It uses only `to_regclass`, `string_to_array`, `unnest` and `information_schema.columns`, which a plain role can run. Not tested against real Supavisor here; the Tester's TLS stand-in isn't a pooler. **Plausible OK**, and the Preview check in the test plan below covers it.
- **Cost.** One small catalogue query per `/api/health` call and per `/admin` load: 21 table lookups and 28 column lookups. Fine for an uptime monitor every 1–5 minutes. `/api/health` is public, though, so anyone can make it run that query repeatedly. It's cheap, but a 30–60 second in-memory cache when the result is clean would cost nothing (Finding 8).
- **Correctness.** The lists match `db/schema.sql` except `users.email_verified_at` (Finding 3). fixes1.py:150-163 compares the lists with schema.sql, but its grep misses columns added inside the `do $$ … $$` block.

### 4. Login throttle (email + IP)

- **x-forwarded-for spoofing on Vercel.** `clientIp()` takes the first address in `x-forwarded-for` (`auth.ts:431-439`). Vercel's documentation says it overwrites `X-Forwarded-For` and doesn't forward client-supplied values, so on Vercel the first address is the real client. This comes from the docs; I can't test it here.
  - Off Vercel, or behind another proxy, the header can be forged. The per-email cap of 50 per 15 minutes still holds there.
  - On IPv6 mobile networks one attacker can rotate addresses cheaply, so in practice **the per-email cap is the real brute-force limit.**
- **Fail-open when the table is missing.** Acceptable, and better than round 1's "every login fails".
  - The risk window is from deploying the code to running Part 2a. During it there is no attempt limit at all; bcrypt (cost 11) still makes each guess slow.
  - Health shows 503 for that whole window, and every failure is logged.
  - The guide tells Harshith to run 2a **before** the app uses the database.
  - A temporary database error also fails open, but an attacker can't cause one on purpose.
- **Overshoot under parallel requests.** This one is confirmed: Finding 1.

### 5. Error-log de-duplication and pruning under concurrency (`src/lib/errors.ts:24-62`)

- **Two identical errors at the same moment, with no recent row:** both find nothing and both insert, giving 2 rows instead of 1. That's a bounded, harmless duplicate.
- **Two bumps of the same row at once:** the second `UPDATE` waits for the row lock, rechecks `id = X` (still true) and adds its +1. No count is lost (Postgres READ COMMITTED behaviour).
- **The write is one statement**, so a half-done write isn't possible.
- **Pruning.** It runs when a new row's id is a multiple of 50. Gaps in the id sequence only shift when it runs.
  - The delete is idempotent, so two prunes at once are harmless.
  - When there are fewer than 5,000 rows, `offset 5000` returns no row, so the row-limit condition removes nothing.
- **Small cosmetic quirk.** A page that keeps failing keeps one row alive for as long as it fails, because `at` moves forward with each repeat. So `sum(repeats)` in "N in the past 24 hours" and in the alert email can include repeats older than 24 hours or than the last alert. Not worth fixing now.

### 6. The guide and `.env.example`

- **Matches the code:**
  - the health problem names
  - the "database setup incomplete" text
  - Environment shown on the System card
  - keys made for another environment
  - `TEST` and `_test_` key detection
  - Promote to Production
  - the rollback warning
- **Phone-friendly.** It uses tap paths. The backups section is honest.
- **One inaccuracy:** Finding 2.
- **`.env.example`.** Pasting it whole into Vercel can't switch on anything unsafe: no demo, no `APP_ENV`, no localhost, no test admin. The fee defaults equal the code defaults. Nit: Finding 7.

### 7. Part 2a SQL against `db/schema.sql`

It matches exactly: LAUNCH-CHECKLIST.md:32-46 against `db/schema.sql:346-373`.
- **Columns and defaults are identical:** `login_attempts`, `app_errors` (now with `repeats int not null default 1`), `app_alert_state` with `check (id = 1)`.
- **Index and RLS:** the `app_errors_at_idx (at desc)` index exists, and RLS is enabled on all three tables.
- **Only adds things:**
  - every `create` uses `if not exists`
  - `add column if not exists repeats` covers a database where the round-1 `app_errors` already exists
  - there are no drops, updates or type changes

The guide's line "running all of `db/schema.sql` does the same" is also true. Its only drop is `orders_provider_check`, which is immediately re-added, and its one-time backfill only runs when the column is new.

---

## Findings (most severe first)

### 1. MEDIUM-LOW (confirmed): parallel wrong-password attempts overshoot the login limit
`src/lib/auth.ts:451-487`, `src/app/(auth)/actions.ts:49-55`, `src/app/scan/actions.ts:16-22`.

**What goes wrong:**
- The code checks the counter, then verifies the password (bcrypt, slow), then adds to the counter. Requests fired at the same moment all pass the check before any of them is counted.
- I tested this on a scratch copy of the local database with one `next start` server.
  - 40 parallel wrong-password posts for one account: **22 passwords were actually checked**, against a limit of 10. The counter ended at 23.
  - With 200 parallel posts: 21 checked.
- On Vercel, many server instances answer at once, so the overshoot is plausibly larger per burst. After each 15-minute window an attacker can burst again.
- No money is at risk, but the guessing limit is weaker than the 10 per 15 minutes the BRIEF records.

**Fix:**
- Count first, then decide. One atomic upsert (`insert … on conflict do update … returning fails`) for both keys **before** checking the password. If either counter is over its limit, stop without checking.
- On a correct password, `clearFailedLogins` as now.
- The Tester's parallel test below should then show at most 10 passwords checked.

### 2. LOW-MEDIUM: one guide tip is wrong when the per-email cap is hit; a volunteer can still be locked out
LAUNCH-CHECKLIST.md:208 ("They can switch to mobile data / another Wi-Fi"), `auth.ts:428`.

**What goes wrong:**
- After 50 failures from anywhere (for example 10 each from 5 phones or hotspots), the email itself is blocked. Switching network doesn't help.
- Both limits show the same message, "Too many attempts. Try again in 15 minutes."
- Also, students on the same college Wi-Fi usually share one public IP. A prankster on the campus Wi-Fi can still lock the gate volunteer with 10 tries.

So the tip works sometimes, not always.

**Fix (guide wording only):** "Switch to mobile data. If it still says Too many attempts, wait 15 minutes, or add another volunteer's email under Volunteers." Optionally give the per-email block its own message, so the volunteer knows switching network won't help.

### 3. LOW: the schema check misses `users.email_verified_at`
`src/lib/schema-check.ts:21-29`.

**What goes wrong:** that column is added inside a `do $$ … $$` block (`db/schema.sql:260-265`), so neither `REQUIRED_COLUMNS` nor fixes1.py's consistency grep catches it. A database without it would show health "ok" while sign-up, admin access and volunteer access break. Production already has it, so this is about future databases (for example `thefest-preview` built from an older file).

**Fix:** add `'users.email_verified_at'`, and widen the grep in fixes1.py to match `add column` without `if not exists`.

### 4. LOW: the fail-open throttle has no limit at all until Part 2a is run
`auth.ts:456-466`.

Fail-open was the right choice; see analysis point 4. This is a reminder for the coordinator: apply Part 2a in production **before** any deployment of this branch points at `thefest`, which is what the guide already says. No code change.

### 5. LOW (plausible, carried over): restoring a real Supabase dump is still untested
`scripts/restore.sh`.

Unchanged from round-1 Finding 8. Test it once backups are running (BRIEF open decision 6).

### 6. LOW (optional): a code guard so a preview can't use the production database
LAUNCH-CHECKLIST.md 2c relies on Harshith following the doc.

**Fix:** have the health check report a problem on a preview whose `DATABASE_URL` contains the production project ref (`uxhpvbgxftsdpcyycxpq`, or an optional `PRODUCTION_DB_REF` variable). The point is that sandbox payments can never become real-looking orders, even after a copy-paste slip. Optional; it's Harshith's call with open decision 7.

### 7. LOW: "safe to paste as a whole" still carries a placeholder `DATABASE_URL`
`.env.example` (the only uncommented `DATABASE_URL=` line).

**What goes wrong:** pasted into Vercel, it creates `DATABASE_URL=postgresql://postgres.xxxxxxxx:[YOUR-PASSWORD]@aws-?-…`. Health then says "down" until it's replaced. That's not unsafe, just confusing.

**Fix:** comment it out or leave it empty, with the example in the comment.

### 8. LOW: the public `/api/health` runs a catalogue query on every call
`src/app/api/health/route.ts:21`.

**Fix (optional):** cache an empty `missingSchema()` result in memory for 60 seconds. Never cache a non-empty one.

### 9. LOW (carried over): intermittent React hydration error #418 on the Sales page
Tester 1, Failure 5. Not addressed and not reproducible. Keep it on the list.

---

## Test plan for the Tester

Run the full release check first, twice: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh`.
- Expect fixes1.py 54/54 and money.py 38/38.
- Every round-1 suite must still pass.

Then run these.

**Money / production detection**
1. Re-run Tester-1 Failures 1 and 2 **by hand**, not only through money.py.
   - (a) `APP_ENV=production`, `CASHFREE_APP_ID=TEST…`, `CASHFREE_ENV="production "`. Expect health 503 with `GATEWAY_TEST_KEYS_IN_PRODUCTION`, and no ticket after a fake PAID.
   - (b) `CASHFREE_APP_ID` live-looking but `CASHFREE_SECRET_KEY=cfsk_ma_test_…` (only the secret is a test key). Expect the same refusal.
2. `VERCEL_ENV=preview` + sandbox keys + remote-looking DB (`vm:6543`, the TLS proxy). Expect: sandbox checkout works and issues the ticket (preview must still be able to test), health shows no production-only problems, and the System card says `Environment: preview`.
3. `NODE_ENV=production` (next start), **no `DATABASE_URL` reachable** (set it to a bogus remote host), no `VERCEL_ENV`. Expect health `down`, and the System card (if reachable) or a direct check says production. Record what happens.
4. `VERCEL_ENV=" PRODUCTION "` with a local DB. Expect production.
5. Live keys + `CASHFREE_ENV="Production"` (capital P). Expect production host calls only, and no `CASHFREE_ENV` problem.
6. Live-looking keys + `CASHFREE_ENV=sandbox` in production. Expect health 503 naming `CASHFREE_ENV`, and checkout fails safely with the seat released.

**Login throttle**
7. **Parallel burst (Finding 1).** Send 40 and then 200 simultaneous wrong-password posts for one account to `/login`, and also to `/scan` login. My script, which replays the captured server-action request, is at `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/sup/race.py`; run it on a database **copy**. Record how many responses say "Wrong email or password". If Finding 1 is fixed, expect at most 10.
8. Rotate `x-forwarded-for` across 60 sequential wrong posts. Expect a block after 50 (per-email cap). Then confirm a request with a new, never-seen IP is also blocked (cap is per email).
9. Same email: 10 wrong passwords from IP A, then the right password from IP B. Expect login works, and **both** `e:` and `ip:…|B` rows are cleared. IP A stays blocked until its window ends; record it.
10. Drop `login_attempts` on a copy. Make 30 wrong posts. Expect each to say "Wrong email or password" (no block), and **one** `app_errors` row with `repeats` ≥ 30. Then confirm health 503 names `login_attempts`.

**Schema check / health**
11. On a copy, drop `users.email_verified_at`. Record health. With Finding 3 unfixed, expect `ok` — that confirms the gap.
12. Drop `app_errors` only. Expect `/admin` still loads, the System card says "setup incomplete" with the Part 2a hint, and health 503 names `app_errors`.
13. Run Part 2a from the guide on (a) a v2.1 database (`abc3924:db/schema.sql`) and (b) a **round-1** database (`bea0a53:db/schema.sql`, which has `app_errors` without `repeats`). Run it twice each: no errors, `repeats` is added with default 1, and existing rows are kept.
14. Health over 100 back-to-back calls: record the average time, and confirm no `problems` entry ever contains a value (password, key, URL).

**Error log**
15. Fire the same test error from 20 parallel requests. Record the rows added (≤ 2 expected) and confirm `sum(repeats)` = 20.
16. Seed 5,100 error rows, plus some older than 30 days. Trigger new distinct errors until a multiple-of-50 id is inserted. Expect ≤ 5,000 rows, none older than 30 days, and the newest kept.

**Keys page / mobile / plain language**
17. `/setup/keys` with keys set, at 390px. Open "Need keys for another environment?" → make a pair → Make a different pair. Confirm both pairs differ from each other **and from the site's current public key**, nothing is POSTed, and there's no sideways scroll.
18. At 390px, screenshot the System card in three states: database setup incomplete, `DEMO_PAYMENTS_IN_PRODUCTION`, and all good. Also `/admin/errors` with a "20 times, last …" row. Check the side margins (Tester-1 Failure 4) on `/admin`, `/admin/errors`, `/admin/fests`, `/admin/orders`, `/sponsor`, and an organizer page.
19. Read the new guide sections (2a, 2c, 3, 4, 8, 9, 10, the volunteer tip, the health table) on a 390px phone viewport of the rendered Markdown on GitHub. Flag any table that scrolls sideways or any step a non-developer can't follow.

**Manual, needs Harshith's Vercel preview (not runnable here)**
20. On a real Vercel preview using the `thefest-preview` pooler:
    - `/api/health` answers `ok`, which proves `missingSchema()` works through Supavisor with `prepare:false`
    - the System card says `Environment: preview`
    - the Cashfree sandbox checkout completes
21. After go-live: `https://thefest.in/admin` System card says `Environment: production`.

**Read-only production check (coordinator)**
22. Before any deployment points at `thefest`, confirm that Part 2a has been applied (Finding 4).

## Questions for Harshith

None new. The open ones are already in BRIEF.md "Open decisions" 6–8: backups, a separate preview database, and confirming the coordinator's choices. Finding 6 is an optional add-on to decision 7.

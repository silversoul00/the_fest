# Full exploratory bug hunt — 2026-10-23

**Tester:** independent exploratory run in a real browser (Playwright Chromium), on its own server and database copy:
`PORT=3100`, `DATABASE_URL=…/thefest_explore` (schema.sql + demo-seed.sql), `DEMO_PAYMENTS=1`, build from HEAD `854327f`.
The release check (`tests/run-e2e.sh`) was run separately by the coordinator on :3000. No app code changed.

**Result: FAILURES** — 0 Critical, 1 High, 5 Medium, 9 Low. Nothing lets money go missing or tickets be duplicated.

Screenshots: `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/bughunt/` (bugs are `bug_*.png`;
crawl screenshots of every page at 390px are in `crawl/`). Scripts are in the scratchpad (`crawl.py`, `s1.py` … `m3.py`).

## Bugs (most serious first)

### High
**H1. Open redirect on `/login?next=` for anyone already logged in.**
- Repro: log in as any user, then open `http://<site>/login?next=//example.org/phish` (or `/%5Cexample.org/phish`).
- Expected: stay on THE FEST (go to your portal). Actual: `307 Location: //example.org/phish` — the browser goes to example.org.
  A thefest.in link can send logged-in students to a fake "payment"/login page (phishing).
- Cause: `src/app/(auth)/login/page.tsx:12` — `redirect(next?.startsWith('/') ? next : …)` does not reject `//` or `/\`.
  `safeNext` in `src/app/(auth)/actions.ts` blocks `//` but not `/\` (the client router happened to resolve it safely in my test).
  Use one shared check that rejects `//`, `/\` and `\` everywhere.

### Medium
**M1. Very large numbers crash forms with "Something went wrong" (typed data is lost).**
- Organizer → New fest, Total capacity `99999999999` → Create → error page (`bug_capacity_crash.png`).
  Same in Settings → capacity (`3000000000`). Postgres `22003 out of range for type integer`.
- Admin → Fests & payouts → Record payout, amount `99999999` → error page.
- Expected: "Capacity must be at most …" message. Files: `src/app/organizer/actions.ts` (FestSchema `capacity`, lines 62/84/99),
  `src/app/admin/actions.ts` `recordPayout`.

**M2. Adding a sponsor with a big deal amount says "This sponsor is already added".**
- Organizer → Sponsors → Add sponsor, amount ₹3,00,00,000 (3 crore) → "This sponsor is already added" although it isn't.
- Cause: `addSponsor` (`src/app/organizer/actions.ts:284-289`) turns *every* insert error into that message; the real error is
  int overflow (`sponsors.amount_paise int`). Expected: a limit message (e.g. "up to ₹1 crore", like sponsorship requests use).

**M3. Reject after Confirm (two tabs / two co-organizers) crashes the payments page.**
- Repro: two tabs on Payments with the same pending bank-UPI order. Tab 1 → Confirm. Tab 2 → Reject → "Something went wrong"
  (`bug_reject_after_confirm.png`). The order stays paid (data is safe), but the organizer sees a crash.
- Cause: `rejectUpiOrder` action (`src/app/organizer/actions.ts:428-433`) doesn't catch `OrderError('Order not found or already
  handled.')` from `lib/upi.ts`. `confirmUpiOrder` right above it does catch. Expected: a calm "already handled" + refresh.

**M4. A live fest's dates can be changed after tickets are sold, with no warning or notice to buyers.**
- Repro: Neon Utsav (live, 145 tickets, lunch on 23/24 Oct) → Settings → End date 22 Oct → "Saved."
  Ticket holders aren't told, and lunch days already sold now fall outside the fest. Same for name/college — a fest can be
  approved and then renamed to anything without another review.
- File: `updateFest` in `src/app/organizer/actions.ts:94-106`. Needs a decision from Harshith (lock dates once sold / notify / re-review).

**M5. Created fests whose name is only Kannada/Hindi get the URL `/fests/fest`.**
- Repro: create "ನಮ್ಮ ಉತ್ಸವ नमस्ते Fest" → slug `fest`; the next non-Latin fest becomes `fest-2026`, then `fest-2026-x7k2`.
  Public links become meaningless and look alike. File: `slugify` in `src/lib/format.ts` / `createFest`. (Medium because Indian
  fests often use Kannada/Hindi names.)

### Low
- **L1. Long unbroken name overflows /me at 390px** (page scrolls sideways 428px) — `bug_me_long_name_overflow.png`.
  Add `overflow-wrap:anywhere` on the name heading (`src/app/(student)/me/page.tsx`).
- **L2. "Payment received, confirming with the fest…"** is shown as soon as a UTR is typed — nothing has been received yet
  (`bug_utr_payment_received_wording.png`, `src/app/(student)/tickets/page.tsx`). Suggest "UTR sent — waiting for the fest to confirm".
- **L3. UTR `000000000000` is accepted** as a real reference (`UTR_RE` in `src/lib/upi-parse.ts`). Reject all-same-digit UTRs.
- **L4. Fests can be created with dates in the past** (2020-01-01) — `FestSchema` has no "not before today" check.
- **L5. Used/garbage password-reset link still shows the "New password" form**; the error only appears after typing a new
  password (`src/app/(auth)/reset-password/page.tsx`). Check the token on page load.
- **L6. `/tickets?sent=<anything>` shows "Ticket sent to <anything>"** — the text is user-controllable from a link (escaped, so
  no script) and long Kannada names are cut mid-letter by `.slice(0, 60)` (`src/app/(student)/tickets/page.tsx:53`).
- **L7. Brand profile: budget `-5` says "up to ₹1 crore"** — wrong hint for a negative number (`src/app/sponsor/actions.ts`).
- **L8. Organizer Sales lists every order on one page** (Goal Rush, 70 orders → 6,800px tall at 390px). Add paging / "show more".
- **L9. One React hydration error (#418) seen once** on `/organizer/<goal-rush>/sales` at 1280px during the crawl; could not
  reproduce in 3 reruns. Likely a time/locale text difference between server and browser. Watch for it.

## What was covered (all passed unless listed above)
- **Crawl:** 7 roles (anon, student, organizer, volunteer, sponsor, brand, admin) × 390px and 1280px, 272 pages per width,
  every internal link followed: no 404/500 links, no horizontal overflow, no console errors except L9; CSV links download.
- **Student:** sign-up with Kannada/Hindi name and UPPERCASE email (stored lower-case), confirm-email link (works once, reuse
  says expired), duplicate email, demo checkout with qty 10 (cap), double-click Pay → one order, double-click confirm → 10 tickets
  and one email, 11th ticket refused, lunch add-on from ticket page (once only), API tampering (qty 0/2.5/'1e1', add-on without/other's
  ticket, review/ended fest, bad Origin), other users' ticket/order IDs → 404, demo-confirm of others' order → 404, bank-UPI with UTR,
  same UTR from a 2nd student, transfer (to self refused, to Kannada account, double-click → one transfer), forgot/reset (other sessions
  logged out, reset link single-use), logout + back button, `/t/` bad links 404, offline page.
- **Organizer:** create → submit → admin approve (double-click safe), ticket types incl. stay add-on, add-on needs perks, UPI on/off with
  bad VPA, schedule (outside dates blocked, past-midnight end stored right), announcement with `<script>` (shown as text,
  double-click → one post), volunteers (lunch duty, uppercase email), sponsors, paste bank SMS (match, duplicate "already seen",
  wrong amount flagged), Confirm/Reject, refund (short reason refused, double-click → one refund, student sees UPI refund note),
  CSV export, co-organizer add, cancel fest (lowercase "cancel" refused), other organizer's fest → 404, quota below sold refused,
  every tab at 390px.
- **Scanner:** app login doesn't unlock scanner; admit, duplicate, wrong fest, unknown code, lower-case code, code without dashes;
  lunch (once a day, "no lunch" on Day Pass), stay (check-in, "scan later to check out"); gate volunteer can't switch to lunch via API;
  fest not on team → 403; student not on any team refused; wrong password; Lock ends the session (API 401 after).
- **Sponsor/brand:** sign-up, profile limits (min>max, ₹1 crore cap, 5 cities), unverified email blocked, Find fests, media kit
  (closed fest 404, no personal data), request with `1e5` refused, double-click send → one request, organizer accept in two tabs →
  second tab "already answered", one sponsors row, sponsor dashboard, leads CSV, report, other brand's sponsor/report/CSV → 404,
  booth check-in (double-click → one visit), share needs 18+ tick, stop sharing, bogus booth 404.
- **Admin:** approve, payouts, orders search (Kannada, quotes, UTR), "Unlock a login" for unknown email, errors page, health,
  organizer → /admin blocked.

Server and `thefest_explore` database were stopped/dropped afterwards.

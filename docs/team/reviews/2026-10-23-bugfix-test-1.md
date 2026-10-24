# Bug-fix re-test — 2026-10-23 (test 1)

**Tester** · HEAD `47db3e3` (branch `full-app`) · local Postgres, `DEMO_PAYMENTS=1 next start` on :3000, fresh `db:seed --reset`
between runs · Playwright Chromium at **390px** and **1280px** · no app code changed.

**Result: FAILURES.** 13 of 15 items are fixed. **M4** has a review bypass and **L9** still happens. H1's open redirect is
fixed, but the same `?next=` code now has a crash (new, Low). L8 has a small display gap.

Release check: not re-run (Builder's run passed, 808 checks). New test `tests/bugfix_oct23_retest.py` is wired into
`tests/run-e2e.sh`: **0/7 pass today**, which is expected because each check reproduces one of the failures below.

Scripts: `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/` (`h1.py`, `h1b.py`, `m4.py`, `rest.py`, `reg.py`,
`l9*.py`, `sp2.py`). Screenshots: `…/scratchpad/bugfix-shots/`.

| Item | Verdict | Evidence |
|---|---|---|
| H1 open redirect | **FIXED** (+ new Low N1) | 38 payloads (`//`, `/\`, `%2F%2F`, `%5C`, `/%09/`, `/%0a/`, `////`, `javascript:`, `https:`, double/triple `%25` encoding, `/./\`, `/..//`, fullwidth `／`, zero-width space, `/@evil`) on `/login?next=` and `/signup?next=`, logged in (raw `Location` header and real browser navigation) and logged out (hidden field + submit, and a tampered hidden field POSTed to the login/signup actions), at 390 and 1280. **None leaves the site.** Normal `next=/me` still works. |
| M1 huge numbers | **FIXED** | New fest capacity 99999999999 / 2147483648 / 1e9 → "Capacity can be at most 10,00,000 people.", typed data kept, no crash; −5 → "whole number"; Settings 3,000,000,000 → limit message; admin payout ₹9,99,99,999 → "at most ₹2 crore", no row written. `m1_*.png` |
| M2 sponsor "already added" | **FIXED** | ₹3 crore → "at most ₹1 crore" (390+1280); exactly ₹1 crore accepted (Kannada brand); a real duplicate still says "already added"; negative refused. `m2_sponsor_*.png` |
| M3 Reject after Confirm | **FIXED** | Two tabs: Confirm, then Reject → calm note "already confirmed or rejected…", order stays paid. `m3_reject_after_confirm_390/1280.png`. (Reject, then Confirm in the other tab confirms the order. That is by design: `confirmManually` accepts `failed` orders.) |
| M4 fest changes after sales | **FAILS** (bypass) | Working: date warning "This emails 121 ticket holders what changed." + "I understand"; save without the tick is refused; End 23 Oct → "Lunch on Oct 24, 2026 is already sold (3-Day Pass)…", DB unchanged; venue (Kannada) / dates / name changes → **121 emails each in `email_outbox`**, one per holder, no duplicates on double-click, body "Name: Neon Utsav → Neon Utsav ನಮ್ಮ 2026" / "Dates: Oct 22–24 → Oct 22–25" / "Venue: … → …"; rename → `review`, `approved_at` null, note shown to organizer and admin; admin approve → live, note cleared; an existing ticket still shows its QR and **scans "✓ Admit"** while in review; a fest with no tickets sold → plain "Saved.", no email. **Bypass:** see F1. |
| M5 Kannada/Hindi slugs | **FIXED** | "ನಮ್ಮ ಉತ್ಸವ नमस्ते Fest" → `namma-utsava-namaste-fest`, the same name again → `…-2026`; "ಉತ್ಸವ" + Kannada college → `utsava-ar-vi-kaleju-bengaluru`; emoji-only and "Fest" also get readable, distinct slugs; never plain `fest`. |
| L1 long name /me | **FIXED** | 90-char unbroken name wraps; scrollWidth 390 / 1280. `l1_me_longname_*.png` |
| L2 UTR wording | **FIXED** | Shows "UTR sent — we'll confirm once the payment is seen in the fest's account." `l2_utr_wording_390.png` |
| L3 fake UTR | **FIXED** | 000000000000 and 111111111111 → "That isn't a real UTR…". `l3_fake_utr_390.png` |
| L4 past start date | **FIXED** | 2020-01-01 → "The start date can't be in the past." (390+1280) |
| L5 dead reset link | **FIXED** | garbage / 40×A / empty token / used link → error up front with no password form; a fresh link shows the form. `l5_*.png` |
| L6 `?sent=` | **FIXED** | Free text, 80×x and a random UUID → no banner. A real transfer to a long Kannada name shows the whole name, no broken letters, the URL holds only the ticket id, fits 390. `l6_*.png` |
| L7 budget hint | **FIXED** | −5 → "can't be negative"; ₹20 crore → "at most ₹1 crore"; "abc" → "Enter the budget in rupees". |
| L8 Sales paging | **FIXED** (minor gap F3) | Goal Rush 70 orders: 50 + 20 rows, "Older →"/"← Newer" links work, no sideways scroll; `page=abc/-3/1e9/2.7` are safe. |
| L9 hydration #418 | **FAILS** | See F2. Reproduced 11 times across ~420 loads, only on Sales. |

Regression sweep: **all pass.** Demo ticket purchase (Kalaa, 390) → paid, 1 ticket; scan → "✓ Admit", then "⚠ Already in";
organizer refund → order `refunded`; brand sends a sponsorship request (Kalaa) → organizer accepts → 1 sponsors row; sponsor
dashboard and Find fests load; new fest → Submit → admin Approve → live, public page 200.

## Failures

**F1 (M4, High for M4's intent) — Unpublish → rename → Publish skips admin review.**
- Did: Neon Utsav (live, approved, 121 holders) → Settings → **Unpublish** (→ draft) → rename to "Totally Different Fest" (tick, Save:
  "121 ticket holder(s) are being emailed") → **Publish**.
- Expected: back to `review` (the rule: "renaming a live fest sends it back to admin review").
- Actual: `live|Totally Different Fest`. The overview shows "LIVE NOW" and tickets are on sale. `m4_bypass_390.png`.
- Cause: `updateFest` only sets review when `cur.status === 'live'`. `setFestStatus` goes straight to live when `approved_at` is
  set. The same gap exists from `ended` → Reopen. Likely files: `src/app/organizer/actions.ts` `updateFest` (~line 101: clear
  `approved_at` on a rename with holders, whatever the status) and `setFestStatus` (~line 192).
- Side note: after a rename, Withdraw → draft keeps the rename note, and the overview then says "THE FEST sent it back: Renamed
  from…", which is misleading. Also, while a renamed fest is in review, its public page `/fests/<slug>` is **404** for ticket
  holders (no schedule or announcements). Harshith may want that page kept visible with sales paused. `m4_public_review_390.png`.

**F2 (L9) — Sales page still throws React hydration error #418 now and then.**
- Did: loaded `/organizer/<goal-rush>/sales` (and `?page=2`, and the Older/Newer links) repeatedly at 390/1280, browser timezone IST and
  America/Los_Angeles.
- Expected: no page errors. Actual: `Minified React error #418 (args HTML)` in about 3–7% of loads (4 of 60, 2 of 60, 5 of 180,
  2 of 120). **0 errors in 60 loads each** of Tickets, Settings and the organizer home. It happens in IST too, so the IST-time
  change was not the cause. The Builder's L9 check uses only 12 loads, so it usually passes by luck.
- Likely file: `src/app/organizer/[festId]/sales/page.tsx` (a client component on this page that renders differently on the
  server: the `<details>` refund form, `ActionForm`/`Submit`, or the `Link` pager). Needs a dev build to read the full message.

**F3 (L8, Low) — page number past the end.** `?page=99999` → empty "No sales yet" and "Orders 49,951–70 of 70 · page 1000
of 2" with "← Newer". Clamp `page` to `pages`. `l8_page_out_of_range_390.png`, same file as above.

**N1 (new, Low; came with the H1 code) — a non-ASCII `?next=` crashes.** `safeNext` accepts paths like `/fests/ನ`, `/​/x`
(zero-width space) or `/／/x`, and `redirect()` then throws `TypeError: Invalid character in header content ["location"]`.
Logged in, `GET /login?next=/fests/%E0%B2%A8` → **500**. Logged out, logging in with that link → "Something went wrong" page.
It is not an open redirect, but anyone can send a link that breaks login. Fix: re-encode the path (`encodeURI`) or
reject non-ASCII in `safeNext` (`src/lib/format.ts`). `h1_500_*.png`.

## Screenshots reviewed (390 and 1280)
`m4_lunch_block_390` (error at top of form, notice + tick above Save; nothing cut off), `m4_bypass_390`, `m4_admin_queue_1280`
(rename note in orange, Kannada renders), `m3_reject_after_confirm_390` (note at the top, readable), `m1_capacity_390` (error at top,
data kept), `l1_me_longname_390` (wraps inside the column), `l6_transfer_kannada_390` (whole Kannada name; mono font falls back
fine), `l8_sales_p1_1280` (50 rows + pager), `l8_page_out_of_range_390`. No overlapping text, no cut-off labels, no horizontal
scroll on any checked page.

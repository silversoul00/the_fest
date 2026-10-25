# Sponsorship requests (v2.6) — Supervisor review 2
Date: 2026-10-18 · Fix commit c796c75 (diff b7e96a1..c796c75) · Against review 1 and test 1

## Verdict: PASS
Every item from review 1 and test 1 is fixed, and each fix has a test. The fix diff adds no new access-control or
money problems. Two low items are left for later.

## Review 1 / test 1 items
- **Must-fix 1 (unapproved fests could pitch brands): FIXED.**
  - `sendBrandRequest` now requires `user.verified` and the fest to pass `visibleToBrands()` (actions.ts:332-335).
  - `festOpen()` is now `status = 'live'` and the fest has not ended (sponsor-requests.ts:64). That covers accept from
    both sides, the badge and the sort order.
  - `decideRequest` now requires a confirmed email on both sides (sponsor-requests.ts:126).
  - Tests: draft and review fests are refused, a tampered form is refused, an unverified organizer gets no form or
    buttons and a posted accept is refused, and accept fails after a fest goes back to draft.
- **Builder's choice: pitching needs the fest live AND "Show this fest to brands" on. OK.** It matches Harshith's rule
  that brands only see fests the organizer has opened. A pitched brand can always open the fest's media kit.
  The organizer sees a plain reason (`SEND_NEEDS_LIVE`) and no "Send request" buttons.
- **Should-fix 2 (old tier and amount kept): FIXED.** Accept now updates brand, tier and amount on the existing row
  (sponsor-requests.ts:155-160).
- **Should-fix 3 (re-use matched only the exact brand name): FIXED.** Re-use now matches on `(fest_id, email)`. An
  exact brand name wins, then the oldest row. The row is locked with `for update`.
- **Minor 7 (REQUESTS_MISSING wording): FIXED.** Minors 4–6 were left as they were, which review 1 allowed.
- **Test F1 (an existing sponsor could still be pitched): FIXED.** `alreadySponsor` is checked inside the locked
  create transaction. The media kit and Find brands show "Already a sponsor of this fest" instead of a form.
- **Test F2:** the nav now wraps. **F3:** the empty-state wording is fixed. **F4:** open requests now sort first.

## Regression checks on the accept path
- **Leads and booth codes untouched.** The update sets only `brand, tier, amount_paise`. `booth_code`, `lead_offer`,
  leads and visits stay as they were. The test confirms the booth QR is kept.
- **No row the brand doesn't own.** The match uses the brand's own account email (citext, confirmed). A sponsors row
  with that email already appears on that brand's dashboard (`/sponsor` filters by email). The row is also on the fest
  the request belongs to, and the accepting side has already passed `canManage` or `brand_user_id`. Renaming the row
  to the profile's brand name gives the brand no new access.
- **Duplicate rows.** An exact-name match is chosen first. So renaming the chosen row cannot hit
  `unique(fest_id,email,brand)`: if another row had the profile's name, that row would have been chosen. The other
  rows are left alone, which is correct.
- **Confirmed-email rule.** Send and decide are both enforced on the server. `locked` only hides buttons. Side
  effect: an unconfirmed co-organizer can no longer withdraw. Acceptable.

## Findings (all LOW, not blocking)
1. **LOW: accepting an older open request silently overwrites a deal the organizer typed in later.**
   (sponsor-requests.ts:155-158.) `alreadySponsor` blocks new requests only. Example: a brand's Partner ₹10,000
   request is still open, and the organizer then types the same email in as Title ₹5,00,000. Accepting turns that row
   into Partner ₹10,000. The emails and the row now agree, and the person clicking Accept chose to accept, but nothing
   warns them. Suggested fix, either one:
   - on the card, show "Already a sponsor at <tier ₹>. Accepting replaces it."
   - when `addSponsor` adds that email, close any open requests for that fest and email.
2. **LOW, plausible: race with `addSponsor`.** If the organizer adds the same email and brand name while an accept is
   running, the insert branch can hit 23505 inside `sql.begin`. The user then gets a generic error instead of "already
   a sponsor". Rare. Catch 23505 and retry the select-and-update.

## Test plan for the Tester
1. `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh` must be fully green (sponsor_requests.py 95/95).
2. Re-run the F1 flow from test 1:
   - Neon / Volt: the media kit and Find brands both show "Already a sponsor of this fest" and offer no form.
   - Replaying the old POST is refused, and no row is created.
3. Organizer on a draft fest, a review fest, and a live fest with "Show to brands" off:
   - no Send buttons and the plain reason is shown;
   - the replayed POST is refused, and email_outbox has no new rows.
4. Existing-row accept, using finding 1 as the example:
   - one sponsors row, with the booth_code unchanged and any leads still attached;
   - the row's tier and amount match the email and the ROI report.
5. At 390px: the sponsor nav wraps and "Brand profile" is visible on every sponsor page. Open requests are listed
   first on both sides.
6. Unverified brand and unverified organizer: the cards show no Accept, Decline or Withdraw buttons, and a confirm-email
   notice with a resend link is shown.

## Questions for Harshith
None.

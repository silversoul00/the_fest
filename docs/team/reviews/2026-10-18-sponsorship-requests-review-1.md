# Sponsorship requests (v2.6) — Supervisor review 1
Date: 2026-10-18 · Commit b7e96a1 (range b7e96a1^..b7e96a1) · Plan: docs/team/research/2026-10-18-sponsorship-requests.md

## Verdict: CHANGES NEEDED
The build is close. Authorization on accept, decline and withdraw is sound. Accept is atomic. Contacts stay hidden
until a request is accepted. The schema change only adds things and is safe to re-run. One must-fix remains: any new
organizer account can pitch brands from a fest THE FEST has never approved. That opens the door to spam, phishing and
harvesting brands' emails.

## Plan followed
All six build-plan items are done: schema, lib, brand pages, organizer sections, emails, and tests plus the run-e2e
line. Small extras: a `SponsorShell` header was pulled out of `/sponsor/page.tsx`, and a tab badge was added to OrgShell.
Both are harmless. No planned step was skipped. Deviations are judged below.

## Brief check
- Two-way requests (org → brand and brand → org): OK.
- Fests hidden from brands until "Show this fest to brands" is switched on: OK for browsing and the media kit
  (`visibleToBrands`, sponsor-requests.ts:370; media kit page.tsx:216-219). VIOLATED in spirit when the organizer sends
  the request (see 1): a brand can be pitched by a fest it can't look at.
- Contacts hidden until accept: OK. `VIEW_COLS` returns `contact` only when the status is `accepted`
  (sponsor-requests.ts:475). Emails sent before accept carry no addresses (mail.ts:243-253).
- Money settled off-platform: OK. The note appears on the Accept card and in the accepted emails.
- v2.6 goes to both Supabase databases only after tests pass. Nothing is applied in this commit. OK.
- No push to main, no account changes: OK.

## Findings (most severe first)

### Must-fix
1. **HIGH: an organizer can pitch brands, and accept, from an unapproved draft or review fest.**
   - Code: `sendBrandRequest` only rules out cancelled and ended fests (organizer/actions.ts:95). `festOpen()`, which
     accept uses, also lets draft and review fests through (sponsor-requests.ts:367). `createFest` makes a draft
     straight away for any organizer signup, verified or not (actions.ts:63-87), and `canManage` lets an unverified
     owner manage their own fests.
   - Real-user harm: someone signs up as an organizer, makes any number of draft fests, and sends each listed brand up
     to 20 requests a day per fest. THE FEST then emails the brand "<any fest name> invites <brand> to sponsor", with
     text the attacker chose, sent from our address. If the brand accepts, the attacker gets the brand's email, and a
     `sponsors` row is created on a fest no admin ever approved. The per-fest cap doesn't help because fests cost
     nothing to create.
   - Fix: in `sendBrandRequest`, require `f.status = 'live'`. Better still, use `visibleToBrands()`, so the brand can
     open the media kit of the fest pitching it. In `festOpen()`, use `f.status = 'live'` instead of
     `not in ('cancelled','ended')`. Add `if (!user.verified) return { error: 'Confirm your email first.' }` to
     `sendBrandRequest` and to the org accept path, to match the brand-side rule (plan criterion 1).
   - Tests to add: sending from `sr-draft` and from a review fest is refused, and an unverified organizer is refused.
   - This also settles three builder deviations: "unverified owner can send/accept", "can pitch from a fest not open to
     brands", and most of "no per-brand inbound cap".

### Should-fix (not blocking)
2. **MEDIUM: when accept re-uses an existing sponsor row, the old tier and amount stay** (sponsor-requests.ts:448-451,
   `do update set brand = excluded.brand`). The accepted email says, for example, "now a Title sponsor of X
   (₹2,00,000)". But the organizer's sponsors list and ROI report still show the tier and amount typed in earlier.
   Fix: `do update set tier = excluded.tier, amount_paise = excluded.amount_paise`, because the accepted request is the
   newer agreement. Also extend the check at test line 227 to compare tier and amount.
3. **LOW: re-use only matches an exact brand name.** If the organizer added "Volt" with sponsor@ and the brand's
   profile says "Volt Energy", accepting creates a second sponsors row for the same email: two cards and two booth
   QRs. The plan accepted matching on `(fest_id,email,brand)`. Consider matching on `(fest_id,email)` when exactly one
   row exists.
4. **LOW: the brand only gets the owner's email after accept**, even when a co-organizer accepted (mail.ts:267,
   VIEW_COLS:476). Fine for v1, since the owner is accountable. With fix 1, the owner is also verified.
5. **LOW: no success message after accept or decline.** The card re-renders without the form, so the ActionForm
   message disappears. The chip change (Accepted with the contact shown, or Declined) is clear enough. Acceptable.
6. **LOW: no limit on how many requests a single brand receives per day.** With fix 1, only admin-approved live fests
   can pitch (20 per fest per day), so the risk is small. Revisit when the number of live fests grows.
7. **LOW, plain language:** `REQUESTS_MISSING` shows "needs the v2.6 database update in db/schema.sql" to
   organizers and brands. It copies the existing LEADS_MISSING pattern, but a student committee member won't
   understand it. Something like "Sponsorship requests aren't switched on yet. Please try again later." would read
   better.

### Checked and OK
- **Forged forms:** `orgDecide` and `decideRequest` re-check `canManage` on the request's own fest, not the posted
  `festId`. The brand side checks `brand_user_id = user.id`. Accept, decline and withdraw are each limited to the
  correct side (sponsor-requests.ts:419-427). Tests replay the action as a student, gate staff, another fest's
  organizer, a logged-out user and the sender.
- **Atomic accept:** the `status='sent'` guard on the update and the sponsors insert run in one transaction. A second
  tab gets "already answered". Racing with a decline is also safe.
- **Rate limits under concurrency:** each sender takes an advisory lock and counts inside the transaction. Opposite
  directions racing on the same pair are caught by the partial unique index (23505, which shows a clear message).
- **Money:** `toPaise` is exact, regex-only with no floats, and capped at ₹1 crore, with a DB check as well.
- **Media kit:** shows totals only. Colleges under 5 attendees are folded into "Other". Hidden fests return 404 for
  brands, students and other organizers. The "Last fest" line shows the organizer's earlier fest even if that fest
  was never opened to brands. The plan intended this; it is a name plus one count.
- **Schema:** only additions, `if not exists` everywhere, RLS switched on like the other tables. The demo seed still
  refuses to run on a database that already has fests.
- **Regressions:** the sponsor home now uses SponsorShell, and an old database shows "not set up yet" (test 13). The
  sponsors table and leads are untouched apart from the insert on accept.

## Test plan for the Tester
1. Automated suite: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh`. Everything must pass.
2. After fix 1: from a draft fest and from a review fest, POST `sendBrandRequest` (both by replaying the form and by
   opening `?to=<brand>`). Expect a refusal, no row and no email_outbox entry. Repeat with an unverified organizer on
   a live fest.
3. After fix 1: a request sitting on a fest that is put back to draft can't be accepted by either side.
4. After fix 2: the organizer adds "Volt Energy" / sponsor@ at Associate ₹10,000, then the brand's Title ₹2,00,000
   request is accepted. Expect one sponsors row showing Title ₹2,00,000, and the report showing the same.
5. Manual at 390px: Requests page, Decline… details, Find brands filter, and the organizer Sponsors tab (badge in the
   chip row). Check for sideways scroll and that tap targets are at least 44px.
6. Manual: read each email_outbox body (new, declined, accepted, both directions). Before accept, no address should
   appear. The accepted email should link to `/sponsor/<id>` and the Sponsors tab.
7. Two tabs: decline in tab A and accept in tab B at the same time. Expect one final status and no sponsors row if the
   decline wins.

## Questions for Harshith
None blocking. Fix 1 follows his rule that brands only see fests the organizer has opened.

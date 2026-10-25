# Fest events part A — test 1 (manual real-browser pass)
Date: 2026-10-25 · Tester · HEAD 79dfe55 · isolated DB `thefest_ev` (schema.sql + demo-seed.sql) on :3100, DEMO_PAYMENTS=1.
run-e2e.sh was NOT run here (the coordinator was running it on :3000 / `thefest`).

## Result: FAILURES (2 functional, 7 minor)

Release check numbers: not run by me (coordinator's run on :3000).
Manual pass: ~95 scripted browser checks across organizer, student, co-organizer, Finance, Event head, Judge and scanner. 2 real failures, rest pass.
Scripts are in the session scratchpad (qa1_org.py … qa5.py). They are not added to tests/ because this was a manual pass.

## Failures

### F1. Sales "Tickets" total counts paid event entries (Medium)
- Did: organizer@ → Neon Utsav → Sales, after 4 paid event entries existed (Stand-up ×2, Battle of Bands, QA Paid Relay).
- Expected: Tickets = 139 (same as Overview, Analytics and `tickets` rows).
- Got: **Tickets 143**. The by-type table includes every `Event: …` row, and `totals.qty` sums all rows.
- Screenshot: events-shots/32-sales-1280.png (compare 30-analytics-1280.png and 31-overview-1280.png, both 139).
- Likely file: `src/app/organizer/[festId]/sales/page.tsx` lines 24–28 and 50 (`totals` should skip `kind in ('event','addon')` for qty). "Collected" correctly includes the entry money.

### F2. Bank UPI: after sending the UTR, My events says "your entry is confirmed" while it's still pending (Medium)
- Did: qa2@ registers QA Solo Paid Poetry → My events → "Pay ₹205 by UPI" → enters a 12-digit UTR → "I've paid".
- Expected: a "UTR received — we'll confirm once the fest sees the payment" message.
- Got: redirect to `/my-events?paid=1` with the green banner **"Payment received — your entry is confirmed."** But the same card's badge says **Payment pending**.
- Screenshot: events-shots/23-my-events-after-utr-1280.png
- Likely file: `src/app/(student)/fests/[slug]/BuyTickets.tsx:63` (`done()` always pushes `?paid=1` for a registration) and the banner in `src/app/(student)/my-events/page.tsx`.

### F3. Event entries are worded as "tickets" in the payment and order screens (Low, confusing)
- On the UPI pay screen: "Paying a different amount delays your **ticket**" and "I've paid — confirm my **ticket**".
- On the method picker: "**ticket** confirmed in a few minutes" and "Instant **ticket**".
- My tickets (pending order card): "Neon Utsav · **1 ticket** · ₹205.01".
- `/orders/[id]` (pending UPI event order): "Your **ticket** appears as soon as the fest confirms the payment".
- Sales refund form for an entry: "**Tickets** to cancel (of 1 unused)".
- Screenshots: 22-upi-pay-1280.png, 24-tickets-qa2-1280.png, 25-order-upi-event-1280.png
- Files: `BuyTickets.tsx` (lines ~171, 240, 253), `src/app/(student)/tickets/page.tsx`, `src/app/(student)/orders/[id]/page.tsx`, `src/app/organizer/[festId]/sales/page.tsx:116`.

### F4. Success messages disappear when the action removes its own form (Low UX)
- Affected actions: Accept invite, Cancel invite, Submit team, Leave team, the invite that fills the team, and Finance "Cancel & refund" on Sales.
- In each case, `FormMessage` lives inside the `ActionForm`. The re-render removes the form, so the user sees no confirmation; only the badge or row changes.
- This matters most for a UPI refund, where the "Send ₹X back by UPI" instruction is lost. The "UPI refunds to send" list still shows it.
- Files: `src/components/forms.tsx` (ActionForm), `src/app/(student)/my-events/page.tsx`, `sales/page.tsx`.

### F5. The captain sees an invitee's real account name before they accept (Low, privacy)
- The captain typed `qa3@seed.thefest.in`. The team list immediately shows "राहुल वर्मा · invited", the name on that account.
- Anyone can find out the name behind any email by inviting it.
- Screenshot: 13-my-events-captain-1280.png
- Files: `src/lib/events.ts:153–154` (user_id set at invite time) and the member query in `my-events/page.tsx` (show the email until joined).

### F6. Event CSV repeats the team's payment on every member row (Low)
- QA Paid Relay CSV: `paid_inr` = 312.38 on all 3 rows, including the outstanding invitee (`member_status=invited`).
- Summing the column gives ₹937 for one ₹312 payment.
- File: `src/app/organizer/[festId]/events/[eventId]/export/route.ts`.

### F7. "Remove entry" is offered on paid confirmed entries but always refused (Low)
- The organizer event page shows "Remove entry" under Relay Riders (paid). The server answers "refund it from Sales".
- Screenshot: 62-org-event-page-390.png
- File: `src/app/organizer/[festId]/events/[eventId]/page.tsx` (hide it when `r.paid !== null`).

### F8. Scanner wording (cosmetic)
- A solo entry repeats the event name: "QA Quiz Renamed · Already marked at 1:59 pm — QA Quiz Renamed" (40-event-scanner-1280.png).
- A member of a forming team gets the headline "✕ Not in this event" over "Entry not confirmed" (52-eventhead-scanner-390.png).
- Files: `src/lib/events.ts:321–323`, `src/app/scan/Scanner.tsx` (event labels).

### F9. The Add-event form defaults Date to the fest's first day, even when that day has passed (cosmetic)
- Example: 24 Oct while today is 25 Oct (03-org-events-tab-390.png).

## Passed (highlights)
- **Organizer:** added 9 events covering all 7 categories, solo/team, free/paid, needs-ticket, one-college, past deadline, and a Kannada/Hindi long title.
- **Validation:** title, team size, slots 0/5001, fee 0/−5/₹20,000, date outside fest, deadline after start.
- **Edit:** rename and venue saved. Slots below taken refused. Fee and team fieldsets lock after the first entry.
- **Hide:** removes the event from the fest page, and the public page returns 404. Hidden badge shown.
- **Delete:** works on an empty event and is refused with entries.
- **Fest page cards:** correct fee text ("₹300 + ₹5 fee per team · fest ticket needed", "₹200 + ₹5 fee", "Free · fest ticket needed"), slots left, Full, Closed.
- **Logged out:** "Log in to register". Organizer account: "student account" message.
- **Solo free:** confirmed at once. A second visit shows "You're in". Double-click makes one entry.
- **One-slot event:** two students clicking at once → exactly 1 confirmed; the other sees Full.
- **Withdraw:** a free confirmed entry frees its slot.
- **Fest ticket rule:** refused when registering or accepting without a fest ticket.
- **One-college rule:** a different college and a blank college are refused with clear messages. Lower-case same college is accepted.
- **Team limits:** the invite box hides at max. Submit / Pay & submit are disabled below min with "(need N more)". Leave and captain remove are blocked below min on confirmed teams. Normal leave works.
- **Paid solo (demo card):** total ₹209.96 = 200 + 5 + 4.96 gateway. `platform_fee_paise`=500. Slot held during checkout. Confirmed with 0 ticket rows.
- **Paid solo (bank UPI):** ₹205.01 (paise tag), gateway fee 0.
- **Paid team:** a member trying to pay gets 409 "Only the team captain". Double-clicking the demo pay makes 1 order of ₹312.38 (300 + 5 + 7.38), confirmed.
- **Refunds:** Finance lead refunds the full ₹209.96, the entry goes to Refunded, the slot is freed, the student sees Refunded and can register again. The co-organizer has no refund control.
- **Analytics and Overview:** 139 tickets. Revenue includes entries. No event rows in Ticket types.
- **Event head:** sees only Battle of Bands. No ₹, fee/slots fields, hide or delete. Another event's page goes to no-access, and its export returns 404. Own CSV works. No access to Sales or Analytics.
- **Event head scanner:** picker shows only their event, and a URL with another event falls back to it. An API scan of another event returns 403.
- **Judge (media@):** roster without emails, no CSV (404), no edit, no Mark present.
- **Event counter (owner):** Present ✓ → Already marked at … ; "Not registered for X — registered for QA Paid Relay"; void ticket refused.
- **Manual "Mark present"** works.
- **Activity log:** shows add, edit, hide, delete and mark-present with the actor.
- **390px:** no horizontal scroll and no button under 44px on the Events tab, event form, fest cards, event detail, My events (captain, member, invitee), organizer/event-head/judge event pages, and the Event counter. 1280px: no layout breaks.

## Screenshots reviewed (events-shots/)
- **01–03 Events tab** (1280/390): category grouping, long Kannada/Hindi and 80-char titles wrap, taken/slots badges.
- **10 fest cards (390/1280), 11 event detail, 12 Full, 65 detail (student):** fee text, badges, wrapping.
- **13–16 My events** (captain forming, confirmed team, member, invitee with blank college): labels, buttons.
- **20–25 payment:** pay box, paid note, UPI screen (F3), after-UTR banner (F2), My tickets and order page (F3).
- **30 analytics, 31 overview, 32 sales (F1), 33/62 organizer event page, 34 sales after refund.**
- **40/41 Event counter** (1280/390): verdicts, counts. The fixed header overlapping in the 1280 full-page shot is a screenshot artefact.
- **50–53 and 63–64 Event head / Judge** pages and scanner.
- **60/61/66 My events at 390:** the fixed bottom nav in the middle of the full-page shot is the usual screenshot artefact.

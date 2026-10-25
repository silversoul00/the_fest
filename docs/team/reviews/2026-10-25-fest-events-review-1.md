# Fest events part A (v2.8) — Supervisor review 1
Commit `79dfe55` (diff `79dfe55^..79dfe55`) · 2026-10-25 · Plan: `docs/team/research/2026-10-25-fest-events.md`

## Verdict: CHANGES NEEDED (one must-fix, on money and slots)

## Brief check
- Categories fixed 7, solo/team min–max, fee, slots, deadline, mixed colleges, event heads/judges linked to an event: OK.
- ₹5 per paid event registration (`pricing.ts:654`, `eventFeeConfig` flat, payer student): OK.
- Captain pays once per team, one order per team (`orders.ts:69-90`, unique `orders_registration_open`): OK.
- Organizer picks needs-ticket per event; leave before deadline; captain removes; full = "Full", no waitlist: OK.
- Same QR on a new Event counter, online only, QR size unchanged (`scan/keys/route.ts:35`): OK.
- Refunds = owner + Finance only (`refundOrderAction` → `requirePerm('refund')`; co-org/event_head/judge lack it): OK.
- Never merge to main / push only tested batches: OK (branch is 2 ahead of origin, nothing pushed).
- Apply v2.8 to both databases after tests pass: not done yet. Correct, since tests are still running.
- Plan followed: yes, with no extra features. Builder deviations:
  - (a) Fee and team size locked after the first entry: OK, sensible.
  - (b) No ₹ shown to event heads/judges: OK on screen, but the CSV still shows ₹ (finding 3).
  - (c) Team frozen while a payment runs: OK in principle, but only safe after finding 1 is fixed.
  - (d) Error message lost on forms that remove themselves: acceptable for v1.

## Must-fix
1. **HIGH: an abandoned payment never frees its slot, and the team gets stuck. Acceptance criterion 7 fails.**
   - **When it happens:** a gateway checkout left without the cancel call (Cashfree redirect abandoned, tab closed, phone died), or a bank-UPI order with no UTR. The order stays `pending` for good. Expired holds are only released inside `createOrder` (`orders.ts:45`), and nothing on the event side can reach it:
     - My events hides "Pay & submit" and "Withdraw entry" whenever any `pending` order exists (`my-events/page.tsx` `!e.pending`, and the condition for showing Withdraw). It shows "wait a few minutes", forever.
     - `dropMember` and `withdrawEntry` refuse on any `pending` order with no age check (`events.ts:340`, `events.ts:408`). So members can't leave, the captain can't remove anyone, and the captain can't withdraw.
     - `registerEntry` returns "This event is full." from the raw `sold` count (`events.ts:245`) before any hold is released. `submitEntry` does the same (`events.ts:387`). If the stuck hold is on the last slot, the event shows **Full** permanently and nobody new can start the checkout that would free it.
   - **Fix:**
     - Export `releaseExpiredHolds` and call it right after `lockEvent` in `registerEntry`, `submitEntry`, `withdrawEntry`, `leaveTeam` and `removeMember`.
     - In `openOrder` and in the My events `pending` flag, count only orders that are still inside the hold. Use the same rule as `releaseExpiredHolds`: 15 minutes for gateway; 30 minutes for UPI with no UTR; UPI with a UTR stays pending.
     - Then the Pay button comes back, and `createOrder` releases the old hold. A late payment on the old order already goes to the refund list (`orders.ts:208-211`). Good.
     - Add a test: start a paid checkout, backdate `created_at` by 20 minutes, then (a) a member can leave, (b) a new team can register on a 1-slot event, (c) the captain can pay again.

## Should-fix
2. **MEDIUM (plausible, not reproduced): deadlock between a late webhook and a new checkout.**
   - `fulfilOrder` now always locks the order row, then the shadow ticket type (`orders.ts:167`, then `:206`).
   - `createOrder` locks the ticket type, then `releaseExpiredHolds` updates the same expired pending order (`orders.ts:37` → `:150`).
   - Postgres cancels one of the two. If it cancels the webhook, it errors and relies on the gateway retrying it.
   - Fix: in `releaseExpiredHolds`, use `where id in (select id … for update skip locked)`.
3. **LOW: the CSV still shows ₹ to event heads.** The export route gives event heads `paid_inr` (`export/route.ts:21`), while the screens hide ₹ from them. Drop the column unless `access.perms.has('money')`.
4. **LOW: wrong wording for event orders.** The pending bank-UPI card on My tickets says "· 1 ticket ·" for an event entry (`tickets/page.tsx:75`). Say "event entry" instead.
5. **LOW: Event counter ignores the scan switch per event.**
   - `counterEvents` matches event-head roles by email only (`events.ts:473`). It doesn't check `can_scan` or the email-confirmed rule on that row.
   - Example: someone who is event head of A (scanning off) and of B (scanning on) can mark A.
   - Fix: reuse `activeRole(...)` and add `r.can_scan`.
6. **LOW (plausible): `events.ticket_type_id ... on delete restrict` (`schema.sql:557`) may block deleting a fest that has events but no orders.** Only test or admin SQL deletes fests. Worth checking once.

## Confirmed correct (money)
- Amount = event fee + ₹5 + gateway gross-up (gateway checkout only). The UPI paise tag still applies. `platform_fee_paise` = 500 (`orders.ts:114`). There is no ₹5 on a free entry (`perTicketFee` returns 0 when the price is 0).
- Double callback or webhook: the second call returns `already` (`:170`). A second order or a late payment on a confirmed or withdrawn entry goes to `needsRefund` (`:208-211`). Payment after the hold expired re-reserves a slot, or goes to the refund list if the event is full (`:214-218`).
- Refund: refunded as one unit (k=1, full amount, fees reversed). The slot is freed, the entry becomes `refunded` and its members become `left` (`refunds.ts:25-56`). A second refund is refused. Fest cancellation refunds paid entries (they are in the paid-order loop), and pending orders are marked failed.
- Ticket orders, add-ons, the 10-ticket cap and fest capacity are unchanged for tickets. Entries are left out of ticket counts and quota (`analytics.ts`, `queries.ts`, Sales). Gross, net and fees still include them, so payout and commission totals include the money.
- Access:
  - `requireEventPerm` checks that the event belongs to the fest, then whether the caller is the event's head (manage) or judge (view).
  - The export route and the event page check the same way. Judges get no emails and no export.
  - Student actions re-check the captain, invitee email or membership in `events.ts`.
  - Checkout with someone else's `registrationId` is refused ("Only the team captain…").
- Races: the shadow ticket type is locked first, then the entry. A unique index enforces one team per student per event. Team size is counted under the entry lock. Event scans are an atomic `checked_in_at is null` update.
- Schema: additive, guarded with `if not exists` / DO blocks, and RLS is enabled.

## Tester plan
1. Run finding 1's scenario on demo and on UPI (no UTR): an abandoned payment older than the hold, on a 1-slot paid team event. Expect: the event no longer shows "Full", a new team can register, a member can leave, and the captain can pay again. Then the old order's late webhook → refund list.
2. Paid team, Razorpay or demo: the total equals price + ₹5 + gateway. Fire callback + webhook in parallel → confirmed once, 0 tickets, `platform_fee_paise` = 500. Bank UPI: amount has the paise tag, and auto-matching confirms the entry.
3. Owner refunds an entry (gateway and UPI), and a Finance lead does too: full amount back, slot freed, members can join another team. A co-organizer, event head or judge posting `refundOrderAction` is refused.
4. Cancel a fest that has paid entries plus a pending entry order: entries are refunded and the pending order is marked failed.
5. A student with 10 tickets can still pay for an entry. Analytics ticket counts and quota don't change, while gross and fees go up.
6. Event head A forges the eventId of event B (edit, remove entry, mark present, export, scan with B's eventId) → refused. A judge can't export and sees no emails. A forged checkout `registrationId` from another user is refused.
7. Run 10 parallel registrations on 1 slot, 6 parallel accepts on a team of max 3, and one student accepting two teams at once.
8. Event counter: present → rescan says already marked → not registered (lists their events) → void ticket → ticket from another fest. At 390px, check every new screen: no horizontal scroll, buttons ≥ 44px.

## Questions for Harshith
None.

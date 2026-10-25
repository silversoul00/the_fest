# Fest events — Supervisor review 2 (commit 63ed4ce, diff 79dfe55..63ed4ce)

## Verdict: PASS (one low should-fix, can go in the next batch)

## Brief check
- Paid event = fee + ₹5, captain pays once, no waitlist, "Full" when full: OK, unchanged by this commit.
- Ticket checkout rules (15 min gateway hold, 30 min bank UPI with no UTR, UPI with a UTR never auto-released, late payment → refund list): OK. The rule moved to `src/lib/holds.ts` and is the same SQL as before (`holds.ts:16-19` vs. old `orders.ts:150-157`).
- No push to `main`, no changes to Harshith's accounts: OK (code and tests only).

## Round-1 items
1. **#1 abandoned holds: FIXED.**
   - `lockEvent` now releases expired holds under the slot lock and writes `sold` back (`events.ts:40`, `holds.ts:43-47`). It is the first lock of every entry write, so register, submit, leave, remove and withdraw all see freed slots.
   - `openOrder` (`events.ts:61`) and the My events / organizer `pending` flags count only `paid` or live holds (`holdLive`). A UPI order with a UTR stays live forever, as intended.
   - Display counts use `takenLive` (read-only): fest page, event page, My events, organizer events.
   - Test: `events_fix1.py:97-102` covers backdate → pay again → old order's late payment goes to the refund list.
2. **#2 deadlock: FIXED.** `releaseExpiredHolds` updates `where id in (select … for update skip locked) and status = 'pending'` (`holds.ts:35-39`).
   - If a webhook holds the order lock, the order is skipped, so its seat stays counted.
   - `fulfilOrder` then sees `pending` (not `failed`) and marks it paid without re-reserving (`orders.ts:198-203`).
   - Seat count stays right on both paths. In the event path, `createOrder`'s raw-pending check (`orders.ts:83`) correctly says "payment already in progress" for a skipped order.
   - Tests: `events_fix1.py:172-209` (timing plus 5 parallel rounds, nothing logged in `app_errors`).
3. **#3 CSV ₹ for event heads:** diff touches `export/route.ts`. Builder's test run covers it. Not re-read in depth.
- **F1 Sales Tickets total: FIXED.** `totals.qty` skips the `addon` and `event` kinds. Collected and payout still include all money (`sales/page.tsx:52`). The label says "event entries and add-ons not counted".
- **F2 UTR banner: FIXED.**
  - `UpiPay` passes the server's `status` (`upi.ts:120-135`: `confirmed`/`waiting`). For a registration, `done()` goes to `?utr=1` unless confirmed (`BuyTickets.tsx:65`).
  - The card shows "UTR sent — we'll confirm…" while `utr_sent`.
- **Banner abuse: NONE.** `?paid` and `?utr` only switch fixed strings on and off (`my-events/page.tsx:56-57`). No query value is ever shown. `FlashMessage` only shows the server action's own `message`, as React text (escaped). It is client-only state and renders null on the server.

## Findings
1. **LOW (plausible, from the code path): a late payment can confirm a team that dropped below its minimum.**
   - Before this fix, nobody could leave while a payment was pending. Now, after the 15/30-minute hold, a member can leave or the captain can remove one. The expired order becomes `failed`.
   - If the gateway payment then lands, `fulfilOrder` re-reserves the slot and confirms the entry (`orders.ts:188-203`). It never re-checks `team_min` or `checkEntryMembers`.
   - Result: a 2-of-3-minimum team is "confirmed" and paid.
   - Fix: in the `registration_id` branch, if joined < team_min or `checkEntryMembers` fails, `return needsRefund('Team changed after the payment window — refund needed')`.
   - The money isn't lost either way, so this can go in the next batch.
2. **INFO:** `createOrder`'s `undo()` / `if (released) update sold` before a throw is redundant, because the throw rolls back the transaction. This was already there and is harmless.

## Test plan for the Tester
1. Paid team event, `team_min` 2: start a gateway checkout, backdate 20 min, a member leaves, then fire the old order's demo confirm or webhook. Expected after the fix: refund list, entry still `forming`. Today the entry is confirmed.
2. Bank UPI, no UTR, backdated 31 min: the Pay button is back, the slot is free on a 1-slot event, and a new team can register. With a UTR, backdated 2 h: still "UTR sent", no Pay or Withdraw, and the slot stays taken.
3. Ticket regression: buy tickets, backdate 16 min, another buyer takes the last seat. The late payment re-reserves if there's room, otherwise it goes to the refund list. The UPI order with a UTR is never released.
4. Sales on Neon Utsav: Tickets = Overview = Analytics. Collected and payout unchanged against the sum of orders.
5. `/my-events?paid=<script>` and `?utr=anything`: only the fixed strings appear. Flash messages show after Accept, Submit team and Cancel & refund, and clear on navigation. Check at 390px.

## Questions for Harshith
None.

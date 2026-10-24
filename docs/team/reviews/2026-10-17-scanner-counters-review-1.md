# Review 1: scanner counters (lunch / stay), commit 309b890

**Reviewer:** Supervisor, Oct 17 2026
**Plan:** `docs/team/plans/2026-10-17-scanner-counters.md`
**Brief:** BRIEF.md, "Scanner: one QR, different counters"

## Verdict: CHANGES NEEDED (small)

The core is sound. The counter comes from the volunteer's duty on the server, the client can't override it, and lunch and stay are each used once per slot without races (unique `(ticket_id, slot)` + `on conflict do nothing`). An add-on can't be attached to someone else's ticket. Two money-path bugs in add-on checkout need fixing before this goes to `full-app` (findings 1 and 2). Both are a few lines.

## Brief check
| BRIEF line | Status |
|---|---|
| One QR; what a scan shows depends on who scans; volunteer assigned Gate/Lunch/Stay | OK. `api/scan/route.ts:25-28` uses `counterFor(duty)` for staff and ignores `b.counter`. `scan/page.tsx:24-28` does the same for `?counter=` |
| Lunch volunteer only sees lunch, hostel desk only stay | OK. `redeemPerk` returns only lunch or only stay info (`scan.ts:151-170`). Holder name/type/code are shown at every counter, which is needed to match the person |
| QR stays the same signed ID; perks in DB | OK. No change to `ticket-crypto`; perks live in `perk_redemptions` and `ticket_types` |
| Lunch: organizer sets days beforehand | OK. `actions.ts perksFrom` checks that the days fall inside the fest dates |
| Stay: check-in and check-out | OK. `scan.ts:162-170` |
| Included with ticket type AND sold as add-ons | OK |
| No other counters, no day passes or re-entry | OK. Only gate/lunch/stay |
| Lean, few rounds | OK. Additive schema, no new dependency |
| Never touch `main` or prod accounts; builder makes no prod DB changes | OK. SQL is only in LAUNCH-CHECKLIST Part 2a. The coordinator must apply v2.3 **together with** v2.2 before deploying, or every scan at lunch/stay and every ticket page will fail |
| Push only meaningful batches | OK. One commit |

## Plan steps
1. Schema + schema-check + seeds: **done**. `schema.sql:379-396`, `schema-check.ts`, `demo-seed.sql`, `seed.mjs`
2. `counterFor(duty)` + datalist: **done**. `scan.ts:17-22`, `volunteers/page.tsx` (with a plain hint about the duty names)
3. `redeemPerk` + `resolveTicket` extraction, not written to `scans`: **done**. `checkIn` behaviour is unchanged; failures still log to `scans` because `logAs = gate`
4. API + UI counter label, picker only for organizers, today's counts: **done**
5. Organizer ticket-type checkboxes: **done**
6. Buying add-ons from the ticket page, qty 1, no ticket rows, capacity excluded, fest page hides add-ons: **done**, but see findings 1 and 2
- Tests §5: all present in `tests/e2e.py` COUNTERS and `tests/race.py`. I did not re-run the suite in this review.

## Builder's extras: keep or revert
| Extra | Verdict |
|---|---|
| Refunding add-ons (`refunds.ts` one-unit path) | **Keep.** It's needed: cancelFest goes through it, and so does the plan's "refund → lunch refused" test |
| Transfers move add-on orders + perk redemptions (`transfer.ts:41-43`) | **Keep.** Without it, a transfer would reset an already-eaten lunch or lose a paid add-on |
| Duplicate add-on block | **Keep.** The ordering bug is in finding 1 |
| Stay check-out guard (10 s) + 60 s camera cooldown at perk counters | **Keep.** Stops a QR held in front of the camera from checking someone in and straight back out |
| Kind lock (entry/add-on can't flip once ordered) | **Keep.** Flipping would orphan tickets or create ticket-less entry orders |
| Sales counts for add-ons (`sales/page.tsx`) | **Keep.** Without it, add-ons show 0 sold and can't be refunded from Sales |
| Seed updates | **Keep** |
| `queries.ts` capacity/quota/min price use `kind='entry'` | **Keep.** It's part of step 6 |

## Findings

### 1. MEDIUM (money / broken flow): an abandoned add-on checkout blocks re-buying, and a late payment can charge twice
`src/lib/orders.ts:51-52` runs the duplicate check (`status in ('paid','pending')`) **before** `releaseExpiredHolds` (line 57). Holds are only released inside `createOrder` for that type or by `cancelOrder`.
- **What a student sees:** they open Cashfree for "Lunch add-on", then close the tab or the payment fails without a callback. The order stays `pending`. The ticket page hides the add-on (`tickets/[id]/page.tsx`, `owned` includes pending), and any retry fails with "This ticket already has Lunch add-on". This lasts indefinitely, until another student happens to buy the same add-on type and that purchase sweeps the hold.
- **Double charge (plausible, needs a late gateway webhook):** order A expires to `failed` and the student buys B, which is paid. Then A's payment lands. `fulfilOrder` (`orders.ts:161-176`) re-reserves A and marks it paid, with no add-on duplicate check. The student has now paid twice for the same lunch, and nothing is flagged for refund.
- **Fix:** (a) call `releaseExpiredHolds(tx, ticketTypeId)` before the duplicate check, and have the ticket page's `owned` query ignore pending orders older than the hold time. (b) In `fulfilOrder`, when `o.addon_for` is set: if another `paid` order exists with the same `addon_for` + `ticket_type_id`, or the target ticket is `void`, `return needsRefund('Add-on already on this ticket / ticket cancelled — refund needed')`.

### 2. MEDIUM (money): refunding an entry ticket leaves its paid add-on charged
`refunds.ts:16-50`. When the organizer refunds an entry order (Sales → refund), the ticket becomes void, but the attached lunch/stay add-on order stays `paid`. The student can no longer use the add-on (the ticket is void, so it's refused at the counter), but they don't get the add-on money back unless the organizer separately finds and refunds that order. cancelFest is fine because it loops over every paid order.
- **Fix (small):** after voiding tickets in `refundOrder`, refund every `paid` order whose `addon_for` is in `ids` in the same pass (call `refundOrder` for each after the transaction), or at least show "This ticket has a paid add-on, refund it too" on the Sales row. I prefer auto-refund. That needs Harshith's yes (see questions).
- A related edge case (low): `fulfilOrder` can mark an add-on paid for a ticket that was voided between checkout and payment. Fix (b) in finding 1 covers it.

### 3. LOW (plain language): stay desk says "⚠ Stay done" for "checked in just now"
`Scanner.tsx` TITLE.stay.duplicate = "⚠ Stay done", but `scan.ts:165` also returns `duplicate` for the 10-second guard ("checked in just now"). The volunteer could think the person already checked out. Suggest "⚠ Already scanned", and let the message line carry the detail.

### 4. LOW (ops): a stay-desk scan is always state-changing
Any second scan after 10 s checks the guest out, for example if a volunteer re-scans to "just verify" that evening. This matches the brief (in → out). Add one line to the volunteers hint: "Stay desk: first scan checks in, next scan checks out."

### 5. LOW: changing lunch days or stay on a type already sold is allowed silently
`updateTicketType` locks `kind` but lets the organizer remove lunch days or stay after students paid for them. This is the organizer's call. Optional: when `t.orders > 0`, warn with "N people already have this".

### Confirmed OK (no action)
- **Counter bypass:** `fest_staff.duty` is `not null default 'Gate'` (`schema.sql:146`), so `duty === null` only comes from the owner/co-organizer branch of `scannableFests`. A volunteer can't become a "manager" by leaving duty empty. `?counter=` and `body.counter` are ignored for staff.
- **Double lunch:** a unique `(ticket_id, slot)` insert; race.py covers it. Transfer moves redemptions, so a new holder can't eat again.
- **Add-on for another person's ticket:** `orders.ts:47-49` requires `user_id = buyer`, same fest, non-void, `for update` (which also serializes duplicate attempts). The e2e test covers it.
- **Amount:** qty is forced to 1 before pricing. Capacity and the 10-ticket limit skip add-ons. The add-on quota still applies. A refund of an add-on refunds the full amount once (`status='paid'` check under `for update`).
- **Access:** `/api/scan` keeps `sameOrigin`, `getScanner` and `scannableFests`. Checkout keeps the student-only check and validates `ticketId` as a uuid. The ticket page is filtered by `t.user_id = user.id`, and void tickets return early.
- **Mobile:** the counter label/picker row uses `grow` + a fixed 150 px select. Fine at 390 px.

## Pre-existing round2.py failures
- **`/admin/errors` crashes when `app_errors` is missing** (`admin/errors/page.tsx:11-13`, no guard). **Fix now.** Production is in exactly this state until Part 2a is applied, so Harshith would see the crash page. Small: catch Postgres `42P01` and render "Database setup incomplete — run LAUNCH-CHECKLIST Part 2a".
- **390 px overflow after unlocking a 49-char email** (`admin/page.tsx:84-90`, the ActionForm message). **Fix now if it's a one-liner** (`overflow-wrap:anywhere` / `word-break:break-word` on the form message). Otherwise it can wait. Only the admin sees it, and it is cosmetic.

## Test plan for the Tester (only what e2e.py COUNTERS doesn't cover)
1. **Abandoned add-on:** start a paid (non-demo) add-on checkout, cancel without paying, and age the order past 15 min (`update orders set created_at = now() - interval '20 min'`). Reload the ticket page: the add-on must be offered again and buying it must succeed. (Fails today: finding 1.)
2. **Late payment after re-buy:** with order A `failed` and order B `paid` for the same add-on and ticket, call `fulfilOrder(A, {provider:'cashfree', paymentId:'x'})`. Expect a refund-needed flag, not a second paid order.
3. **Entry refund with add-on:** buy entry + lunch add-on, then refund the entry order from Sales. Check what happens to the add-on order (today it stays `paid`: finding 2).
4. **Transfer after lunch:** redeem lunch today, transfer the ticket, then scan the new ticket at the lunch counter. Expect "already taken". The add-on shows on the new owner's ticket page.
5. **Lunch on a non-lunch day:** set a type's lunch days to tomorrow only and scan today. Expect "No lunch on this ticket today".
6. **Stay guard:** check in, then re-scan via API within 10 s. Expect "checked in just now" and no `stay_out` row.
7. **Co-organizer (fest_members) who is also on fest_staff as "Lunch counter":** confirm they get the picker (manager wins). Decide whether that is fine.
8. **Free add-on (price 0):** "Add for free →" attaches without a gateway and creates no ticket row.
9. **390 px:** scanner on lunch and stay counters (organizer with picker), and the ticket page with the "Lunch & stay" card + add-on buy box.
10. **Production readiness:** with the v2.3 tables dropped locally, `/api/health` should name them (schema-check). The ticket page and `/scan` should fail plainly, not with a crash page.

## Questions for Harshith
- When an organizer refunds an entry ticket that has a paid lunch/stay add-on, should the add-on be **refunded automatically**? (Recommended: yes. The student can't use it any more.)

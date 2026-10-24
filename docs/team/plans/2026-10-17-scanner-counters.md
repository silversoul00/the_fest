# Plan: one QR, different counters (Oct 17, 2026)

## 1. Goal
"One QR to scan, but it shows different info based on who is scanning — e.g. lunch volunteers scanning reveal the lunch coupon."

## 2. Decisions it follows (BRIEF.md, "Scanner: one QR, different counters")
- Counter comes from the volunteer's assignment (Gate / Lunch / Stay). Lunch desk sees only lunch, stay desk only stay.
- QR unchanged (same signed ticket ID); perks live in the database.
- Lunch: organizer sets days beforehand. Stay: check-in and check-out.
- Perks come with a ticket type and are also sold as add-ons. No other counters.

## 3. Steps
1. **Schema** (S): `db/schema.sql` + `src/lib/schema-check.ts` + `db/demo-seed.sql` (one entry type with 2 lunch days + stay, one "Lunch add-on"). See §4.
2. **Counter from duty** (S): `src/lib/scan.ts` add `counterFor(duty)` → `'lunch'` if duty starts with "Lunch", `'stay'` if "Stay"/"Hostel", else `'gate'`. Volunteers page datalist: add "Lunch counter", "Stay desk" (`volunteers/page.tsx`).
3. **Perk scan** (M): `src/lib/scan.ts` add `redeemPerk({festId, scannerId, counter, payload|code})`. Reuse the existing ID/code lookup (extract it into a helper `resolveTicket`, no behaviour change for `checkIn`). Ticket must be non-void. Perks = ticket's own type ∪ types of **paid** add-on orders attached to it. Lunch: today (IST) must be in the perk's `lunch_days`, then `insert … on conflict do nothing returning` slot `lunch:YYYY-MM-DD`; none returned → "Lunch already taken today at HH:MM". Stay: no `stay_in` → insert `stay_in`; else no `stay_out` → insert `stay_out`; else "Already checked out". Not entitled → "No lunch/stay on this ticket". Do **not** write perk scans to `scans` (sponsor/gate stats read it).
4. **API + UI** (M): `api/scan/route.ts` accepts `counter`; for staff the server uses `counterFor(duty)` and ignores the client; owners/co-organizers (duty null) may pick. Gate path untouched. `scan/page.tsx` passes `counter`; `Scanner.tsx` shows the counter as a big label (select only for organizers), verdict shows holder + "Lunch ✓ (day 2 of 2)" / "Stay: checked in". Counts line for perk counters: today's redemptions.
5. **Organizer ticket types** (S): `tickets/page.tsx` + `addTicketType`/`updateTicketType` in `organizer/actions.ts`: checkbox "Add-on (needs an entry ticket)", checkboxes for each fest day "Lunch on", checkbox "Includes stay".
6. **Buying add-ons** (M): student ticket page lists active add-on types with a Buy button → existing `/api/checkout` with extra `ticketId`. `createOrder`: if type is add-on, require `ticketId` owned by buyer, same fest, non-void; force qty 1; store `orders.addon_for`; exclude add-ons from fest capacity sum. `fulfilOrder`: add-on orders issue **no** ticket rows. Catalogue/fest pages hide add-on types from normal purchase (filter `kind='entry'` in `queries.ts`). Ticket page also shows perks with used/unused.

## 4. Data changes (additive, idempotent)
```sql
alter table ticket_types add column if not exists kind text not null default 'entry' check (kind in ('entry','addon'));
alter table ticket_types add column if not exists lunch_days date[] not null default '{}';
alter table ticket_types add column if not exists includes_stay boolean not null default false;
alter table orders add column if not exists addon_for uuid references tickets(id) on delete set null;
create table if not exists perk_redemptions (
  id bigserial primary key, fest_id uuid not null references fests(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,
  slot text not null,                      -- 'lunch:2026-11-02' | 'stay_in' | 'stay_out'
  scanned_by uuid not null references users(id), created_at timestamptz not null default now(),
  unique (ticket_id, slot));
alter table perk_redemptions enable row level security;
```
Add the same block to `docs/LAUNCH-CHECKLIST.md` Part 2a. Coordinator applies to production.

## 5. Tests (extend `tests/e2e.py`; race in `tests/race.py`)
- Lunch volunteer scans entitled ticket → lunch ✓; second scan → "already taken"; ticket without lunch → refused; gate status unchanged.
- Stay desk: 1st scan check-in, 2nd check-out, 3rd "already checked out".
- Staff can't override counter via API (`counter:'gate'` from lunch volunteer still redeems lunch, not admit).
- Buy lunch add-on (demo checkout) on a no-lunch ticket → then lunch scan works; no new ticket row; refund → lunch refused.
- race.py: 5 parallel lunch scans → exactly one success.

## 6. Out of scope / don't do
No QR format change, no perks table/catalogue, no kits/workshops/VIP/day passes/re-entry, no new dependency, no rewrite of `checkIn`, no production DB changes by the builder.

## 7. Done when
- [ ] Volunteer duty "Lunch counter" opens scanner on lunch; "Stay desk" on stay; Gate unchanged
- [ ] One lunch per allowed day, atomic; stay in → out → done
- [ ] Organizer sets lunch days / stay / add-on on ticket types
- [ ] Student buys add-on from ticket page; no extra ticket; capacity unaffected
- [ ] Schema-check + LAUNCH-CHECKLIST updated; `tests/run-e2e.sh` green

# Fest events (part A): categories, events, solo/team registration, Event counter — research brief + build plan
Date: 2026-10-25 · Researcher/Planner · Schema **v2.8** (additive, idempotent) · Part B (judging/results/certificates) is out.

## 1. Goal
A fest has categories (fixed list) holding events (Battle of Bands, Case Study…). Students register solo or as a
team (captain invites by email, members accept), paying through the checkout we already have if the event has a fee
(₹5 platform fee). Organizers manage events in a new Events tab; an event head manages only their own event. On the
day, the same ticket QR is scanned at a new "Event" counter to mark attendance.

## 2. What Harshith already decided (BRIEF.md, Oct 25 2026 + Oct 24)
- "Fest → categories (fixed list: Cultural, Management, Technical, Sports, Literary, Gaming, Other) → events (date/time,
  venue, rules, prize, solo/team with min–max size, fee: free-with-ticket or paid, slots, deadline, mixed colleges
  allowed per event). Event heads/judges link to a specific event."
- "platform fee **₹5 per paid event registration**; organizer chooses per event whether a fest ticket is needed;
  students can leave a team before the deadline and captains can remove members; full events just show "Full" (no
  waitlist in v1). Event entry via the same QR on a new "Event" scanner counter. Judging/results/certificates = part B."
- "Add v2.8 to both Supabase databases after tests pass (same pattern as before)."
- "Refunds = owner + Finance lead" (co-organizers and event heads do not refund). Role holders use normal student accounts.
- Smart QR: keep the QR as is; usage limit is tight → lean plan, few rounds.

## 3. Findings
- **Code: add-ons are the template.** `orders.ts` already sells a `ticket_types.kind='addon'` row that issues no tickets
  (`addon_for`), refunds it as one unit (`refunds.ts` k=1), re-reserves on late payment, releases expired holds, and
  is covered by `cancelFest`. An event registration has the same shape → reuse, don't fork the money code.
- **Code: `orders.ticket_type_id` is NOT NULL** and refunds release seats via `ticket_types.sold`. A hidden "shadow"
  ticket type per event (`kind='event'`, `quota` = slots, `sold` = slots taken) keeps every money path (holds, expiry,
  late-payment re-reserve, refund seat release, fest cancel, analytics gross/net, Sales list refund button) working.
- **Code: things that would wrongly count event orders** — 10-tickets-per-fest cap (`orders.ts`, filters only
  `addon_for is null`), analytics `sum(quota)` over all ticket types (`analytics.ts:19`) and per-type list (:44–45),
  Sales "by type" summary, Tickets tab list, `notifyOrderPaid` email, `/orders/[id]` page. Public fest page and
  capacity sums already filter `kind='entry'`.
- **Code: pricing** `quote()` takes a `FeeConfig`; a flat ₹5 config (`mode:'flat', flatPaise:500`, rest from
  `feeConfig()`) gives the right fee + gateway gross-up with no new maths.
- **Code: scanner** — `Counter = gate|lunch|stay`, `ROLE_COUNTER`, `scannableFests` give counters; `redeemPerk` shows
  the pattern for a non-gate counter (atomic claim, not written to `scans`). Smart QR sealed sections are per role
  (`gate/lunch/stay/org`); event lists change after the QR is made, so a sealed section would go stale → **server
  lookup online, no new QR role, QR size unchanged.**
- **Code: roles** — `fest_roles.event_id` exists (no FK, "reserved for Competitions"); unique index uses
  `scope_label`, so two event-head rows for one person need different `scope_label` (use the event title).
  Permissions are fest-wide sets in `roles.ts`; event scoping needs a small extra check.
- **Code: `users.college`** is free text (nullable) → "same college" can only be a normalised text match (uncertain
  for "RVCE" vs "R V College of Engineering").
- **Competitors**: KonfHub team-based registration — organizer sets min/max size per ticket, creator becomes team
  lead, team closes at max ([KonfHub](https://blog.konfhub.com/team-based-registration-for-events)). Skild — leader
  invites by email, invitee must accept, can't submit until accepted members ≥ minimum, no invites past maximum
  ([Skild](https://support.skild.com/support/solutions/articles/43000511519-how-do-teams-work-)). Our flow matches both.
- Not checked (unchanged by this feature): GST on the ₹5 fee follows the existing commission treatment.

## 4. Recommendation (build plan)

### Schema v2.8 (append to `db/schema.sql`, safe to run twice; add columns to `schema-check.ts`)
- `ticket_types.kind` check → `('entry','addon','event')` (DO block: drop/re-add constraint only if it lacks 'event').
- `events`: id, fest_id (cascade), category (check fixed 7 keys), title 2–80, starts_at, ends_at null, venue ≤120,
  rules ≤3000, prize ≤200, team_min/team_max (1 ≤ min ≤ max ≤ 20; solo = 1/1), price_paise ≥ 0, slots 1–5000,
  reg_deadline timestamptz (default = starts_at), mixed_colleges bool default true, needs_ticket bool default false,
  ticket_type_id uuid unique not null → ticket_types (the shadow row, created in the same transaction),
  active bool default true, sort, created_at. Index (fest_id, starts_at).
- `event_regs` (one per solo entry or team): id, event_id, fest_id, captain_id → users, team_name ≤60 null,
  status `forming|confirmed|withdrawn|refunded`, confirmed_at, created_at.
- `event_members`: id, reg_id (cascade), event_id (denormalised), email citext, user_id null, status
  `invited|joined|declined|left|removed`, joined_at, checked_in_at, checked_in_by.
  Unique `(event_id, user_id) where status='joined'` (one team per student per event = no double registration);
  unique `(reg_id, email) where status in ('invited','joined')`.
- `orders.registration_id uuid references event_regs(id)`; unique partial index `(registration_id) where status in
  ('pending','paid')`.
- `fest_roles.event_id` → FK `events(id) on delete cascade` (DO block, only if missing).

### Slots and races (one rule: the shadow `ticket_types` row is the only slot counter)
- A slot is taken when an entry becomes confirmed (free: "Register"/"Submit team"; paid: when the order is created,
  as a 15/30-min hold, exactly like tickets). Forming teams don't hold slots. `sold >= quota` → "Full".
- Every write locks in the same order: shadow `ticket_types` row `for update` → `event_regs` row `for update`.
  `sold <= quota` check constraint is the last guard.
- Join race: accept locks the reg row, counts `joined < team_max`, re-checks deadline with `now()`; the unique index
  turns a second team for the same event into "You're already in a team for this event" (catch 23505).
- Free withdraw / paid refund: `sold - 1` (refund already does this via `ticket_type_id`).

### Money (reuse `createOrder`/`fulfilOrder`/`refundOrder`)
- `/api/checkout` accepts `registrationId` (instead of `ticketTypeId`); server resolves the event's shadow type.
- `createOrder` branch `kind='event'`: user is captain, reg `forming`, joined ≥ team_min, deadline not passed, event
  active, needs_ticket/mixed-college re-checked for all joined members, no open order for this reg, qty = 1,
  fee config = flat `EVENT_FEE_PAISE` (default 500). Skip the 10-ticket cap (also add `registration_id is null` to it).
  Bank UPI paise tag and demo/Cashfree/Razorpay all unchanged.
- `fulfilOrder` branch: reg withdrawn/refunded or fest cancelled → existing `needsRefund`; else reg `confirmed`;
  no tickets issued. Late payment after expiry uses the existing re-reserve/"sold out → refund" branch.
- `refundOrder`: treat `registration_id` like `addon_for` (k = 1, no tickets), set reg `refunded`. Who: `refund`
  perm only (owner + Finance). Event orders appear in Sales as "Event: <title>" with the normal refund button.
- Students never self-refund a paid entry ("Ask the organizer for a refund"). Refunding a fest ticket does not touch
  event entries (the Event counter rejects a void ticket anyway).
- Fix the lists in §3 so event shadow types/orders never count as tickets (filter `kind <> 'event'` where tickets/quota
  are meant); money totals keep including them (it is real money).

### Permissions (`roles.ts`, `fest-access.ts`)
- New perms: `events` (create/edit/delete any event, see all entries, export) → owner, co_organizer;
  `events_view` (open the Events tab) → event_head, judge, plus everyone with `events`.
- `festAccess` also returns `eventIds` = event_id of the person's active event_head/judge roles.
  Helper `requireEventPerm(fd, eventId, 'manage'|'view')`: `events` perm → any event of this fest; event_head →
  only events in `eventIds` (manage: edit details, roster, mark present, remove an entry before deadline, export);
  judge → view roster (names, team, college; no emails, no export). Everyone else → "Your role can't do this."
  Event heads can't change price, slots or needs_ticket (money/capacity stay with owner/co-organizer).
- Team tab: for event_head/judge, an event picker (sets event_id; scope_label = event title). No events yet → old
  free text. `ROLE_HINT` for both updated. `check-guards.mjs` must cover the new actions/pages.

### Screens
1. **Organizer → Events tab** (`/organizer/[festId]/events`): list grouped by category (title, date, solo/team,
   fee, `taken/slots`, deadline, Hidden badge); "Add event" form with every field above; edit; delete only if no
   entries (else Hide). Event page: entries (team, captain, members, college, status, paid, present ✓), "Mark
   present" per member (for students with no fest ticket), CSV export. Event heads see only their events.
2. **Fest page** (`/fests/[slug]`): "Events" section, category chips, cards: title, date/time, venue, "Solo" or
   "Team of 2–4", fee ("Free", "Free · fest ticket needed", "₹200 + ₹5 fee"), "12 slots left" / **Full** / Closed.
   Event detail page: rules, prize, mixed-college note, Register / Create team button (login required, student acct).
3. **Register**: solo → one tap (free) or checkout (paid). Team → name the team, captain joins as member 1, invite by
   email (up to max − joined outstanding), "Submit team" / "Pay & submit" enabled when joined ≥ min.
4. **My tickets → "My events"**: each entry with status (Forming 2/4 — need 3; Payment pending; Confirmed; Refunded),
   pending invites for my confirmed email (Accept / Decline), captain: invite, remove, submit/pay; member: leave.
   Leave/remove: before deadline only, and on a confirmed team only if joined stays ≥ min (message otherwise). Captain
   can withdraw a free entry (frees the slot); can't leave while others remain. Invite email via the existing outbox,
   link to My events; accepting needs a confirmed email.
5. **Scanner → "Event" counter**: shown to managers and event heads (`ROLE_COUNTER.event_head = 'event'`); pick the
   event (event heads: only theirs). Scan the ticket QR or type the code → server looks up the ticket's owner →
   "Present ✓ — Team Rockers (2/4 here)" / "Already marked at 10:42" / "Not registered for <event> — registered for
   X, Y" / "Entry not confirmed" / "Ticket cancelled". Atomic `update … where checked_in_at is null`. Online only
   ("Event counter needs internet" when offline); not written to `scans`.
6. **Activity log**: event.add / event.edit / event.delete / event.hide / event.entry_remove / event.mark_present
   (manual only) / event.export. Refunds already logged.

### Tests (`tests/events.py`, added to `run-e2e.sh`)
Schema twice; pure fee check (₹200 → 200+5+gateway); flows below in §5; race: 10 parallel registrations on slots=1,
6 parallel accepts on a 3-max team, same student accepting two teams; existing money/refund/team_roles suites green.

## 5. Acceptance criteria
1. Organizer (owner/co-org) can add, edit, hide, and delete (only with no entries) events in all 7 categories; field
   limits enforced; slots can't go below taken.
2. Fest page shows event cards by category with correct fee text, slots left, "Full" at `taken = slots`, "Closed" after
   deadline; hidden events don't show.
3. Solo free registration confirms instantly; a second registration by the same student is refused.
4. Team: captain invites by email; invitee accepts from My events; accept fails at max size, after deadline, when
   already in another team of that event, when the event needs a fest ticket they don't hold, and (mixed not allowed)
   when their college differs from the captain's or is blank.
5. Submit/Pay disabled until joined ≥ min; leave/remove blocked after deadline and when it would drop a confirmed team
   below min.
6. Paid event: total = price + ₹5 + gateway charge (gateway only) on demo, Cashfree/Razorpay, and bank UPI (with paise
   tag); `platform_fee_paise = 500`; webhook + callback twice → confirmed once; no ticket rows created; event orders
   don't count toward the 10-ticket cap or ticket/quota analytics, but do count in revenue.
7. 10 parallel registrations on a 1-slot event → exactly 1 confirmed; an abandoned checkout frees its slot after the
   hold; a payment landing after the slot was taken goes to the refund list.
8. Refund of an event order by owner/Finance: full amount back, entry → Refunded, slot freed; co-organizer, event head,
   judge cannot refund. Fest cancellation refunds paid event entries.
9. Event head A sees and manages only event A (tab, entry list, export, scanner picker); opening event B's page/export/
   action → no-access / "Your role can't do this"; event head can't change price/slots/needs_ticket. Judge sees the
   roster without emails and has no export.
10. Event counter: confirmed member → Present; rescan → "Already marked"; not registered → says so and lists their
    events; void ticket → refused; wrong fest → refused; two scanners at once mark once.
11. CSV has one row per member with team, status, email, college, paid, present; exported only by `events` perm or that
    event's head.
12. Activity log shows the event actions in §4.6 with the actor.
13. At 390px: Events tab, event form, fest page cards, event detail, My events, Event counter — no horizontal scroll,
    buttons ≥ 44px.
14. Schema v2.8 runs twice cleanly on a v2.7 database; app without v2.8 hides Events (like `rolesReady`).

## 6. Out of scope
Judging, scores, results, certificates (part B); waitlists; per-member payments; team-captain transfer; event
cancellation with bulk refund (refund from Sales one by one); offline Event counter / sealed QR section; event-level
analytics charts; event-only tickets without a fest; auto-cancel of event entries when a fest ticket is refunded;
college picker/dedup (free-text match only); per-event custom questions.

## 7. Questions for Harshith
1. Team events: does the **captain pay once per team** (fee and ₹5 platform fee per team), or does every member pay?
   **Recommend: captain pays once per team** (how Bengaluru fests usually charge; one order, simpler refunds).

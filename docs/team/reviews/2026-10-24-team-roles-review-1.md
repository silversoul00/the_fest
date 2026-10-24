# Team & Roles (v2.7) — Supervisor review 1 (Oct 24, 2026)

Commit reviewed: `4b5fe45` (diff `eaf8018..4b5fe45`). Plan: `docs/team/research/2026-10-24-team-roles.md`.
`node scripts/check-guards.mjs` → 30 actions, 15 pages/routes guarded (re-run by me, passes).

## Verdict: CHANGES NEEDED
There is one must-fix and it is small: a co-organizer can give themselves the Finance lead role, and with it the power to refund. That goes against Harshith's Oct 24 answer: "co-organizers do not refund". Everything else on the authorization side holds up.

## Brief check
- Fixed roles, several per person, optional day/event, pending until email confirmed: **OK**. `roles.ts`, `fest-access.ts:148` (`activeRole` needs `verified` and today's IST day).
- Owner + co-orgs assign roles, only the owner adds/removes co-organizers: **OK**. `actions.ts:343`, `actions.ts:401`; the owner has no role row and their email is refused at `actions.ts:355`.
- Refunds = owner + Finance lead, co-orgs do not refund: **VIOLATED by escalation** (finding 1). The static matrix is right: `roles.ts:65-66`.
- Desk = lookup + gate scan, no money: **OK**. `desk: ['sales']`, Sales hides totals, amounts, refunds and UPI-to-send (`sales/page.tsx`); counter is gate (`roles.ts:79`).
- Student accounts can hold roles: **OK**. `requireUser()` with no role on fest pages and actions. `createFest` and `/organizer/new` stay organizer-only.
- Supabase not touched by the builder: **OK**. BRIEF says the coordinator applies v2.7.
- Never merge to main, push only batches: **OK** (no push seen).

## Plan followed?
Mostly yes: the data model, `requirePerm`/`pageAccess` on every action and page, scanner managers limited to owner/co-org, counter sets, the static guard, the Team tab, /me roles, and tests.
Deviations, and my judgement:
- **Activity log written after the change, not inside the same transaction** (`fest-access.ts:222`). Acceptable for v1. A failed log line never undoes a refund, and refunds are also on `orders`. The cost is that a crash between the two steps leaves no log line. Keep it.
- **Migration copies once, using a table-comment marker** instead of plain `on conflict do nothing`. This is better than the plan, because re-running the file can't bring back a removed role. It is idempotent.
- **Revenue hidden from non-money roles on Overview**, but Analytics (allowed for Sponsorship and Media) still shows "Your revenue", per-type ₹ and per-method ₹ (`analytics/page.tsx:78,103,165`). This is inconsistent (finding 3).
- **Changed existing checks**: export moved from organizer-only to the `export` perm; the media-kit preview moved to the `sponsors` perm; draft-fest preview is now allowed for any active role (`fests/[slug]/page.tsx:28`). All are fine. Note that a gate volunteer can now preview a draft fest page. That is harmless.

## Authorization sweep (all confirmed in code)
- All 30 actions in `organizer/actions.ts` call `requirePerm` with a named perm (or `requireOwnRole` / `requireUser('organizer')` for createFest). The fest comes from `festAccess`, and every write is scoped `fest_id = fest.id`. Forged `festId` gets "Fest not found".
- Pages: layout plus all 13 tab/report pages call `pageAccess` with the matrix perm. `export/route.ts` checks the `export` perm.
- Owner-only: `payments_settings` (UPI ID, inbound link: save and rotate), `cancel`, `team_coorg`. The UI also shows the inbound link only with `payments_settings`.
- Scanner: `scannableFests` is recomputed on every `/api/scan`, `/api/scan/keys` and `/scan` request. Pending, removed and not-today roles are dropped, so old scanner sessions are refused at once. Finance has no counter, so it gets 403 on keys and no organizer seal. A volunteer's counter must be in their own set (`api/scan/route.ts:24`).
- Sponsor requests (org side): `decideRequest` is now pinned to the fest that `requirePerm('sponsors')` checked (`sponsor-requests.ts:124-127`). `leads.csv` is brand-side and unchanged.
- Activity log: written only by the server with the actor taken from the session. There is no app path to edit or delete it. The viewer is gated by `activity` (owner/co-org, `team/page.tsx:42`). Summaries are React-escaped.
- Other fests: every access query is keyed on fest id plus confirmed email. I found no path from a student account to another fest.

## Findings
1. **HIGH: a co-organizer can grant themselves refunds.** File: `src/app/organizer/actions.ts:335-366` (addRole).
   A co-org has the `team` perm and adds a `finance` row for their own email. Only the owner's email is refused, so the row goes in. `permsFor` unions the roles, so they now have `refund` and see "Cancel / refund" on Sales. The same works for any second email they control, or for a friend. Harshith decided that co-organizers do not refund.
   **Fix:** refuse `role === 'finance'` unless the caller has `team_coorg` (owner only). Hide Finance lead in the role dropdown for co-orgs, the way Co-organizer is hidden (`team/page.tsx:89`). Also refuse adding any role to `user.email` yourself. Add a forged-form test: co-org POSTs addRole for finance → refused, no row. *(If Harshith wants co-orgs to be able to assign Finance, then it's his call. See question 1.)*
2. **MEDIUM (rollout): order matters when v2.7 goes live** (`fest-access.ts:135`, `schema.sql` copy block). While the tables are missing, only owners get in, so every existing co-org and volunteer is locked out. The copy runs once, at apply time. Co-orgs or volunteers added by the old code after the SQL is applied are never copied.
   **Fix (coordinator):** apply v2.7 right when the new code deploys. Check `fest_members`/`fest_staff` counts against `fest_roles` afterwards. If needed, re-run the two `insert … on conflict do nothing` lines by hand.
3. **LOW: revenue is hidden on Overview but shown on Analytics** to Sponsorship and Media leads (`analytics/page.tsx:78,103,110,165-171`). Either gate the ₹ figures in Analytics on `money` too, or drop the Overview hiding. See question 2.
4. **LOW: removing one role ends the person's scanner session at every fest**, not just this one (`actions.ts:323-329`). The delete is by user, and only checks scan roles at *this* fest. Example: a Gate volunteer at fest A who loses the Finance role at fest B must log in to the scanner again. **Fix:** skip the delete if they still have a scan role at any fest, or accept it and say so.
5. **LOW (wording): a past-day role shows "Your shift is on <past date> … opens for you that day"** (`queries.ts` shift_day fallback, `scan/actions.ts:36`). Say "Your shift was on …" when the date is past, or drop past days.
6. **LOW (plain language): a stale tab hits a raw error page.** `requirePerm` throws "Your role can't do this." / "Fest not found" from form actions. In production a role holder whose role was just narrowed gets the generic error page instead of a sentence. This is acceptable for v1, because the tabs and buttons are hidden.
7. **INFO:** the booth print page (`booth/[code]/print/page.tsx:17`) is still owner-only. Co-orgs and Sponsorship leads can't print a sponsor's booth QR. This is unchanged behaviour; flagging it only in case it is expected.

## Test plan for the Tester
1. Co-org forged addRole with `role=finance`, `email=<own>`, and then `email=other@…` → refused after the fix, no `fest_roles` row. The owner adding Finance still works.
2. Each role (co-org, finance, sponsorship, media, event head, judge, desk, vol_gate/lunch/stay): open every tab URL plus `/export` plus `/sponsors/<id>/report` → only the matrix tabs open; the rest go to no-access or 404.
3. Desk on Sales: search by ticket code works; no ₹ anywhere (totals, Amount column, UPI to send, refund). POST refundOrderAction and confirmUpiOrder → refused.
4. Finance: refund works and is logged with the ₹ amount. `/api/scan/keys` → 403. `/scan/login` → "not on any gate team".
5. Removal while open: with a dashboard tab and a scanner open, the owner removes the role → next click is 404, next scan is 403, `/scan` goes back to login.
6. Pending: an unverified account with a role → no tab, scanner says confirm email. After confirming → access.
7. Day scope: a role set for tomorrow → "Not today" on Team, scanner 403 with the shift date. A role for yesterday → check the wording (finding 5).
8. Migration: on a DB with old members and staff, apply schema.sql twice → same `fest_roles` count. A Lunch duty volunteer still scans lunch only.
9. Co-org: can't add or remove a co-org, can leave self, can't see the UPI ID form, inbound link or Cancel fest. Owner can't be added as a role.
10. 390px: Team, /me roles card, Finance and Desk dashboards → no horizontal scroll.

## Questions for Harshith
1. Should **only the owner** be able to make someone a Finance lead? If co-orgs can, any co-org can give refund power to a friend. **Recommend: owner only.**
2. Should Sponsorship and Media leads see **revenue (₹)** in Analytics? Today Overview hides it and Analytics shows it. **Recommend: hide ₹ from them, and show tickets and footfall only.**

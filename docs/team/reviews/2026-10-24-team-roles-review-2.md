# Team & Roles: review 2 (fix round 1, commit 4632d64)

**Verdict: PASS**

Scope: diff 4b5fe45..4632d64. This round checks review-1 must-fix #1 and #3, test-1 F1 and F2, and Harshith's Oct 24 review-1 answers (BRIEF.md:108-111).

## Brief check
- "Only the OWNER can make someone a Finance lead": **OK**. `actions.ts:345` refuses `finance` unless the caller has `team_coorg`, and only the owner has that (`roles.ts` permsFor). The dropdown also hides Finance from co-orgs (`team/page.tsx:131`). Removing a Finance row is owner-only too (`actions.ts:406-407`).
- "Nobody can add a role to their own email": **OK**. `actions.ts:346` compares against the lowercased email. The owner's email is still refused inside the transaction (`actions.ts:358`).
- "Sponsorship / Media see no ₹ revenue anywhere": **OK**. Analytics now checks `money` on every figure: the revenue KPI, refunded ₹, the price and Collected columns, bar notes, the payment-method amount and the single-method sentence (`analytics/page.tsx:38-41,82-88,105-115,169-176`). Overview was already gated (`page.tsx:92`). The CSV button and the raw-data footer only show with `export`/`sales` (`:77,190`).
- Standing rules (no push to main, no account changes): **OK**. Nothing in the diff touches deploy or accounts.

## Escalation paths checked
- **addRole**: closed, as described above. In this codebase it is the only place a role row is created (`grep "insert into fest_roles"` finds only `actions.ts:364`, plus the seed files and the schema copy).
- **Edit / update role**: there is no such action. The only role actions are add, remove and leave. The single `update fest_roles` is the check-in toggle (`actions.ts:434`), and it does not change `role`.
- **Invitations**: there is no separate invite flow. A pending row is the same addRole row, and it becomes active only when the email is confirmed.
- **Migration** (`schema.sql:509-524`): it copies only `co_organizer` from `fest_members` and `vol_*` from `fest_staff`. It never creates `finance`. No legacy code in `src` still writes to `fest_members`/`fest_staff`.
- **Indirect route**: a co-org could add a friend as Co-organizer, but that is owner-only (`actions.ts:343`). Co-org perms do not include `refund` (`roles.ts` ROLE_PERMS). Closed.

## ₹ leak sweep (Sponsorship / Media)
- `/export` route: needs `export` (`export/route.ts:13-14`), which neither role has. They get a 404.
- Sales and Payments pages need `sales`/`payments`. Neither role has those.
- Sponsors tab, sponsor report and `/sponsor/fests/[id]` show only **sponsor deal amounts and brand budgets**, which is the Sponsorship lead's own job. They show no ticket revenue (checked with grep for `rupees` and `revenue`).
- There are no API routes under `src/app/api` that return fest revenue to role holders.

## Findings
1. **INFO: Sponsorship and Media leads still see sponsor deal ₹** (`sponsors/page.tsx:65,104`, `SponsorReportView.tsx:76-77`). These are deal amounts, not ticket revenue, and Sponsorship needs them for its work. Media cannot open Sponsors. I read Harshith's "₹ revenue" as ticket sales. No change is needed unless he says otherwise.
2. **INFO: the layout, Overview and no-access pages each call `scannerAt`**, which runs `scannableFests` (every fest the user is on). That adds a small extra query on every dashboard page load. This is fine at current scale.
3. **No regressions found** in the rest of the diff:
   - Check-in is now refused for unconfirmed people, and checking out still works (`actions.ts:431-437`). It has a UUID guard.
   - The day field is now a select. The server-side day-range check is still there (`actions.ts:350`).
   - The owner's own role rows now show on the Owner card, and only the owner can remove them (`actions.ts:402-407`).
   - The Scanner heading now wraps on narrow screens.

Review-1 findings #2 (rollout order), #4, #5 and #6 were out of scope for this round. #2 still applies to the coordinator when v2.7 is applied.

## Test plan for the Tester
1. Co-org: the Finance option is missing from the dropdown. Forge a POST to addRole with role=finance, first for a friend and then for their own email: both are refused and no row is created. Forge a POST that adds a vol_gate role to their own email: refused.
2. Co-org forges removeRole for a Finance row and for one of the owner's own rows: both refused, rows still there.
3. Owner adds a Finance lead: works. That person can refund.
4. Sponsorship and Media on Analytics at 390 and 1280 widths: no ₹ anywhere, no CSV button, no Sales link, and the page does not scroll sideways. A GET to `/export` returns 404.
5. Finance, Sponsorship, Media and Judge: no scanner link in the sidebar, on Overview or on the no-access page. Lunch and Stay volunteers see "Lunch scanner" / "Stay scanner". The owner sees "Scanner".
6. Pending (unconfirmed) volunteer: no Check-in button. A forged toggleCheckin changes nothing.

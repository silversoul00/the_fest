# Review 1: sponsor leads + ROI report (commit 51077aa, range 7ad9096..51077aa)

**Verdict: CHANGES NEEDED.** There are 3 small must-fixes. The core is sound: consent is opt-in and checked on the server, withdrawal works from both places, each route checks access itself, the CSV is escaped, and the schema change only adds things and is safe to re-run. `tsc --noEmit` is clean.

## Plan check (docs/team/research/2026-10-18-sponsor-leads.md)
Build steps 1 to 5 are followed. The schema, routes, screens, privacy/terms text and seed rows match the plan.
- Step 6: there is no "sponsor block extension in `e2e.py`" (e2e.py is unchanged). `tests/sponsor_leads.py` covers the same ground, so this is acceptable.
- Builder deviations:
  - **Confirmed email required to share.** OK in principle, because it stops someone handing a brand an address that isn't theirs. It does create a dead end on the booth page (see must-fix 3).
  - **One CSV with a `status` column.** OK. The plan allowed either option.
  - **SAMPLE label by email domain.** Acceptable for now. See should-fix 5.
  - **Verified-only booth visit stat.** OK. The plan asked for this. It does make "lead rate" inconsistent (see must-fix 1).
  - **Footfall counts every gate-scanned ticket.** OK. Add-on orders create no ticket rows (`src/lib/orders.ts:189`), so every ticket is an entry ticket.

## Brief check
- Sponsors "see proof of their return": OK. The report is built from real scans only, with no estimates.
- Analytics "refreshed when the page opens (not live)": OK. The report is computed on open, and the sponsor page's existing 20 s auto-refresh is unchanged.
- Don't push every small change: OK. The commit is local only (`ahead 1`).
- Never change Harshith's accounts without him: OK. Nothing was applied remotely. v2.5 is approved by Harshith, and the coordinator applies it.
- New decisions recorded in BRIEF.md: **missing**. Add "Harshith approved v2.5 `sponsor_leads` on both databases (Oct 18)" to BRIEF.md, and update CLAUDE.md the same way v2.4 was recorded.
- Mobile first, dark theme: OK. Pages are tested at 390px, except the organizer sponsors tab (see the test plan).
- Plain language: OK. Notices and errors are short and clear.

## Must-fix

1. **Medium (report arithmetic). "Lead rate" can go above 100%.** `src/components/SponsorReportView.tsx:858` computes `pct(r.leads, r.visits)`, where `r.visits` counts verified visitors only (`src/lib/sponsor-report.ts:19-20`). `r.leads` counts every active lead, including students with no gate-scanned ticket (sharing only needs a booth visit, `actions.ts:205`). Example: 5 leads from 3 verified and 2 ticketless visitors gives a lead rate of 167%. That number goes straight into a printed report for a paying brand.
   - Fix: lead rate = leads ÷ **all** booth visits (every lead is a visitor, so it can never pass 100%). Change the sub-label and the "How we counted" line to match.
   - Or count only verified leads in the rate.

2. **Medium (consent and withdrawal). One tap on the organizer's ✕ deletes a sponsor and every lead with it.** The withdrawn list goes too. See `src/app/organizer/[festId]/sponsors/page.tsx:45-47` and `removeSponsor` in `src/app/organizer/actions.ts:290`. The `on delete cascade` is in `db/schema.sql:407`.
   - What goes wrong: the brand may already have downloaded the CSV. After the delete, students lose the "Stop sharing" entry in `/me` and on the booth page, so they can no longer withdraw. The brand also never sees future withdrawals. This breaks the "withdraw any time" promise in the privacy page and the booth notice.
   - Fix (smallest): `removeSponsor` refuses when the sponsor has any `sponsor_leads` rows ("This sponsor has student leads; it can't be removed"). Also add a confirm prompt to the ✕ button.

3. **Low-medium (broken flow). Unconfirmed students hit a dead end at the booth.** Buying a ticket doesn't need a confirmed email, so many students at the fest won't have one. They see the share card, tick 18+, tap Share, and only then get "Confirm your email first (check your inbox)". See `src/app/booth/[code]/actions.ts:196` and `page.tsx:251`. The booth page sits outside the student layout, so it has no `VerifyNotice` and no resend button (`src/app/(student)/layout.tsx:11`).
   - Fix: when `!user.verified`, show `<VerifyNotice email=…/>` (with resend) in the share card instead of the form. Keep the server check.

## Should-fix (not blocking)
4. **Medium.** The sponsor dashboard mixes counts. The headline "Booth visits (verified)" counts verified visits, but the "today" count and the visits-by-hour chart count every visit (`src/app/sponsor/[id]/page.tsx:589-604`). Label them "all visits" or switch them to verified.
5. **Low.** The SAMPLE label matches any sponsor or organizer email ending `@thefest.in` (`sponsor-report.ts:1006`). Once live, a real fest run from a staff `@thefest.in` account would print "SAMPLE — demo data" on a paying brand's report. Narrow it to `@seed.thefest.in` plus the exact demo addresses (student@, sponsor@, organizer@thefest.in).
6. **Low.** Only `student` accounts can open `/me` (`requireUser('student')`). An organizer or sponsor account that shares at a booth can withdraw only from that booth page. Either block non-student roles from sharing, or accept this and note it.
7. **Low.** The booth notice always lists "college" even when the account has none (`booth/[code]/page.tsx:280`). This is cosmetic.

## Question for Harshith (no code change until he answers)
- The organizer types the sponsor's login email (`addSponsor`). In principle an organizer could give a sponsor an address they control and receive the leads. Students do see the brand name. Is trusting organizers here acceptable for v1, or should the sponsor's account be confirmed by the brand (for example, admin approval of sponsor emails) before leads are shown?
- Plan question 2 (show the deal amount and cost figures in the organizer report) was built as recommended. Harshith still needs to confirm it.

## Confirmed OK (evidence)
- **18+ tick:** checked on the server (`actions.ts:195`), and the button stays disabled until it's ticked (`LeadForms.tsx:148`).
- **Phone:** the box starts unticked. The phone is taken from the account only when ticked (`actions.ts:209`).
- **Snapshot:** taken from the account, not the form. Re-sharing refreshes `shared_at` only after a withdrawal (`:215`).
- **Withdrawal:** blanks name, phone, college and course and keeps only the email. It only touches the caller's own row (`:228`). The redirect target is checked against a regex, so it can't send users to other sites.
- **Access:**
  - `/sponsor/[id]`, `/report` and `leads.csv` each check sponsor role, confirmed email, owner email and that the fest isn't a draft (`leads.csv/route.ts:540-543`, `report/page.tsx:716`).
  - The organizer report checks `getOwnFest` (owner or co-organizer) and that the sponsor belongs to that fest (`:473`).
  - `saveLeadOffer` checks the owner email (`sponsor/actions.ts:18`).
- **What organizers see:** lead counts only. The report view gets aggregates only and is a server component, so no lead rows reach the browser.
- **CSV:** has the BOM, every cell is quoted, `= + - @ tab CR` are escaped (`src/lib/csv.ts`), the filename is cleaned, and `no-store` is set.
- **Report maths:**
  - Money is in paise and rounded once (`perHead`). Every divide-by-zero shows "—".
  - Days and hours are in IST.
  - Colleges with fewer than 5 people are merged into "Other" on both the dashboard and the report.
  - Visit rate can't pass 100%, because verified visitors are a subset of the people with used tickets.
- **Schema:** additive and safe to re-run (`if not exists`). RLS is on with no policies, the same as the other tables. `leadsReady()` handles databases without v2.5.
- **v2.5 missing in production:** until it is applied, `/api/health` and the admin card will report "database setup incomplete: sponsor_leads, sponsors.lead_offer". This is expected, so apply v2.5 before or with the deploy.

## Test plan for the Tester
1. Run `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh`. It must pass in full, including `tests/sponsor_leads.py`.
2. After must-fix 1:
   - Create one lead from a student **with no ticket** for Neon Utsav.
   - Check the report's lead rate is ≤100%, and that cost per lead = deal ÷ active leads.
3. After must-fix 2:
   - The ✕ on a sponsor with leads is refused (or asks to confirm, then refuses).
   - A sponsor with no leads can still be removed.
   - The student's `/me` entry is still there.
4. After must-fix 3:
   - With an unconfirmed student account, the booth page shows the confirm-email notice with a resend button, and no share form.
   - A forged POST is still rejected with `err=verify`, and no row is created.
5. AC7 gaps:
   - Another sponsor opening `/sponsor/{s1}` and `/sponsor/{s1}/report` gets 404.
   - An **unconfirmed** sponsor account with the right email gets 404 on all three routes.
6. Organizer sponsors tab at 390px:
   - The row with Report, Booth QR and ✕ doesn't scroll sideways.
   - Buttons are at least 44px tall.
7. Re-run the seed. Load `db/demo-seed.sql` twice on a scratch local database and confirm it doesn't fail or create duplicate leads (only if demo-seed is meant to be re-runnable; check its header).
8. Manual: open the CSV in Excel or LibreOffice.
   - A Kannada/Hindi name displays correctly.
   - `=HYPERLINK(...)` shows as text.
   - The withdrawn row has only the email filled in.

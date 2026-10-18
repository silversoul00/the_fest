# Sponsor leads + ROI report: manual browser test 1 (Oct 18, 2026)

Tester. HEAD 51077aa, branch full-app. Local Postgres, `db:setup` + `db:seed --reset`, fresh `npm run build`,
`DEMO_PAYMENTS=1 next start` on :3000. Chromium (Playwright) at 390x844 (mobile, touch) and 1280 wide.
The full release check was not re-run, because the builder ran it green (tests/sponsor_leads.py 62/62). After the pass,
the local DB was re-seeded.

## Result: FAILURES (1 layout bug, several minor wording/format issues). No privacy or access failures.

## What passed (checked against the database)
- Logged out: `/booth/x`, `/sponsor/[id]`, `/report`, `/me` and the organizer report all redirect to `/login`, and the booth keeps `?next=`. `leads.csv` returns 404.
- Booth: the share card appears only after check-in. "Share" stays disabled until the 18+ box is ticked. The phone box starts unticked. Buttons are 46px tall. A double-click on Share made exactly 1 row.
- Shared without the phone tick (the account has phone 9876500000): the DB phone is NULL and the CSV phone cell is empty. Re-sharing with the phone ticked stored the phone, set `withdrawn_at` to null and gave a new `shared_at`.
- Kannada/Hindi course text (`ಬಿ.ಕಾಂ 2nd year / बी.कॉम`) is stored and shows correctly on the dashboard and in the CSV.
- Stop sharing works from `/me` and from the booth. It nulls name/phone/college/course in the DB, and the email moves to the sponsor's "Withdrawn" card and to the CSV as `withdrawn`. The `/me` section hides once the list is empty.
- CSV: `volt-energy-leads.csv` with a UTF-8 BOM. Columns: `status,name,email,phone,college,course_year,shared_at_ist,withdrawn_at_ist`. A name of `=HYPERLINK(...)`, a college of `+Kannada ಕಾಲೇಜು` and a course of `@SUM(1+1)` are all prefixed with `'` and quoted.
- Offer line: saved as given, and shown as plain text on the booth (a `=HYPERLINK` string is not interpreted).
- Report numbers match the DB. Ticket holders 135, footfall 83, verified visits 74 (75 total), leads 10, deal ₹5,00,000, cost per attendee 50000000/83, per visit ₹6,756.76, per lead ₹50,000, visit rate 89%, lead rate 14%, peak 10 AM (14). Colleges match exactly (22/21/17/14). The zero sponsor (Chai) shows "—" for per-visit, per-lead and lead rate. Both SAMPLE and "in progress" badges are shown.
- Print: A4, black on white, no nav or buttons, 3 pages (`report-print.pdf`).
- Access: student, organizer and another sponsor (Chai) are redirected away from Volt's `/sponsor/[id]` and `/report`, and get 404 on `leads.csv`. organizer2 (not this fest) gets 404 on the organizer report. The organizer report and sponsors tab show no names or emails of leads.
- No horizontal scroll on any page at 390 or 1280.

## Failures
1. **Organizer sponsors tab, 390px: booth-visit and lead counts are cut off.** Log in as organizer@ at 390px and open `/organizer/[neon]/sponsors`. Expected: each row shows "· N booth visits · N leads" (plan, Screen 4). Actual: the line is `truncate` (scrollWidth 322 > clientWidth 187), so it shows "sponsor@thefest.in · ₹5,00,000…" and the counts can't be seen on a phone. The new "Report" button is also 36px tall (under 44). Screenshot `16-organizer-sponsors-tab.png`. File: `src/app/organizer/[festId]/sponsors/page.tsx:41-43`.

## Minor (wording / format, should fix)
2. **Money with one decimal: "₹6,024.1"** (cost per verified attendee, the headline selling number). It should read ₹6,024.10, or be rounded to whole rupees for per-head figures. Source: `rupees()` in `src/lib/format.ts` (no minimumFractionDigits), shown in `SponsorReportView.tsx`. Screenshot `07-report-top.png`.
3. **Organizer tab shows "75 booth visits" (all), while the report and sponsor dashboard lead with 74 verified.** The same sponsor gets two different numbers. `organizer/[festId]/sponsors/page.tsx:41`.
4. **Lead rate mixes bases.** Leads (10) include a student with no gate-scanned ticket, but the rate is "leads ÷ verified visits" (74). This can overstate the rate and could exceed 100% in odd cases. Count verified leads for the rate, or say so in "How we counted". `src/lib/sponsor-report.ts`.
5. **"75 incl. unverified" / "75 including unverified"** reads as if 75 were unverified. Suggest "75 in total (1 unverified)". `sponsor/[id]/page.tsx:83`, `SponsorReportView.tsx:74`.
6. **Booth shared state says "{brand} is told to delete your details"** while the student is still sharing. It reads as if deletion has already happened. Suggest "If you stop, {brand} is told to delete your details." `booth/[code]/page.tsx:67`.
7. **Share card doesn't show the actual values** (the name, email and college that will be sent). The plan asked for them read-only, so a student with an old name or college can't see what goes to the brand. `booth/[code]/page.tsx` / `LeadForms.tsx`.
8. **Sponsor leads card at 390px cuts off course/year** ("Placeholder University · B.E. …", "· M…"). The offer placeholder is clipped too ("…20% off coupor"). Screenshot `06-sponsor-leads-card.png`.
9. Seed only: the demo visits/leads are timestamped later today (up to 6:59 pm while it was 12:40 pm), so the demo shows leads "from the future" and a withdrawal at 6:19 pm. `scripts/seed.mjs:233-243` (`at(0, 10+rand(9))`).
10. Risk note: the SAMPLE label is also triggered when the fest *organizer's* email ends in `@thefest.in`. If Harshith runs a real fest from a @thefest.in account, its real report would say SAMPLE. `src/lib/sponsor-report.ts` (sample expr).

## Screenshots reviewed
Folder: `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/leads-shots/`. Each was checked for overlap, clipping, sideways scroll and contrast.
- 01/02 booth before check-in / share card (390): layout fine, notice readable, disabled button visibly muted.
- 03 booth shared, 14 booth with offer (Kannada renders), 15 after stop (success banner): fine.
- 04 `/me` shared brands, 13 after stop: fine, the section hides.
- 05 sponsor dashboard (390), 06 leads card: course truncation (#8).
- 07 report top, 08 audience (390): fine apart from ₹6,024.1 (#2).
- 09 print media (390), 12 print media (1280), report-print.pdf pages: clean black on white, no nav.
- 10 sponsor dashboard, 11 report (1280): fine.
- 16 organizer sponsors tab (390): counts truncated (#1). 19 desktop: counts visible.
- 17 organizer report, 18 zero-visit sponsor report: "—" shown correctly, no contacts.

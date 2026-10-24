# Sponsor leads + ROI report: research brief and lean plan (Oct 18, 2026)

## 1. Goal
Sponsorship is one of Harshith's two first money sources (2 sponsors per fest at ₹1–₹4 per attendee each). To sell it and get
sponsors back next year, a brand needs **proof** and **people**. Proof means an automatic, honest report built from real gate
scans and booth check-ins. People means students who **chose** to give the brand their contact details at the booth.
Build both into the existing booth QR and sponsor portal. Organizers can print or share the report. Nothing new to pay for,
and the app must stay deploy-ready.

## 2. What Harshith already decided
- "Sponsors (see proof of their return)" is one of the four user groups (Product).
- Revenue: "sponsorship, 2 sponsors per fest at ₹1–₹4 per attendee per sponsor … Ticket commission and sponsorship are the first priorities."
- Direction (Oct 18): "Next build, his pick: **sponsor lead capture + sponsor ROI report**." Keep the app "complete and deploy-ready".
- Analytics are "refreshed when the page opens (not live)" (organizer analytics decision). Reuse this. The sponsor detail page already auto-refreshes every 20 s during a live fest, so keep that as it is.
- Plans stay lean because Harshith's weekly limit is tight.
- Mobile first, dark theme, existing fonts and colours. Every feature is tested in a real browser (`tests/run-e2e.sh`).
- Smart QR brief precedent: personal data shared only with an explicit tick plus "I am 18 or older". No 18+ tick means it can't be saved.

## 3. Findings
**Existing code (what we build on)**
- `sponsors` (fest_id, email, brand, tier, amount_paise, booth_code) and `sponsor_visits` (sponsor_id, user_id, created_at, unique pair) are in `db/schema.sql`.
- `/booth/[code]` makes the student log in, then a single tap records the visit (`actions.ts` → `recordBoothVisit`). Any logged-in user can check in, **even without a ticket to that fest**, so today's visit count isn't fully "verified".
- `/sponsor` and `/sponsor/[id]` already show ticket holders, footfall (`tickets.status='used'`), booth visits, cost per visit, visits by hour and top-6 colleges. There's **no small-group suppression** on colleges, though the sponsor-report skill requires groups under 5 to be merged into "Other".
- The organizer sponsors tab (`/organizer/[festId]/sponsors`) shows only visit counts. The organizer CSV export (`/organizer/[festId]/export/route.ts`) already quotes cells and neutralises `= + - @` formula injection, so reuse that helper.
- `users` has name, email, phone (optional), college. There's **no course/year** field.
- Privacy page currently promises: "Sponsors see totals, not your name or email." It **must be updated**, because leads change that for students who opt in.
- Footfall counts every `tickets.status='used'`. The Builder must check whether lunch/stay add-ons (v2.3) create ticket rows. If they do, footfall must count entry tickets only.
- The skill `thefest-sponsor-report` already defines the report: headline numbers, footfall by day, peak hour, booth visits by hour, visit rate, cost per visit and per verified attendee, audience top 5–8 with <5 shown as "Other", a "How we counted" section, a SAMPLE label for seed data, and no estimates.

**DPDP Act 2023 / Rules 2025**
- Consent must be "free, specific, informed, unconditional and unambiguous with a clear affirmative action", limited to the data needed for the purpose. It can be withdrawn at any time, as easily as it was given. After withdrawal, the fiduciary must stop processing "within a reasonable time" and make its processors stop too (s.6(1), 6(4), 6(6)). [DPDP wiki s.6](https://dpdp.myndsolution.com/wiki/act/section-6-consent/)
- A notice must give an itemised list of the data, the specific purpose, a link to withdraw, and how to complain to the Data Protection Board (Rule 3). [dpdpa.com Rule 3](https://www.dpdpa.com/dpdparules/rule3.html)
- Timeline: the Rules were notified Nov 13–14, 2025. Notice, security and data-principal-rights duties apply from **May 13, 2027**. [JSA](https://www.jsalaw.com/?p=55573) We build to the rule now anyway, because it costs little and it's a selling point.
- Once a student shares, the brand holds the contact as its **own** data fiduciary. We can't delete it from the brand's spreadsheet. We can only tell the brand, which must then honour the withdrawal (contract/terms). *This is my reading, not legal advice.*

**Competitors**
- KonfHub Lead Capture: booth staff scan the attendee badge and get name, email, phone, company and custom fields. They can add notes and export. The organizer controls which fields are shared. **There's no consent step at scan time.** [KonfHub help](https://help.konfhub.com/apps/lead-capture-app.md)
- HLTH (event app): connecting with an exhibitor counts as consent. Attendees can opt out or limit fields. Leads can be downloaded in real time and stay live for a week after the event. [HLTH help](https://hlth.helpscoutdocs.com/article/86-lead-generation)
- **Our edge is that the student opts in** ("student-chosen leads"), and the report is built from verified gate scans. This is cleaner under DPDP than badge scanning, and the sponsor can say every lead is warm.

## 4. Recommendation (lean v1)

### Data: one migration, `v2.5` (append to `db/schema.sql`, idempotent)
```sql
alter table sponsors add column if not exists lead_offer text;          -- optional "what you get", ≤120 chars, set by sponsor
create table if not exists sponsor_leads (
  id            bigserial primary key,
  sponsor_id    uuid not null references sponsors(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  name          text,               -- snapshot at share time (null after withdrawal)
  email         citext not null,    -- kept after withdrawal ONLY so the brand knows whom to delete
  phone         text,               -- only if the student ticked "include my phone"
  college       text,
  course_year   text,               -- optional free text, ≤60 chars, typed at the booth
  notice_version text not null,     -- e.g. 'lead-v1'
  shared_at     timestamptz not null default now(),
  withdrawn_at  timestamptz,
  unique (sponsor_id, user_id)
);
create index if not exists sponsor_leads_sponsor_idx on sponsor_leads(sponsor_id, shared_at desc);
alter table sponsor_leads enable row level security;
```
- Sharing again after withdrawing means an upsert that refills the fields, sets `withdrawn_at = null` and takes a new `shared_at`.
- Withdrawing sets name/phone/college/course_year to null and `withdrawn_at = now()`. The email stays only for the brand's "remove" list.
- Applying v2.5 to production `thefest` / preview `thefest-preview` **needs Harshith's OK** (see Questions). The code must work locally first.

### Screen 1: Booth page `/booth/[code]` (student, 390px first)
- The check-in tap works exactly as today. Sharing is **never** required to check in.
- After check-in, a second card says: **"Want {brand} to contact you?"** It shows the `lead_offer` line if one is set.
  - Notice text (itemised): "{brand} will get: your name, email, college[, phone][, course/year]. They'll use it only to contact you
    about {brand}'s products, offers and opportunities. THE FEST doesn't sell your data. You can stop sharing any time from this
    page or My account. Complaints: Data Protection Board of India." Plus a link to the privacy page.
  - Fields: name, email and college are read-only from the account. "Also share my phone" is an unticked box, shown only if the account has a phone. "Course & year" is an optional text box.
  - The required tick **"I am 18 or older"** is unticked. The button "Share my contact with {brand}" is disabled until it's ticked, and the server checks it too.
  - Sharing also records a booth visit if there isn't one yet (one server action, one transaction).
- Shared state: "✓ Shared with {brand} on {date}" and a **"Stop sharing"** button that takes one tap plus one confirm.
- If the user isn't logged in, the current login redirect stays as it is.

### Screen 2: My account `/me` (student)
- New section "Brands you shared your contact with". It lists brand, fest and date, each with a **Stop sharing** button. It's hidden when the list is empty.

### Screen 3: Sponsor portal `/sponsor/[id]` (sponsor owner only: same email check as today)
- Stats row: add **Leads** (active count) and **Cost per lead**. Visits become "Booth visits (verified)", counting only visitors who hold a gate-scanned entry ticket at this fest. Show the total including unverified visits in small text.
- **Leads** card: the newest 50 active leads (name, college, course/year, time). Email and phone go in the CSV only, so screenshots are cleaner. Add a **Download leads (CSV)** button at `/sponsor/[id]/leads.csv` with the columns name, email, phone, college, course_year, shared_at_IST. Reuse the formula-injection escaping and BOM.
- **"Withdrawn: remove from your lists"** card: emails plus withdrawn date. It's included in the CSV as a second file `/sponsor/[id]/withdrawn.csv`, or as a `status` column. The Builder picks whichever is simpler, but it must be visible.
- Small form: "What students get for sharing" (`lead_offer`, ≤120 chars).
- A line above the download: "By downloading you agree to use these contacts only for the purpose shown to students and to delete anyone listed as withdrawn."
- A **View / print report** button leads to Screen 4.

### Screen 4: ROI report `/sponsor/[id]/report` and `/organizer/[festId]/sponsors/[sponsorId]/report`
- One shared server component, `src/lib/sponsor-report.ts` (queries) plus a report view. It's computed when the page opens and needs no new table.
- It's print-friendly: a light print stylesheet and a "Print / Save as PDF" button that reuses `booth/[code]/print/PrintButton.tsx`. To share it, the organizer saves the PDF and sends it. **No public links in v1.**
- Sections follow the skill:
  1. **Summary:** ticket holders, verified footfall, verified booth visits, leads, and **cost per verified attendee** (deal ÷ footfall, which is Harshith's ₹1–₹4 pricing unit), plus cost per visit and cost per lead. Show "—" when the divisor is 0.
  2. **Footfall:** by day (IST), and peak entry hour from gate admissions.
  3. **Booth:** visits by hour (IST), visit rate (visits ÷ footfall) and lead rate (leads ÷ visits).
  4. **Audience:** top 8 colleges of checked-in attendees. Groups under 5 merge into "Other". **Aggregates only**, with no names, even in the organizer version.
  5. **How we counted:** plain text on what each number means.
- Header: brand × fest, dates and "Generated {IST time}". During the fest it shows a "Fest in progress: numbers will change" badge. Seed/demo fests (emails `@seed.thefest.in` / demo `@thefest.in`) get a **SAMPLE** label.
- Money is stored in paise and shown as ₹ with Indian grouping using the existing `rupees()`. Use integer maths and round once at display.
- Organizer sponsors tab: each sponsor row gets a "Report" button, and the leads **count** appears next to visits. Organizers never see lead contacts.

### Also change
- `src/app/legal/privacy/page.tsx`: replace "Sponsors see totals, not your name or email" with: totals by default, and your contact **only if you tap Share at that brand's booth**, withdrawable from My account. Add the Board complaint line. Bump the "last updated" date.
- `src/app/legal/terms/page.tsx` §6 Sponsors: add that a sponsor uses leads only for the shown purpose, deletes withdrawn contacts, and doesn't resell them.
- Make the existing `/sponsor/[id]` college list apply the <5 → "Other" rule as well.

### Build steps (Builder)
1. Schema v2.5 plus `schema-check.ts` awareness (the app should say "run v2.5" if the table is missing, matching how v2.3/2.4 were handled).
2. `sponsor-report.ts` queries, then the report page with both routes and access checks.
3. Booth share/withdraw server actions with server-side validation (18+ tick, ≤60/≤120 char limits, booth code regex), followed by the booth UI.
4. `/me` shared-brands list, the sponsor leads card with CSV and withdrawn list, and the `lead_offer` form.
5. Privacy/terms text, then add demo seed rows (a few leads and one withdrawn) to `db/demo-seed.sql`.
6. Tests: a new `tests/sponsor_leads.py` hooked into `run-e2e.sh`, plus a sponsor block extension in `e2e.py`.

## 5. Acceptance criteria
1. A student can check in at a booth without sharing. Check-in still takes one tap.
2. The share button stays disabled until "I am 18 or older" is ticked. A forged POST without the tick is rejected by the server and no row is created.
3. The phone box is unticked by default. If it's left unticked, the CSV phone cell is empty even when the account has a phone.
4. After sharing, the booth page shows the shared state. Sharing twice creates no duplicate (one row per student per sponsor).
5. "Stop sharing" works from the booth page **and** from `/me`. Afterwards the lead is gone from the sponsor's active list, CSV and Leads count, and its email appears in the sponsor's "Withdrawn" list.
6. Re-sharing after a withdrawal restores the lead with a new `shared_at`.
7. A sponsor sees leads only for their own sponsorships. Another sponsor account, an organizer, a student or a logged-out user gets 404/redirect on `/sponsor/[id]`, `/leads.csv` and `/report` for that sponsor.
8. Organizers see lead **counts** and the report, never names, emails or phones (the organizer report and sponsors tab are checked).
9. CSV opens in Excel with correct Indian characters (BOM), and cells starting with `= + - @` are neutralised.
10. Report numbers match the database. Footfall = gate-scanned entry tickets. Verified visits = visitors holding a used ticket for that fest. Cost per verified attendee = `amount_paise ÷ footfall`, shown with ₹ Indian grouping (₹5,00,000 deal ÷ 1,000 footfall shows ₹500). Every divide-by-zero shows "—".
11. Any college with fewer than 5 attendees is merged into "Other" in both the sponsor detail page and the report.
12. Hours and days are in IST.
13. A demo/seed fest report shows "SAMPLE". A fest in progress shows the "numbers will change" badge.
14. The report prints cleanly: the print button gives readable black-on-white A4 with no nav bars.
15. At 390px width the booth page, `/me` section, leads card and report have no horizontal scroll, and buttons are at least 44px tall.
16. The privacy page no longer says sponsors never see names. It describes opt-in sharing and withdrawal.
17. The app starts and runs with v2.5 missing on an old database (clear message, no crash), and the full `run-e2e.sh` passes.

## 6. Out of scope (v1)
- Booth staff scanning students' ticket QRs, and notes/ratings on leads (KonfHub-style). Ours is student-initiated only.
- Public shareable report links, emailed PDFs, scheduled reports, and comparisons with the brand's other fests.
- Pushing leads to sponsor CRMs or WhatsApp. Leads expire after a set time (a retention job comes later, before May 2027).
- Under-18 sharing with parental consent. Under-18 students can still check in but can't share.
- Impressions/reach estimates or any number not recorded by THE FEST.
- Adding course/year to user profiles (it's typed at the booth only).

## 7. Questions for Harshith
1. **Apply the v2.5 table (`sponsor_leads`) to production `thefest` and preview `thefest-preview`?**
   Recommended: **Yes, both**, after the tests pass (same as v2.4). The app works without it, but leads can't be saved.
2. **Should the organizer report show the deal amount and cost metrics?** Recommended: **Yes.** The organizer set the deal, and the sponsor knows it. Cost per verified attendee is the number that sells your ₹1–₹4 pricing.

# THE FEST — Harshith's brief

The single source of truth for **what Harshith has asked for and decided**. The Supervisor checks every
piece of work against this file. Only Harshith's own words or decisions go here. Claude's suggestions he
hasn't accepted go under "Open decisions", never under "Decided".

When Harshith gives a new instruction or makes a decision, add it here (with the date) in the same change.

## Product
- THE FEST is an operating system for Indian college fests — "the Shopify/Stripe for college fests".
- Four groups use it: **Students** (discover fests, buy tickets), **Organizers** (run the fest),
  **Sponsors** (see proof of their return), **Gate scanners** (check people in). An admin panel for Harshith sits on top.
- Real full web app, not just a front end (decided Oct 2026). Stack chosen by Harshith: **Next.js + Supabase**, all four portals at once.
- Design: dark theme, Bebas Neue + Space Mono + DM Sans, yellow `#FFE034` accent. Mobile first.
- Role is picked once and remembered, with a way to switch. **The gate scanner always asks to log in again.**
- Domain target: thefest.in. Hosting: Vercel. Database: Supabase.

## Money
- Started on Razorpay test mode. Harshith **does not want to pay gateway fees** where avoidable, so:
  - **Cashfree** is the main gateway (0% offer), Razorpay the fallback.
  - **Zero-fee UPI straight to the fest's bank account** must be supported, with payments verified and confirmed automatically
    (UTR entry, bank SMS, statements, forwarded bank emails).
- Commission: Harshith's plan is **₹15–₹25 per ticket** (default ₹15 flat). Built as a setting; percentage mode also available.
- Revenue plan (Harshith's targets, not confirmed): ticket commission (months 1–3) → sponsorship, 2 sponsors per fest at
  ₹1–₹4 per attendee per sponsor (months 2–4) → organizer subscriptions (4–6) → sponsor subscriptions (6–9) →
  marketplace commission (9–12) → premium analytics (Year 2) → virtual booths (Year 2+).
  Ticket commission and sponsorship are the first priorities.
- Expansion: Bengaluru (months 1–6) → Karnataka (7–12) → all-India (Year 2).
- Financial model uses **Harshith's own assumptions** ("I will give you my assumptions") — never replace them with ours; add
  our estimates as separate, clearly labelled scenarios.

## How work is done (standing rules)
- **Don't push to GitHub for every small change** — batch and push only meaningful updates.
- Never merge to `main`; work goes to the `full-app` review branch.
- Never change Harshith's Supabase, Vercel, Cashfree or Razorpay accounts without him.
- Decisions that need Harshith are written down and asked, not guessed.
- Explain results in plain language; Harshith reads on his phone.
- Every feature is tested in a real browser before it ships (`bash tests/run-e2e.sh`).
- Work order (Oct 17, 2026): **Researcher → Builder → Supervisor → Tester → fixes**, repeated until clean. See `docs/team/`.

## Deployment (Oct 17, 2026)
- Harshith: "build it for deployment … no longer just a prototype but a fully functional web app."
- Old Supabase project couldn't be restored (paused > 400 days); a new free project **thefest** (Mumbai) was created with his OK
  and the tables set up. Harshith said "Run it" for the table setup.
- Hosting stays Vercel; there is no Vercel connection here, so Harshith sets Vercel settings himself from our checklist.

## Scanner: one QR, different counters (Oct 17, 2026)
- One QR per ticket. What a scan shows depends on **who is scanning**: the organizer assigns each volunteer a counter
  (Gate / Lunch / Stay); a lunch volunteer only sees and uses lunch coupons, the hostel desk only sees stay.
- The QR itself stays the same signed ID; lunch/stay are kept on the ticket in our database, not inside the QR.
- **Lunch**: the organizer sets the rules beforehand (which days / how many).
- **Stay**: check-in **and** check-out.
- Lunch and stay can be **included with a ticket type and also sold as add-ons** (both).
- No other counters for now (no kits/workshops/VIP). Day passes and re-entry not requested.
- Coordinator's choice (Oct 17, 2026), waiting for Harshith's yes: when an organizer refunds an entry ticket, its paid
  lunch/stay add-ons are **refunded automatically** in the same refund (money returned once) — the student can't use them any more.
- Efficiency: Harshith's weekly limit is tight — plans lean, few agent rounds, full team only for big features.

## Smart QR (Oct 18, 2026)
- Harshith: "the trick here is not just about the QR code itself, but the scanner." A normal phone scanner must show
  **the basic details**; THE FEST scanner reveals **more, depending on who is scanning**. He wants it unique and patentable.
- Harshith said "Yess" to the plan: QR becomes a normal web link → public page (fest, date, holder first name, ticket type,
  valid/verified, nothing private); sealed sections inside the link (after `#`), one per role (gate / lunch / stay /
  first aid (student opt-in) / organizer), opened **offline** only by a scanner of that role; live status added when
  online; optional rotating anti-screenshot QR. Plus a 2-page invention note for a patent attorney.
- Patent: prior art exists (Denso SQRC public/private QR) — novelty is the combination; **don't show it publicly before
  filing** a provisional application. Not legal advice; attorney to judge.
- Harshith's answers (Oct 18, 2026, after the build started):
  1. Patent: "Don't care about patent" — push and deploy normally; the public repo is fine (no invention note needed).
  2. First aid: "Skip first aid for now" — remove the first-aid card/opt-in, `medical_profiles` table (never shipped),
     first-aid scanner role and related UI. Gate / lunch / stay / organizer sections stay.
  3. Old screenshots at the gate: **warn only** (as built), do not block.
  4. Database: "Yes, both" — add `fests.qr_epoch` (v2.4) to production `thefest` and preview `thefest-preview`
     (applied Oct 18, 2026).

## Direction (Oct 18, 2026)
- Harshith: "I can't get this live for now and all I can do is build this fully and have it ready deployable."
  Going live is a later step; keep the app complete and deploy-ready (settings pasted in + deploy).
- Next build, his pick: **sponsor lead capture + sponsor ROI report**. Later candidates (not yet chosen): quick fest
  setup / copy last year's fest, Kannada/Hindi scanner, live crowd view, WhatsApp (built switched off), deploy pack.

## Sponsorship requests (Oct 18, 2026)
- Harshith: "make it so that they (org) can send sponsorship request [and] the sponsors request for the sponsorships."
  Two-way: organizers send sponsorship requests/pitches to brands; brands request to sponsor fests. (This is the start of
  the marketplace in his revenue plan.)
- His answers (Oct 18, 2026): add v2.6 (brand profiles, sponsor_requests, fests.open_to_sponsors) to **both** Supabase
  databases once tests pass — "Yes, both". Fests are **hidden from brands until the organizer switches on**
  "Show this fest to brands". Contacts hidden until a request is accepted; money settled off-platform in v1.

## Planning only (Oct 18, 2026)
- Harshith: "from here on out it's just planning … don't start to build anything until I say so — just pure planning,
  because I have no credit left for usage." No building, no agent runs, no pushes until he explicitly says to build.

## Organizer plan (Oct 18–20, 2026) — PLANNED, not built
- Harshith: work one role at a time, Organizer first. Kannada/Hindi for volunteers: **no**.
- Team & Roles (approved plan, Oct 20): organizers assign roles to students — Co-organizer, Event head (one competition),
  Judge, Finance lead, Sponsorship lead, Media/PR, Volunteer (Gate/Lunch/Stay), Desk volunteer. Fixed roles in v1 (no
  custom roles); owner and co-organizers can assign, only the owner adds co-organizers; one student may hold several
  roles; optional limit to one event/day; activity log; pending until email confirmed. Comes before Competitions.
- Organizer "Must" list (proposed): Competitions, Digital certificates, Quick setup / copy last year, Volunteer shifts.
  Should: committee budget, vendor marketplace (certificate makers, medal makers, canopy etc.), feedback/polls, crowd view.

## Decided features (built)
- Ticketing with signed QR codes, seat holds, gate scanning that admits each ticket once.
- Organizer dashboard, schedule, volunteers, announcements, sponsors, CSV export.
- Commission setting; Cashfree + Razorpay; zero-fee bank UPI with auto-verification.
- Admin panel (fest approval, payouts, order search), refunds and fest cancellation.
- Password reset, email confirmation, ticket transfer, co-organizers, policy pages (drafts).
- **Organizer analytics** tab — Harshith chose organizer analytics first, **refreshed when the page opens (not live)**.

## Sponsor leads (Oct 18, 2026)
- The organizer types the sponsor's login email when adding a sponsor; trusting that is OK for v1 (no brand-side
  confirmation of sponsor emails yet).
- The organizer's copy of the sponsor report shows the deal amount and cost figures: yes.
- Harshith approved adding v2.5 `sponsor_leads` (+ `sponsors.lead_offer`) to **both** Supabase databases (production
  `thefest` and `thefest-preview`) once tests pass: "Yes, both".
- Built rules from review 1: a sponsor that has any leads (even withdrawn) can't be removed; lead rate = leads ÷ all
  booth visits; the SAMPLE badge shows only on the seeded demo fests (organizer@ / organizer2@thefest.in or
  @seed.thefest.in organizers).

## Open decisions (waiting for Harshith)
1. Commission: ₹15 flat, or ~5% with ₹8 minimum / ₹30 maximum?
2. Add `RESEND_API_KEY` and `ADMIN_EMAILS` in Vercel.
3. Fill business details on the policy pages; lawyer/CA review.
4. Should co-organizers be allowed to refund? (Currently owner only.)
5. Next analytics piece: sponsor analytics, his own business dashboard, or visitor tracking?
6. Backups (Oct 17, 2026): GitHub only runs the backup job from the default branch (`main`). Options: (a) add just
   `.github/workflows/db-backup.yml` to `main`, (b) make `full-app` the default branch, (c) Supabase Pro (daily backups).
   Until he picks, there are **no backups** of production.
7. Preview database (Oct 17, 2026): may we create a second free Supabase project (e.g. `thefest-preview`) so Preview test
   payments never touch the real database? (Not created; ask first.)
8. Coordinator's choices made for him on Oct 17, 2026, waiting for his yes: card checkout OFF on thefest.in until Cashfree
   live keys exist (bank UPI and free tickets still work); functions run in Mumbai (bom1); login protection kept in the
   database, per email + network (10 tries / 15 min) with a looser per-email cap (50 / 15 min); production is assumed
   whenever a production build runs on a non-local database (fails safe); error log keeps ~30 days / 5,000 rows.

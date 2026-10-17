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

## Decided features (built)
- Ticketing with signed QR codes, seat holds, gate scanning that admits each ticket once.
- Organizer dashboard, schedule, volunteers, announcements, sponsors, CSV export.
- Commission setting; Cashfree + Razorpay; zero-fee bank UPI with auto-verification.
- Admin panel (fest approval, payouts, order search), refunds and fest cancellation.
- Password reset, email confirmation, ticket transfer, co-organizers, policy pages (drafts).
- **Organizer analytics** tab — Harshith chose organizer analytics first, **refreshed when the page opens (not live)**.

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

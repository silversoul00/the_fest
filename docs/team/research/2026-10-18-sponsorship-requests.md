# Sponsorship requests (two-way) — research brief + lean plan
Date: 2026-10-18 · Researcher

## 1. Goal
Let organizers pitch brands, and let brands ask to sponsor fests, inside THE FEST. When a request is accepted it turns
into a normal sponsor (the existing `sponsors` row), so the sponsor portal, booth QR, leads and ROI report work with no
extra steps. Brands choose fests using a media kit built from THE FEST's real ticket data rather than PDF claims. This is
the start of the marketplace in Harshith's revenue plan. Money still changes hands outside the platform in v1.

## 2. What Harshith already decided
- "make it so that they (org) can send sponsorship request [and] the sponsors request for the sponsorships." Two-way.
  This is the start of the marketplace in his revenue plan. (BRIEF, Sponsorship requests, Oct 18)
- Revenue plan: "Ticket commission and sponsorship are the first priorities". Sponsorship targets 2 sponsors per fest at
  ₹1–₹4 per attendee per sponsor. Marketplace commission comes later (months 9–12). (BRIEF, Money)
- Sponsor leads: "The organizer types the sponsor's login email when adding a sponsor; trusting that is OK for v1."
  "The organizer's copy of the sponsor report shows the deal amount": yes.
- Process: never change Supabase without his OK. v2.5 was approved for both DBs separately, so v2.6 needs its own OK.

## 3. Findings
- Existing code: `sponsors(fest_id, email, brand, tier, amount_paise, booth_code)` with unique `(fest_id, email, brand)`.
  `addSponsor` (src/app/organizer/actions.ts:272) uses `ownFest(fd)`, so co-organizers can add sponsors. The sponsor
  dashboard shows rows where `s.email = user.email and user.verified`. Role `sponsor` already exists in signup.
  `sendEmail` writes to `email_outbox` (it is logged when there's no Resend key, so tests can read it).
  `festAnalytics` already has college breakdown and host-college share. `schema-check.ts` covers readiness for new tables.
- SponsorMyEvent: sponsors browse without a profile and filter by location, category, audience and budget. Organizers
  list packages. Each package has a "Negotiate" button that opens internal messaging. The platform took 10% of the
  sponsor fee, only when a deal closed on-platform. Source is a 2015 review, so details may be out of date.
  [Skift review](https://meetings.skift.com/reviews/sponsormyevent-matchmaking-marketplace-events-sponsors-review/)
- A typical Indian fest proposal uses tiers Title ₹4L / Co ₹2.5L / Powered by ₹1.7L / Associate ₹90k / stalls
  ₹20–30k. Deliverables are emcee mentions, social posts and stalls. Audience figures ("17,000+ footfall", "50M+
  impressions") are self-reported and unverified. That gap is our differentiator: verified ticket and gate numbers.
  [SIIB Ignisense 2025 proposal](https://siib.ac.in/wp-content/uploads/2025/01/Official-Sponsorship-Proposal-Ignisense-2025.pdf)
- Other marketplaces also use a "match + message + deal" flow
  ([Sponsorfied/BetaKit](https://betakit.com/sponsorfied-launching-marketplace-for-brand-sponsorships/)).
  KonfHub, Townscript and Unstop: not verified in this pass, so I make no claims about them.
- Uncertain: whether "₹1–₹4 per attendee" is a price guide for brands or THE FEST's own take. v1 doesn't need to settle
  this because money is off-platform.

## 4. Recommendation (v1, lean)
**Data (v2.6, additive only):**
- `brand_profiles`: `user_id` pk→users, `brand` (2–80 chars), `category` (fixed list: food & beverage, tech, edtech,
  fashion, finance, telecom, other), `budget_min_paise`, `budget_max_paise`, `cities text[]` (≤5),
  `about` (≤300 chars), `listed bool default false` (opt-in to the directory), `created_at`.
- `fests.open_to_sponsors bool default false`. The organizer opts in per fest.
- `sponsor_requests`: `id`, `fest_id`, `brand_user_id`, `direction` ('org_to_brand' | 'brand_to_org'), `brand`
  (snapshot), `tier`, `amount_paise ≥ 0`, `deliverables` (≤600 chars), `message` (≤1000 chars), `status` ('sent' |
  'accepted' | 'declined' | 'withdrawn'), `reply` (≤300 chars, optional decline note), `sent_by` user,
  `decided_by`, `sponsor_id` (set on accept), `created_at`, `decided_at`.
  - Partial unique index on `(fest_id, brand_user_id) where status='sent'`: only one open request per pair.
  - Index on `(brand_user_id, created_at)` and `(fest_id, created_at)`.
  - Expired is not a stored status. Treat a request as "Expired" on read when `fests.ends_on < today` or the fest is
    cancelled. It can't be accepted.
- `lib/schema-check.ts`: add the new tables and columns. Also add a `requestsReady()` guard like `leadsReady()`.

**Brand screens (role `sponsor`, verified email required to send, accept or edit):**
1. `/sponsor/profile`: create or edit the brand profile, with a "List my brand for organizers" tick. A profile is
   required before browsing to send.
2. `/sponsor/fests`: "Find fests". Shows fests with status `live`, `open_to_sponsors`, and `ends_on ≥ today`. Filters:
   city, category, month. Each card shows name, college, city, dates and "N tickets sold".
3. `/sponsor/fests/[festId]`: media kit built from real data. Shows dates, venue, capacity, tickets sold, colleges
   represented (count), host-college share %, and the top colleges list (any college with fewer than 5 attendees
   is folded into "Other"). If the same organizer ran an earlier fest, it shows "Last fest: X checked in at the gate
   (verified by THE FEST)". Label everything "Verified by THE FEST ticketing". No student names and no emails.
   Button: "Request to sponsor" opens a form with tier (Title / Powered by / Associate / Partner, same as today),
   amount ₹, deliverables wanted and message.
4. `/sponsor/requests`: Received and Sent lists with status chips. Received requests have Accept and Decline (with an
   optional note). Sent requests have Withdraw. The `/sponsor` home shows a count badge for open received requests.

**Organizer screens (`/organizer/[festId]/sponsors`, owner and co-organizers, same rule as addSponsor):**
5. A toggle: "Show this fest to brands (media kit)". Below it, a preview link to the media kit.
6. A "Find brands" section (or a `?tab=brands` subpage) listing `listed` brand profiles: brand, category, budget range
   and cities. Filters: category and city. Button: "Send request" with the same form fields.
7. A "Requests" section with Received and Sent, each with Accept / Decline / Withdraw. The tab label shows a count of
   open received requests.

**Contact privacy:** before accept, neither side sees the other's email or phone. Brands see the fest and college
only. Organizers see brand profile fields only. On accept, the brand sees the organizer's email and the organizer sees
the sponsor email in the existing sponsors list. Free-text messages are not filtered (accepted risk, noted).

**Accept (one transaction):** `update sponsor_requests set status='accepted' ... where id=$1 and status='sent' and
<fest not ended/cancelled> returning *`. If no row comes back, show "This request was already answered". Then insert
into `sponsors` (fest_id, email = brand user's email, brand, tier, amount_paise, new booth_code) and store `sponsor_id`.
If the row already exists on `(fest_id,email,brand)`, link to the existing sponsor and don't create a duplicate. Only
the receiving side may accept. The brand logs in with its existing account, so no invite link is needed. Email both
sides with a link: brand to `/sponsor/[id]`, organizer to the sponsors tab.

**Notifications:** in-app count badges (computed on page load, no realtime). Emails via `sendEmail`: new request to the
recipient (brand user's email, or fest owner plus co-organizers), plus accepted and declined messages to the sender.
No email is sent on withdraw. Emails never contain the other party's contact details before accept.

**Anti-spam:**
- One open request per fest–brand pair.
- Up to 10 new requests per brand per 24h.
- Up to 20 new requests per fest per 24h (counted from the table).
- After a decline, the same sender can't re-send to the same pair for 7 days. A "counter-offer" is just decline with a
  note plus a new request.
- Server-side length caps on all fields. Amount is capped at ₹1 crore.

**Money:** off-platform. Show "Payment is settled directly between you; THE FEST doesn't take a cut yet" on the
accept screen. Commission later.

**Lean build plan (files):**
1. `db/schema.sql` v2.6 section (+ demo-seed: 2 listed brands, 1 open fest, 1 request each way).
2. `src/lib/sponsor-requests.ts` covering: limits, `mediaKit(festId)` (reuses analytics queries), `acceptRequest` tx,
   list queries.
3. `src/app/sponsor/{profile,fests,fests/[festId],requests}/page.tsx` + actions in `src/app/sponsor/actions.ts`.
4. `src/app/organizer/[festId]/sponsors/page.tsx` sections + actions in `src/app/organizer/actions.ts`.
5. `src/lib/mail.ts`: `notifySponsorRequest(id, event)`.
6. `tests/sponsor_requests.py` + a line in `tests/run-e2e.sh`.

## 5. Acceptance criteria
1. A brand without a profile is sent to `/sponsor/profile` when it tries to send a request. An unverified brand can
   browse but can't send or accept.
2. `/sponsor/fests` lists only fests that are `live`, `open_to_sponsors` and not ended. Draft, review, cancelled,
   ended and opted-out fests never appear, and a direct URL to their media kit returns 404.
3. Media-kit numbers match `festAnalytics` for the same fest. No student name or email appears, and colleges with
   fewer than 5 attendees are grouped into "Other".
4. A brand request appears in the organizer's Received list and the owner's email lands in email_outbox. An
   organizer request appears in the brand's Received list and the brand's email lands in email_outbox.
5. A second open request for the same pair is refused with a clear message. The 11th brand request in 24h and the 21st
   fest request in 24h are refused. A re-send within 7 days of a decline is refused.
6. Only the receiving side sees Accept and Decline, and only the sender sees Withdraw. Posting the action as the
   other side, another fest's organizer, a student or a logged-out user is refused server-side.
7. Accept creates exactly one `sponsors` row with the request's brand, tier and amount (paise exact, for example
   ₹12,345.50 becomes 1234550), plus a booth code. The fest then shows on the brand's `/sponsor` dashboard and its
   leads and report pages work.
8. A double-click or two tabs accepting at once still gives one sponsors row, and the second click shows "already
   answered". Accepting after the fest ends or is cancelled is refused.
9. Before accept, the organizer never sees the brand's email or phone (pages, emails and HTML source), and the brand
   never sees the organizer's. After accept, both do.
10. The brand directory shows only `listed` profiles. Unticking "listed" removes the brand at once, and any open
    requests stay.
11. Co-organizers can send and accept requests (same as addSponsor). Gate staff and volunteers can't.
12. At 390px every new page has no horizontal scroll, request cards stack, and buttons are at least 44px tall.
13. Without v2.6 in the DB, existing sponsor pages still load and the new sections show "not set up yet" instead
    of crashing.
14. The full `tests/run-e2e.sh` passes.

## 6. Out of scope
- On-platform payment or escrow, and commission on sponsorships.
- Multi-round counter-offers or a chat thread (decline-with-note plus a new request covers it).
- Contracts or e-sign, package builders and saved searches.
- Realtime and push notifications.
- Multiple brands per sponsor account, team seats for brands, and brand verification (GST/domain check).
- Admin moderation UI. Admin can query the DB for now.
- Self-reported stats such as social reach or impressions.

## 7. Questions for Harshith
1. May we add v2.6 (`brand_profiles`, `sponsor_requests`, `fests.open_to_sponsors`) to **both** Supabase databases
   once tests pass? *Recommend: yes, both (additive, same as v2.5).*
2. Should fests be hidden from brands until the organizer switches on "Show this fest to brands"?
   *Recommend: yes, off by default. Ticket numbers are the organizer's business data.*

# Sponsorship requests: manual browser pass (test 1)
Date: 2026-10-18 · Tester · HEAD b7e96a1 · local Postgres, fresh `db:seed --reset`, `next start` with DEMO_PAYMENTS=1

**Result:** FAILURES. One real bug (existing-sponsor accept) and three minor UX/wording issues. Everything else in the brief passed.

Release check: not re-run, as instructed. The builder reported `tests/sponsor_requests.py` at 72/72 with the full suite green.
No new automated test was added in this pass.

## What was walked through (390px, real browser, real clicks)
| Step | Result |
|---|---|
| New brand signs up (role Sponsor, Kannada name "ಕಿರಣ್ ಕುಮಾರ್"). Before verifying, media kit shows "Confirm your email" instead of the form | PASS |
| Verified via the email_outbox link. With no profile, media kit shows "Set up your brand profile first" | PASS |
| Profile with Hindi brand "चाय सुट्टा बार", Kannada city "ಮೈಸೂರು", budget min > max → "The lowest budget is more than the highest." Indian commas "2,00,000" accepted (₹25K–₹2L stored right) | PASS |
| Find fests shows only Neon Utsav and Kalaa. Clicking a card opens the media kit | PASS |
| Media kit numbers vs DB: Neon 135 tickets (52 valid + 83 used), 4 colleges 41/40/31/23, host 31/135 = 23%, last fest Goal Rush 64 gate scans. Kalaa 55, 19/16/10/10, host 35%. No names or emails | PASS |
| Amount ₹99,999,999,999 → "The amount can be at most ₹1 crore." | PASS |
| Send Title ₹12,345.50 by double-click → one row, amount_paise 1234550. Organizer2 email in outbox with no brand contact | PASS |
| Second send for the same pair → "There is already an open request between this fest and this brand…" | PASS |
| Before accept: organizer page HTML has no brand email or phone. Brand page has no organizer email | PASS |
| Organizer2 accepts in two tabs → one sponsors row (Title, 1234550, booth code). Both sides get emails. Brand sees "Organizer contact" and "Open sponsor dashboard". Dashboard, /report and /leads.csv return 200. Kalaa appears on /sponsor | PASS |
| Brand side two-tab accept (Commerce Carnival) → second tab says "This request was already answered.", 1 sponsors row | PASS |
| Organizer declines Volt with a note → brand sees "Note with the decline". Re-send within 7 days → refused with a clear message | PASS |
| Brand withdraws → status withdrawn, no email to the organizer | PASS |
| Organizer Find brands → Send request (pitch) to the new brand. Brand gets an email and a "Requests 1" badge. Brand declines with a Hindi note, and the organizer's Sent list shows it | PASS |
| "Show this fest to brands" on Hackverse: on → listed. Off → gone, and direct media-kit URL returns 404 | PASS |
| Wrong organizer (organizer2 → Neon sponsors) gets 404. Student is sent to /fests (media kit 404). Logged out is sent to /login | PASS |
| No horizontal scroll on any page at 390 or 1280, and no page JS errors | PASS |

## Failures

### F1 (medium): accepting a request from a brand that already sponsors the fest records a deal that never happens
- **Steps:** Log in as sponsor@thefest.in. Volt Energy is already the **Title, ₹5,00,000** sponsor of Neon Utsav. Open
  `/sponsor/fests/<neon>`. The "Request to sponsor" form is still offered. Send **Partner ₹10,000**. As organizer@,
  click Accept on the Sponsors tab.
- **Expected:** One of two things. Either the media kit and Find brands don't offer a request when the brand already
  sponsors the fest ("You already sponsor this fest"). Or accept shows what it did, and the request and emails match the
  sponsor row.
- **Actual:** The request shows **Accepted: Partner ₹10,000**. Both emails say "Volt Energy is now a Partner sponsor of
  Neon Utsav (₹10,000)". The sponsors row is still **Title ₹5,00,000** because accept linked to the existing row. Neither
  side is told. The organizer's sponsors list, the brand dashboard and the ROI report all disagree with the accepted
  request and the email.
- **Likely files:** `src/lib/sponsor-requests.ts` (acceptRequest re-use branch, around the "Re-use a sponsor row" comment),
  `src/lib/mail.ts` (notify text), `src/app/sponsor/fests/[festId]/page.tsx` and the organizer Find brands list (offer
  the form only when the pair has no sponsor row).
- No screenshot (the mismatch is in the data). DB check: `select tier, amount_paise from sponsors where email='sponsor@thefest.in' and fest_id=<neon>` → `Title|50000000`.

### F2 (low): "Brand profile" tab is off-screen at 390px
- At 390px the sponsor nav is a sideways-scrolling strip. "Brand profile" is cut off, and on `/sponsor/profile` itself
  the active tab can't be seen. A new brand has no visible hint that the tab exists. The media kit's
  "Set up your brand profile first" button does lead there.
- Screenshots: `req-shots/profile-390.png`, `req-shots/brand-sent-390.png` (shows the "BI…" sliver).
- Likely file: `src/components/SponsorShell.tsx` / `.sp-nav` CSS. Wrapping onto two rows would fix it.

### F3 (low): empty-state wording is wrong
- `/sponsor/requests` with no received requests always says "List your brand on your profile so organizers can find
  you", even when the brand is already listed (`src/app/sponsor/requests/page.tsx:28`).
- A new brand's `/sponsor` home only says "When a fest organizer adds you as a sponsor, it appears here". It doesn't
  point to Find fests or the brand profile (`src/app/sponsor/page.tsx`). Screenshot `req-shots/home-390.png`.

### F4 (low, ordering): organizer Requests received lists accepted and withdrawn above the open request
- On Kalaa, the one open request (Volt, needing Accept/Decline) was third, below the accepted and withdrawn cards.
  Open requests should sort first. Screenshot `req-shots/org-accepted-390.png`. Likely `festRequests` order in
  `src/lib/sponsor-requests.ts`.

## Screenshots reviewed
All are in `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/req-shots/`.

- `fests-390.png`, `fests-1280.png`: brand Find fests. Cards stack, filters full width, no overlap.
- `mediakit-390.png`, `mediakit-1280.png`: media kit. Stats wrap 2+1 at 390. Labels readable, form fields full width.
- `requests-390.png`, `requests-1280.png`, `brand-requests-sent-390.png`, `brand-requests-received-390.png`: brand
  Requests. Chips don't collide with long fest names. Accept and Decline are full-width and at least 44px tall.
- `brand-accepted-390.png`, `brand-accepted-received-390.png`, `brand-sponsor-dashboard-390.png`: accepted state.
  Contact box wraps, and the dashboard loads.
- `org-sponsors-requests-390.png`, `org-accepted-390.png`, `org-find-brands-send-390.png`, `orgsponsors-1280.png`:
  organizer Sponsors tab with toggle, Requests received/sent, Find brands and the send form. Devanagari and Kannada
  render. No sideways scroll.
- `profile-390.png`, `profile-1280.png`, `home-390.png`, `home-1280.png`, `brand-unverified-mediakit-390.png`,
  `brand-noprofile-mediakit-390.png`.
- Not a bug: in full-page screenshots the sticky header shows mid-page. That is a capture artefact.

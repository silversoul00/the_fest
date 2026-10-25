# Smart QR (TF2): Tester round 1 (Oct 18, 2026)

Commit: `fcc7f7b` (branch `full-app`). Plan: `2026-10-18-smart-qr-review-1.md`. Local Postgres only.

## Result: ALL PASS (2 minor should-fix findings, not blockers)

## Numbers
- `node --conditions=react-server scripts/check-qr2.mjs`: **25/25**. Worst case: 260 chars, v12 (thefest.in); 263 on localhost; **290 chars, v13 with a 40-char host**.
- `python3 tests/smartqr.py`: **64/64**.
- Full release check: not re-run. The Builder ran it green on `fcc7f7b`, and nothing has changed in the code since then.
- Manual browser run (scratchpad `manual.py`, 390 and 1280): **38/39**. The one fail was my own wrong expectation. A student-role volunteer opening `/organizer/<fest>/volunteers` is redirected to `/fests` (200), not given a 404. They never see the reset button (screenshot `volunteer-tries-volunteers-page-390.png`).

## First aid removed (plan item 3, flipped to "confirm absence")
- `grep -rniE "medical|first.aid|blood" src db` finds nothing.
- `/me` has no first-aid card.
- The volunteer duty list is Gate 1-3, Lunch counter, Stay desk, Registration desk, Main stage, Hospitality. "First aid" is not offered.
- The organizer counter picker has no first aid.
- The health check passes on a database without `medical_profiles`.
- A volunteer whose duty is typed "First aid" gets gate keys only.

## Scenarios run (all pass)
- **Public `/t/` page** (opened as a plain camera would, 390 and 1280): shows college, city, fest, dates, ticket type, first name, Valid and "Verified by THE FEST". It does not show the full name, phone, email, ticket code or perks. These links all give the same 404 page: a random string, a wrong tag, a cut-short P, and P with extra bytes.
- **Scanner by role, offline, with the same live QR**:
  - lunch scanner: lunch section only
  - stay scanner: stay section only
  - gate scanner: gate section only (name and type, no phone)
  - organizer: gate, lunch, stay and org sections (holder phone shown)
  - None of these pages scroll sideways at 390 or 1280.
  - After syncing, the database has exactly 1 admission and 1 lunch + 1 stay.
- **Offline scan and sync** (smartqr.py):
  - Shows amber "saved"; scanning again gives "Already in (this phone)".
  - A ticket already used at another gate syncs as "Synced: was already used". The database never has two admissions.
  - A Wi-Fi login page (HTML 200) and a 503 both keep the queue. The 30 s retry then sends it.
  - Pressing Lock with unsynced scans shows a warning. The next volunteer on the phone does not send them. The same volunteer logging in again syncs them under their own name.
  - Yesterday's offline lunch is not recorded today.
- **Live QR**: it redraws when the 30 s countdown restarts. The chips show Live ✓, Static and Old screenshot, and each ticket is admitted once (warning only). The same ticket open in two tabs renders in both.
- **Reset scanner keys**:
  - Bumps the epoch and logs the fest's scanners out.
  - A QR from the previous epoch still opens offline; one from two epochs back says "needs network".
  - A co-organizer not on the fest, and a volunteer, cannot reach it.
  - A double click bumps the epoch only once (1 → 2).
- **Old tickets**: an old TF1 QR admits exactly once online; offline it shows "Old-style ticket". The backup code still admits.
- **Tampering** with P or F shows "Fake or tampered", both online and offline.
- **Ticket page access**: logged out, it redirects to `/login`. Another student gets a 404.

## Findings (minor, should-fix, not blocking)
1. **Indic names are cut short and changed on the scanner card.**
   - Repro: set the holder name to `ಅಭಿಷೇಕ್ ವೆಂಕಟರಾಮನ್ ಅಯ್ಯರ್ हर्षित`, scan offline at the gate.
   - Expected: a readable name the volunteer can match to an ID.
   - Actual: the card shows `ಅಭಿಷೇಕ` (6 letters). The final virama is dropped, so the name reads differently from the real one.
   - Cause: `NAME_MAX = 20` counts UTF-8 bytes, and Kannada letters take 3 bytes each. `utf8Max` (`src/lib/qr2-format.ts:57`) cuts by code point, not grapheme cluster, so it can split a conjunct.
   - Fix: cut at grapheme boundaries (`Intl.Segmenter`). Consider a larger byte budget when the name is non-Latin; there is room up to the 40-char-host limit.
   - Screenshots: `scanner-gate-390.png`, `scanner-organizer-390.png`.
2. **Public `/t/` card has no right margin at 390px.**
   - The card spans x = 16 to 388.9 (left margin 16, right margin about 1). The cause is the min-content width of the letter-spaced college label and the button text, inside `.auth-shell { overflow: hidden }`.
   - A longer college name would be clipped rather than wrapped.
   - Likely file: `src/app/t/[p]/page.tsx:31` (`width:100%` grid child; needs `min-width:0` / `overflow-wrap:anywhere` on the label).
   - Screenshot: `public-t-390.png`.
3. Cosmetic: on the organizer scanner at 390px, the counter dropdown cuts off its own label ("Lunch counte"). Screenshot: `scanner-organizer-390.png`.

## Screenshots reviewed
Folder: `/tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/smartqr-shots/`

Checked on each: overlap, cut-off text, sideways scroll, contrast.
- `public-t-390.png`, `public-t-1280.png`: no private data; finding 2.
- `public-t-bad-390.png`: the standard 404 page.
- `ticket-live-qr-390.png`, `ticket-live-qr-1280.png`: QR at least 260 px; countdown and static toggle visible; long Kannada and Hindi name wraps fine.
- `scanner-lunch-390/1280.png`, `scanner-stay-*`, `scanner-gate-*`, `scanner-organizer-*`: only the right section shows; finding 1; finding 3.
- `volunteers-reset-390.png`, `volunteers-reset-1280.png`, `volunteers-reset-done-390.png`: reset button and help text readable; the help text says any other duty scans at the gate.
- Full-page screenshots show the sticky bottom and top nav mid-page. That comes from the screenshot tool, not the layout.

No test files changed. Findings 1 and 2 should get tests in `smartqr.py` when they are fixed: a Kannada name that survives at grapheme boundaries, and a right margin of at least 12 px on `/t/` at 390.

# Smart QR (TF2) — Supervisor review 1 (Oct 18, 2026)

Commit reviewed: `74bb402` (range `daa8007..74bb402`). Plan: `docs/team/research/2026-10-18-smart-qr.md`.

## Verdict: CHANGES NEEDED

The crypto design and the code are sound, and the plan was followed closely. `node --conditions=react-server scripts/check-qr2.mjs` passes 21/21 (worst case 297 chars, v13). Changes are needed for three reasons: Harshith has since dropped first aid, offline scans can be silently lost during sync, and the deploy will break if the schema check runs before the migration.

## Brief check
- Smart QR plan ("Yess"): public page with the basics, sealed per-role sections after `#`, opened offline, live status online, rotating QR → **OK**. Public page `src/app/t/[p]/page.tsx`; sections `src/lib/qr2.ts:56-72`; offline scanner `Scanner.tsx`; live code `LiveQR.tsx`.
- "Normal scanner = basics; FEST scanner = more, by who scans" → **OK**. `/api/scan/keys` gives a volunteer only the key for their duty's role (`keys/route.ts:256-257`). `fest_staff.duty` is `not null`, so a volunteer can never be treated as a manager.
- 2-page invention note → **not built**. This no longer matters because Harshith said "Don't care about patent".
- First aid (student opt-in) → was built, but is now **VIOLATED** by Harshith's Oct 18 answer "Skip first aid for now". It must be removed (must-fix 1).
- Old screenshots: warn only → **OK**. The chip is a warning only and the scan still admits.
- Push/deploy hold for the patent → no longer applies (Harshith: public repo fine). The standing rule still applies: push only tested, meaningful batches; never `main`.
- Do not change Supabase without his say-so → **OK** so far (nothing applied). But deploying needs the v2.4 migration first (must-fix 3).
- Gate scanner always asks to log in again; counter comes from duty → **OK** (unchanged; reset deletes scanner sessions).
- Money flows → **OK**. No payment, refund or order code was touched. `/api/scan` gate path unchanged apart from the TF2 resolve.

## Crypto review (confirmed by reading the code)
- Keys: master = HKDF(ECDSA private scalar, "tf2-master"). From that come per-fest, per-role, per-epoch AES keys, a global path key and a per-ticket liveSecret. The path key and master never leave the server. **Sound.**
- AES-GCM with 4-byte tags is safe only because the scanner verifies the ECDSA signature over `"TF2"‖P‖nonce‖sections` **before** it decrypts anything (`qr2-client.ts` `openTicket`). The server never decrypts. A forged ciphertext can't get past the signature, so the short tag is only a "this key fits" check. **Sound.**
- Nonce: 12 random bytes per render, shared across sections that each use a different key. There is no (key, nonce) reuse in practice. **Sound.**
- Key leak via `/api/scan/keys`: checks the scanner session, checks `scannableFests`, sends only the role for the duty, `no-store`, not served after end+1 day, and keys are imported non-extractable. A leaked role key exposes only that role's sections for that fest and cannot forge a ticket (ECDSA). **Sound.**
- Epoch reset: `qr_epoch % 255 + 1` with `prevEpoch` wrap is correct. Owner and co-organizer only, via `ownFest`/`canManage`. Known limit (by design): a lost phone can still open QRs from the previous epoch offline until its cached bundle expires.
- `/t/` enumeration: needs a 48-bit HMAC pathTag. All failures go through `notFound()`. Nothing in `src` reads `location.hash`. **OK.**
- TF1 and backup codes: the old path in `scan.ts` is untouched. TF1 offline is verified with the public key, gate only. **OK.**

## Must-fix
1. **Remove first aid (Harshith's decision).** Remove:
   - `medical_profiles` from `db/schema.sql` (it never shipped) and from `src/lib/schema-check.ts:23`.
   - `saveFirstAid`/`deleteFirstAid` (`src/app/(student)/me/actions.ts`; keep the file only if `LogoutForm` still needs it) and the `#first-aid` card in `me/page.tsx`.
   - The `aid` role in `qr2-format.ts` (`ROLES`, `encAid`/`decAid`, `BLOOD_GROUPS`, `ALLERGY_MAX`), `qr2.ts` (`TicketSeal.aid`, the `medical_profiles` join in `ticketSealData`), `qr2-client.ts`, `Scanner.tsx` (the `aid` counter, `TITLE.aid`, the RoleCard aid block, the picker option), `api/scan/route.ts` (`'aid'` in `COUNTERS`, `aidStatus`), `scan.ts` (`aidStatus`, the `first aid`/`medical` branch in `counterFor`), and the "First aid" datalist option and help text in `volunteers/page.tsx`.
   - Keep `ROLE_ID` numbers stable (gate 1, lunch 2, stay 3, org 5).
   - Update `check-qr2.mjs` and `tests/smartqr.py`: delete the AC7/AC15 aid checks and add "no aid section; worst case is now shorter".
   - Note for the Builder: once `aid` is gone, a duty typed "First aid" falls through to **gate** in `counterFor`. That is the same as any other unknown duty, but say so in the volunteers help text (it already says "anything else is the gate").
2. **Offline scans can be silently lost during sync.** In `Scanner.tsx` `sync()` (≈ lines 85-95), every reply except 401 deletes the queued scan, including 5xx, 429, a Vercel 504, or a **college Wi-Fi captive portal** that returns 200 HTML (`r.json()` fails → treated as "invalid" → `idbDel`). The offline admission then never reaches the database. The ticket stays `valid` and can be used again at another gate. Fix: delete the item only when the reply is JSON with a `result` (2xx), or a definite 4xx rejection (400/403). On 5xx/429/non-JSON, stop and keep the queue for the next `online` event or a timer retry. Also add a periodic retry (e.g. every 60 s while items are queued), because `online` may never fire when the phone "has Wi-Fi" but the portal blocks it.
3. **Deploy order / schema check.** `schema-check.ts` now requires `fests.qr_epoch`, and the ticket page, `/api/scan/keys` and the reset action all use it. Production (`uxhpvbgxftsdpcyycxpq`) and preview only have v2.3. If the code is deployed first, the health check fails and ticket pages fall back to the backup code. Fix: after must-fix 1, v2.4 is just `alter table fests add column if not exists qr_epoch smallint not null default 1;`. This needs **Harshith's yes** to apply on prod and preview **before** deploying (see Questions).

## Should-fix (small, same round)
4. **Lunch synced on a later day counts for the wrong day.** Plausible, from reading the code path. The queue sends no scan time; `redeemPerk` uses the server's `todayIST()` (`scan.ts:176,225`). A day-1 offline lunch that syncs on day 2 is recorded as day 2, so the student's real day-2 lunch then shows "already had lunch". Fix: when the queued `at` is from an earlier IST day, have the scanner skip lunch sync and show "Synced: day-1 lunch (not recorded)". Alternatively, send `at` and let the server accept it only for gate/lunch within the fest dates. The skip option is the simplest safe choice.
5. **Queue survives Lock and is sent under the next person's login.** `wipeScannerKeys` keeps the queue, so the next volunteer on that phone syncs the earlier volunteer's scans. Their scan counts and logs get the wrong name, and a scan for a fest the new person isn't on gets a 403 and is dropped. Fix: store the scanner user id in each item and only sync items that belong to the current session. Otherwise, on Lock, warn "N scans not yet synced — connect before locking".
6. **QR size margin.** The worst case is 297/300 chars on `https://thefest.in` and exactly 300 on localhost. A longer `NEXT_PUBLIC_SITE_URL` (a Vercel preview URL, `www.`) pushes past v13. Removing aid frees about 14 bytes, which fixes this. Keep the check, and add a test with a 40-char host.

## Low / note only (no change needed now)
- `/offline` saved tickets are never pruned. Voided or transferred tickets stay until logout from `/me` (other logout paths don't clear them). This is harmless (the server rejects them) but confusing.
- Offline gate scans can admit a refunded or transferred ticket (the phone can't know). The sync feed shows "Cancelled". This is the accepted v1 risk.
- The organizer "Holder phone" is the buyer's account phone, including on "Name (2/3)" friend tickets. Consider the label "Buyer phone".
- `run-e2e.sh` runs `check-qr2.mjs` with `2>/dev/null`. Failures still stop the run (`set -e`), but the reason is hidden.

## Test plan for the Tester (after the fix round)
1. `node --conditions=react-server scripts/check-qr2.mjs` passes. Worst case (gate+lunch+stay+org+live, 20-char name, 16-day fest) ≤ 300 chars, v ≤ 13. Also test with a 40-char site host.
2. Full `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh` is green, including money.py, refunds.py, race.py and smartqr.py.
3. First aid gone: `/me` has no first-aid card; `grep -ri "medical\|first.aid\|blood" src db` is empty; the "First aid" duty is not offered; schema-check passes on a DB **without** `medical_profiles`.
4. Public page `/t/<P>`: shows fest, dates, college, type, first name and status only. A random string, a real id with a wrong tag, and a missing tag all give an identical 404. Headers are noindex, no-store, no-referrer. Check at 390px.
5. Keys API: 401 without a scanner session; 403 for someone not on the fest; a gate volunteer gets gate only; a lunch volunteer gets lunch only; an owner or co-org gets gate/lunch/stay/org; 403 after fest end + 1 day.
6. Offline gate: amber "saved"; a re-scan gives "Already in (this phone)"; reconnecting syncs; a ticket used at another gate shows "Synced: was already used"; the DB has exactly one admission.
7. **Sync resilience (new):** queue 2 offline gate scans, then make `/api/scan` return 503 (or an HTML 200) on reconnect. The queue must keep both. Restore the server: both sync, and the tickets become `used`.
8. **Lunch across days (new):** queue an offline lunch for "yesterday" (fake the clock), sync today, and check that the student can still get today's lunch.
9. **Lock with a queue (new):** volunteer A scans offline, locks, and volunteer B logs in. A's scans are not attributed to B (or A is warned before locking).
10. TF1 QR printed earlier admits exactly once online; offline it shows "Old-style ticket"; the backup code `TF-XXXX-XXXX` admits online and offline says "needs internet".
11. Tampering with any byte of P or F gives "Fake or tampered", online and offline.
12. Live QR: changes every 30 s; a code older than about 90 s shows "Old screenshot", the static QR shows "Static"; both still admit once online (warn only).
13. Reset scanner keys (owner and co-org only; a volunteer can't reach it): epoch goes up and scanners are logged out; a previous-epoch QR opens offline after re-login; a QR two epochs old says "needs network".
14. `/offline` with the network off shows saved tickets with the live QR; they are cleared after logout.
15. 390px: public page, ticket screen (QR ≥ 260px, countdown visible), and the scanner role cards for gate/lunch/stay/org have no horizontal scroll.

## Questions for Harshith
1. To deploy Smart QR, production (`thefest`) and preview (`thefest-preview`) need one new column: `fests.qr_epoch` (v2.4, additive, default 1). May we apply it to both before the deploy?

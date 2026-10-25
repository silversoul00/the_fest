# Smart QR (TF2) — Supervisor review 2 (Oct 18, 2026)

Fix commit reviewed: `fcc7f7b` (range `446ebe9..fcc7f7b`), checked against review 1. Unchanged code was not re-reviewed.

## Verdict: PASS

All the must-fix and should-fix items in scope are done. I ran `node --conditions=react-server scripts/check-qr2.mjs` and it passes. The worst case is now 260 chars (v12) on thefest.in, 263 on localhost, and 290 chars (v13) with a 40-char host. `tsc --noEmit` is clean. Must-fix 3 (add `fests.qr_epoch` to prod and preview) is approved by Harshith, and the coordinator does it before the push. **Order: apply the column first, then push.** `fcc7f7b` and `74bb402` are not on any remote branch yet, so nothing has been deployed.

## Brief check
- "Skip first aid for now" → **OK**. Running `grep -riE "medical|first.?aid|blood|aidStatus|encAid|ALLERGY" src db scripts` finds nothing (the only hit is a comment in `tests/run-e2e.sh`). `me/actions.ts` is deleted (`LogoutForm` never needed it). `ROLE_ID` stays gate 1 / lunch 2 / stay 3 / org 5, and 4 is marked retired (`qr2-format.ts:38-39` area).
- Do not change Supabase without his say-so → **OK**. Nothing was applied. The v2.4 SQL is now only `alter table fests add column if not exists qr_epoch …` (`db/schema.sql`), and Harshith has approved it.
- Never `main` / push only tested batches → **OK**. Nothing pushed.
- Money flows → **OK**. The fix diff does not touch payment, refund or order code.

## Review-1 items
| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Remove first aid | **Fixed** | Removed from schema, schema-check, `/me` card and actions, `ROLES`/enc/dec, `TicketSeal.aid` and its join, `qr2-client`, Scanner (counter, title, RoleCard, picker), `/api/scan` (`COUNTERS`, `aidStatus`), `scan.ts` (`counterFor`, `aidStatus`), and the volunteers datalist. The help text now says "anything else (any other duty name) scans at the gate". `smartqr.py:35-36,131` checks that a "First aid" duty gets gate keys only. |
| 2 | Offline scans silently lost in sync | **Fixed** | `Scanner.tsx` `sync()`: a scan is deleted only when the reply is `r.ok` + JSON + `result`, or a 400/403 JSON with `error`. Anything else stops the loop. A 30 s retry timer and a "Sync N waiting scans now" button were added. `/api/scan` always returns JSON, and `fail()` = `{error}`, so a real server answer is never mistaken for an unclear one. Tested: HTML-200 portal, 503, and timer recovery (`smartqr.py:227-247`). |
| 4 | Lunch synced on a later day | **Fixed** (the "skip" option) | A queued lunch whose `istDay(at)` is not today is deleted with the note "Not recorded: lunch from YYYY-MM-DD". Tested in `smartqr.py:165-170`. |
| 5 | Queue sent under the next login | **Fixed** | `Queued.by = scannerId`. Sync skips scans from other volunteers and shows "N scans saved by another volunteer". Lock syncs first, then shows a confirm if scans are still waiting. Tested in `smartqr.py:249-280`, including the scan landing under A's id after A logs in again. |
| 6 | QR size margin | **Fixed** | Worst case 260 chars/v12. A new 40-char host test gives 290/v13 and passes. The threshold was tightened to ≤ 290. |
| 3 | `fests.qr_epoch` on prod and preview | Not a blocker (approved; coordinator) | — |

## Findings (new, from the fix diff). None block the release.
1. **Low — Lock can hang on a slow network.** `Scanner.tsx` `lock()` waits for `sync()`, and that `fetch('/api/scan')` has no timeout. On a captive portal that never answers, the Lock button looks dead until the browser gives up, which can take a minute or more. The retry timer has the same weakness: `syncing.current` stays true, so ticks are skipped. This is plausible, not tested. Fix: add `AbortSignal.timeout(8000)` to the sync fetch. An abort lands in the existing `catch { break; }`, so the queue is kept.
2. **Low / accepted trade-off — stranded queue.** If volunteer A never logs in on that phone again, A's offline scans never reach the database, and those tickets stay `valid` on the server. The Lock confirm and the "saved by another volunteer" line make this visible, which is what review 1 asked for. A later option is to let the owner or a co-org flush them under their own name. This needs no decision now.
3. **Note — a phone with the wrong date** could wrongly drop or keep a queued lunch, because `istDay(q.at)` and `todayIST()` both use the phone's clock. Since both use the same clock, this only bites if the clock is changed between the scan and the sync. Ignore it.

## Test plan for the Tester
1. `node --conditions=react-server scripts/check-qr2.mjs` passes (260/v12, 40-char host 290/v13).
2. Full `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh` is green, including money.py, refunds.py, race.py and smartqr.py.
3. The schema check passes on a local DB **without** `medical_profiles` and **with** `fests.qr_epoch`. Before the push, after the coordinator applies the column: `/api/health` on preview is green.
4. By hand at 390px: the scanner with 1-2 queued scans shows the "waiting" line, the "Sync now" button and the "saved by another volunteer" line with no horizontal scroll. The Lock confirm text reads clearly.
5. Not automated: on a real phone, turn on airplane mode, scan 2 gate tickets, turn Wi-Fi back on **without** reloading. Within about 30 s the queue empties and the DB shows both tickets as `used`.
6. Not automated: a volunteer whose fest access was removed while offline. Sync gives "Not accepted: You are not on this fest's gate team" and the item is dropped (expected).
7. Re-run review-1 plan items 4, 5, 10-15. They are unchanged, so a quick pass is enough.

## Questions for Harshith
None.

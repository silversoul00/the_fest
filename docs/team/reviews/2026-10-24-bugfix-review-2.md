# Fix round 2 review — commit fb62df4 (47db3e3..fb62df4)

**Verdict: CHANGES NEEDED** (two small server-side fixes to fully close F1; everything else passes)

## Brief check
- Oct 24 #1, every rename of an approved fest goes to review, even with 0 sold: **OK**. `renameClearsApproval` + `RENAME_REVIEW_WITHOUT_TICKETS = true` (src/lib/fest-form.ts:481-489). updateFest clears `approved_at` and moves live → review (src/app/organizer/actions.ts:343-374). Holders are emailed only when holders > 0.
- Oct 24 #1, a draft/ended fest that gets renamed goes to review on its next Publish/Reopen: **OK**. `approved_at` is cleared, and setFestStatus sends `!approved_at` to review (actions.ts:217). The rename note survives Withdraw/Publish (actions.ts:224).
- Oct 24 #2, the renamed fest's page stays public with "Under review — ticket sales paused": **OK** (src/app/(student)/fests/[slug]/page.tsx:30-31, 71-75, 125). Drafts and first-time review stay hidden. Scanning still works: queries.ts:93 includes 'review' and scan.ts has no fest-status block.
- Checkout refused on the server: **OK**. createOrder throws unless `f.status = 'live'` (src/lib/orders.ts:37). This covers entry tickets and add-ons.
- Push/main/accounts rules: **OK**. Nothing touches main or external accounts.

## Findings
1. **Medium: an admin can approve a name they never saw** (src/app/admin/actions.ts:24-28, admin/page.tsx:110). The Approve form sends only `festId`, and the UPDATE does not check the name or a version. Here is how it happens. The admin opens the review queue and sees "Kalaa 2026". The organizer renames the fest again while it is in review (updateFest allows this; actions.ts:346 only rewrites the note). The admin clicks Approve, and the new, unseen name goes live with approval. This is a narrow F1 bypass, and it applies to first-time reviews too. Fix: put a hidden `name` (or `updated_at`) in the Approve form and run `update … where id = $1 and status = 'review' and name = $shown`. If no row is updated, say "This fest changed since you opened the page — reload".
2. **Low: Publish racing a rename can skip review** (actions.ts:213-226). setFestStatus reads `approved_at` without a lock, then writes `status = 'live'`. If updateFest clears the approval in between (two tabs, or a co-organizer), the renamed fest goes live. Fix: decide inside the one UPDATE: `status = case when ${status}='live' and approved_at is null and ${required} then 'review' else ${status} end`. Alternatively, use `select … for update` in a transaction.
3. **Info: HydrationGate. Recommendation: KEEP for now, with guards.** Risk analysis:
   - Streaming/Suspense/loading.tsx: there are none in src/app today, so the only wait is for the rest of the RSC payload. React needed that payload to finish hydrating anyway, so the cost is close to zero. **If anyone later adds loading.tsx or `<Suspense>`, the gate blocks the whole page's taps until the slowest streamed part arrives.** Add a code comment and a check-format rule or test that flags this.
   - Client navigation, router.refresh, bfcache: `readyState !== 'loading'` returns null, so there is no effect.
   - Scanner and offline queue: cached and offline HTML finishes parsing at once. The camera starts in effects after hydration, so the delay is milliseconds. SwRegister registers slightly later, which is harmless.
   - Forms before hydration: there is a pre-hydration window today too; the gate only lengthens it on slow links. Plain links do a full load. A tap on a form whose action is a client wrapper (FestForm `run`) does nothing until hydration. This is acceptable.
   - SEO and server HTML: unchanged. Next's own DOMContentLoaded handler (next/dist/client/app-index.js:106-119) closes the flight stream before the gate's `setTimeout(0)` resumes, so the ordering is sound.
   - Narrower option: not available, because the gate must sit above `<html>` to work. The root cause is unconfirmed, so this is "plausible". The comment cites "React 19.3", but App Router runs Next's bundled **19.2.0-canary-0bdb9206** (Next 15.5.28), so the `react` package version does not matter. The standard alternative is to bump `next` to the latest 15.5.x or 16 and re-run the 40-load slow test without the gate. If the test stays clean, delete the gate. `suppressHydrationWarning` does not fix this, because the error is a structural "HTML" mismatch.
   - Fix the comment's version and point it at this note.
4. **Info: safeNext is sound.** Traversal (`/..//evil.com` and encoded forms) is checked on both the raw and decoded values after URL resolution. Lone surrogates and broken `%` sequences give ''. Non-ASCII characters are percent-encoded (src/lib/format.ts:155-166).
5. **Info: the seed's IST date is correct.** `day()` adds 5.5 h before taking the date, and `at()` builds `+05:30` wall-clock times from it (scripts/seed.mjs:27-35).

## Test plan for the Tester
- Finding 1: admin opens /admin with fest X in review. In another browser, the organizer renames X. The admin clicks Approve. Expected after the fix: refused or "reload". Today the fest goes live under the unseen name.
- Finding 2: approved draft fest, two tabs. In tab A, save a rename. In tab B, click Publish at the same moment (or use a script with parallel requests). Expected: status is review, never live.
- Live approved fest with 0 sold → rename → status review. The public page shows "Under review", there are no Buy buttons, and a direct `/api` checkout POST is refused with "Tickets are not on sale right now".
- Renamed-in-review fest: existing ticket scans "Admit". The add-on buy section is hidden. The Explore list does not show it.
- First-time-review fest and draft fest: public URL is 404 when logged out.
- End → rename → Reopen goes to review. Withdraw → Publish keeps the "Renamed from “…”" note visible to the admin.
- Gate: throttled 3G (CDP) on Sales, Analytics, Scanner, and the student fest page, 40 loads each: no #418. Tap Save/Buy right after first paint: nothing breaks, and the action works once the page is interactive. Scanner offline: page opens from cache and the queue syncs.
- Gate sanity: on a scratch copy only, remove HydrationGate and confirm `tests/bugfix_oct23_fix2.py` L9 fails. This proves the test catches the bug.

## Questions for Harshith
None.

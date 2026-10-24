# Smart QR — review 3 (fixes for test-1 + review-2 low item)

Date: 2026-10-18 · Scope: uncommitted `git diff` (qr2-format.ts, Scanner.tsx, t/[p]/page.tsx, check-qr2.mjs)

## Verdict: CHANGES NEEDED (one small must-fix)

## Brief check
- No push / no main / no account changes: OK (working tree only).
- Nothing extra built beyond the 4 listed fixes: OK.

## Findings

1. **MUST-FIX (Medium-High) — `AbortSignal.timeout` missing on older phones stops all offline sync.**
   `src/app/scan/Scanner.tsx:104`. `AbortSignal.timeout` exists only in Chrome/Android WebView 103+ and Safari/iOS 16+.
   On an iPhone 6s/7 (stuck on iOS 15) or an un-updated Android WebView, `AbortSignal.timeout` is `undefined`, the call
   throws a TypeError inside the `try`, the `catch { break; }` runs, and **every** sync attempt stops at the first queued
   scan. Scans are not lost (they stay in IndexedDB), but they never reach the server; the volunteer gets the
   "N scans not synced yet" prompt on every lock and counts stay wrong. Fix: build the signal with a fallback, e.g.
   `const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000);` (clear in `finally`), or
   `typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined`.

2. **Low — word-boundary preference can throw away almost the whole name.** `src/lib/qr2-format.ts:73`.
   `utf8Max('A Venkatasubramanianxxxxxxxxx', 26)` → `"A…"`. A short first word plus a long second word gives the gate
   volunteer only an initial. Suggest: only cut back to the space if it keeps at least ~half of `room` (else cut at the
   grapheme). Same for a leading space (`" Abc…"` keeps the space, `lastSpace > 0` guard skips it) — trim input first.

3. **Low — a timeout after the server already recorded the scan.** If `/api/scan` commits but the answer arrives after
   8 s, the scan stays queued and the next sync shows "Synced: was already used … — <name>" for the volunteer's own
   admit. Count is correct (server is the authority), only the note is confusing. Same as the pre-existing network-drop
   case; acceptable for now.

## Confirmed OK
- Timeout keeps the queue: an aborted fetch rejects → `catch { break; }` before `idbDel`; an abort during `r.json()`
  gives `v = null` → `break`. Queue item kept; timer retries. (`Scanner.tsx:102-111`)
- QR budget (ran `scripts/check-qr2.mjs`, all PASS): thefest.in worst case 267 chars v12; localhost 270; 40-char host
  297 chars v13 — at the v13 ceiling, no headroom left for further growth.
- Intl.Segmenter: `encGate` runs only on the server (`src/lib/qr2.ts:58`, Node 22 has it); the scanner only decodes,
  so phone support does not matter. Fallback (`Array.from` code points) is still valid UTF-8 if ever used client-side.
- Grapheme cut: Kannada "ಅಭಿಷೇಕ್…", Hindi "हर्षित…" kept whole; emoji-family-only name → "…" (no broken bytes).
- Type uses `atWord=false` → "Workshop…" (11 bytes ≤ 12). Old 20-byte-name QRs still decode (decoder is length-free).
- /t/ page: `minWidth:0` + `overflowWrap:'anywhere'` on the card and `whiteSpace:'normal'` on the button address the
  390px overflow. Counter select `minWidth:150` OK.

## Test plan for the Tester
1. Scanner on Chrome with `AbortSignal.timeout` deleted in DevTools (`delete AbortSignal.timeout` before load) or an
   iOS 15 Safari: queue 2 scans offline, go online → both must sync (fails today, finding 1).
2. Throttle `/api/scan` to >8 s (DevTools custom profile or a delayed route): sync must stop, queue count unchanged,
   retry later succeeds; no "Not accepted" note.
3. Ticket for "A Venkatasubramanian…" and a 3-word Kannada name: gate card shows readable name with "…".
4. `/t/<p>` at 390×844 with a long fest/college name: no horizontal scroll, button text wraps inside.
5. Counter select at 390px: "Lunch"/"Stay" labels not clipped.

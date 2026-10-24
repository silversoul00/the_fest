# Supervisor review — bug-hunt fixes (commit 47db3e3) — 2026-10-23 — review 1

Scope: `git diff 47db3e3^..47db3e3`, checked against `docs/team/reviews/2026-10-23-full-bug-hunt.md` (15 items) and
Harshith's M4 decision in `docs/team/BRIEF.md` ("Allow + email buyers").

## Verdict: CHANGES NEEDED

The fix for one finding (F1) is required. Everything else either passes or is low-risk advice.

## Brief check
- "Build fix" for H1, M1, M2, M3, M5, L1–L9 → OK. All are done; nothing extra that adds risk.
- M4: "emails every ticket holder what changed (old → new), in the background" → OK (`organizer/actions.ts:704-719`, via `afterResponse`).
- M4: "Renaming a **live** fest sends it back to admin review (status review, note visible to organizer and admin)" → **VIOLATED in one case**
  (F1). A quick switch to draft gets around it, and the note can be wiped (F2).
- M4: warning text and the "I understand" tick → OK (`FestForm.tsx:386-394`; the server checks it too at `actions.ts:682`).
- M4: "New dates that would drop already-sold lunch days are blocked" → OK (`actions.ts:671-681`).
- M4: "Nothing changes when no tickets are sold" → OK (`holders.length` guards every branch).
- Never merge to main / batch pushes / no account changes → OK (the commit touches the repo only).

## Acceptance (bug-hunt items)
| Item | Result | Evidence |
|---|---|---|
| H1 | Met | `format.ts:988-1002`. Used at `login/page.tsx:11-13`, `signup/page.tsx:11`, `(auth)/actions.ts:39,57`. These are the only redirects a user can control (the rest are fixed paths). I tested 39 payloads: `//`, `/\`, `\/`, `%2f%2f`, `%5c`/`%5C`, `%252f` and `%25252f`, tab/CR/LF (raw and encoded), U+3000/U+2028/NBSP, `@`, `javascript:` in mixed case, `data:`, `https:host`. All are rejected or stay on the same site. `/..//e.org`, `/.//e.org` and `/%2e%2e//e.org` get through, but they resolve to the same origin, and the running server sends `//e.org` to `308 /e.org`. Safe in practice; see F5. |
| M1 | Met | Capacity is capped at 10,00,000 (`actions.ts:588-598`). Payout is capped at ₹2 crore = 2×10⁸ paise, under the int max of 2.147×10⁹ (`admin/actions.ts:49-50`). Ticket price/quota were already capped; `updateTicketType` now checks price too (`:741`). |
| M2 | Met | `toPaise` plus a ₹1 crore cap (10⁹ paise, under the int max). Only error 23505 counts as a duplicate; other errors are rethrown (`actions.ts:778-792`). |
| M3 | Met | Reject on an order that was already confirmed redirects to `?handled=1` with a calm note (`actions.ts:808-841`, `payments/page.tsx:35`). Confirm after reject still confirms: see F4. |
| M4 | Partly met | See F1, F2, F3. Holders' tickets and the gate keep working while the fest is in review: the scanner allows live/review/draft (`queries.ts:93`), and payment completion only blocks cancelled fests (`orders.ts:162-163`). In-flight payments still turn into tickets. |
| M5 | Met | Kannada/Hindi names are transliterated, with a fallback to college/city/year. The output is limited to `[a-z0-9-]`. The DB `unique` constraint and the `taken()` loop are unchanged. Small length gap: F6. |
| L1 | Met | `.wrap-anywhere` / `overflow-wrap:anywhere` on headings (`globals.css:318`, `me/page.tsx:189-192`). |
| L2 | Met | New wording: "UTR sent — we'll confirm once the payment is seen in the fest's account." |
| L3 | Met | `UTR_RE` rejects a single digit repeated 12 times, with a clear message (`upi.ts:1027`). |
| L4 | Met | Create: the start date can't be in the past. Edit: only checked when the start date changes (`actions.ts:662`). |
| L5 | Met | The token is checked on page load (`reset-password/page.tsx:136-147`) and checked again on save. |
| L6 | Met | `?sent=` is now a ticket UUID. The name is looked up with `o.user_id = user.id`, so it shows nothing for someone else's ticket and no text from the link is shown (`tickets/page.tsx:236-249`). Cut by whole letters (`cutText`). |
| L7 | Met | A negative budget gets its own message (`sponsor/actions.ts:852`). |
| L8 | Met | 50 orders per page, page number capped at 1000, query uses parameters (`sales/page.tsx`). |
| L9 | Not testable | The cause (relative "ago" time) is replaced with a fixed IST date and time in a server component. Can only be confirmed by watching for it. |

## Findings (most severe first)

1. **Medium — must fix. The "rename a live fest → admin review" rule can be bypassed with Draft.** `organizer/actions.ts:670` only sends the
   fest to review when `cur.status === 'live'`. `setFestStatus` (`actions.ts:192-207`) lets an organizer go live → draft (or ended) at any
   time. Going back to live only asks for review when `approved_at` is null. So: live fest with 145 tickets → Settings → Draft → rename to
   anything → Live. The fest is live again under the new name with no admin check. Ticket holders get an email from THE FEST with
   the new name, which helps a scam. This is exactly what Harshith's rule is meant to stop.
   *Fix:* in `updateFest`, when holders > 0 and the name changed, set `approved_at = null` whatever the status. Move it to `review` if it
   is live; if it is draft or ended, leave the status and keep the note, so the next Live goes through review.
2. **Low–Medium. The review note can be wiped before the admin sees it.** `setFestStatus` sets `review_note = null` whenever it moves
   a fest to review (`actions.ts:205`). After a rename (status review), the organizer can go Draft → Live and the fest returns to
   review without the "Renamed from X to Y after tickets were sold" note. The admin sees an ordinary fest waiting for approval.
   *Fix:* keep the existing note when `approved_at` is null because of a rename, or store the rename note in its own column.
3. **Low. The tick box can be missing when the server asks for it.** The form decides whether to show the "I understand" box from the
   `holders` count when the page loaded (`settings/page.tsx:526`). If the first ticket sells while the organizer is still editing, the
   server replies "Tick 'I understand' and save again" but there is no box to tick. *Fix:* add "(refresh the page if you don't see it)"
   to that message, or always render the box when the server asks for it.
4. **Low — judgement, no change required. Confirm after Reject brings back the rejected order.** `confirmManually` accepts
   `status in ('pending','failed')` (`upi.ts:141`), so a stale second tab can issue tickets for an order a co-organizer just rejected.
   This is the existing "late payment" path, and Confirm means "I saw the money", so this is acceptable. A later nice-to-have: show
   "Rejected by a co-organizer a minute ago — confirm anyway?"
5. **Low (defence in depth). `safeNext` lets dot-segments through that resolve to `//host`** (`/..//e.org`). They stay on the same site
   and Next.js normalises them with a 308, so this is not exploitable today. *Fix (one line):* also reject when
   `new URL(n, base).pathname.startsWith('//')`.
6. **Low (contrived). `festSlug` fallback can go over 48 characters** (`format.ts:959`). `${slug}-fest-${year}-xxxx` is not cut back to
   48. It only happens when the name, college and city all slugify to "fest"/digits words and the name is long, e.g. 10× "Fest". Then the
   DB check `^[a-z0-9-]{3,48}$` fails and the organizer sees an error page. *Fix:* `.slice(0, 37)` on `slug` before adding the suffix.
7. **Info. Emails go out one after another in one background job** (`actions.ts:716-718`). Each `sendEmail` writes to `email_outbox`
   first. If one throws, the rest of the list is not sent. Plausible only on a Resend failure; check `sendEmail`'s error handling, or wrap
   each send in its own try.

Builder's flag (an approved fest with zero tickets sold can be renamed and stays live): this follows the brief as written ("Nothing
changes when no tickets are sold"), so it is not a violation. It is still a scam path: get approved as a real fest, rename it, then
sell. I recommend asking Harshith (below).

## Test plan for the Tester
1. **F1 bypass:** live fest with tickets → Settings → Draft → rename (tick "I understand") → Live. Expect `review` with the note, not `live`.
   Repeat with Ended → rename → Live.
2. **F2:** rename a live fest (goes to review) → Draft → Live. The admin queue must still show the "Renamed from…" note.
3. **M4 happy path:** change the venue only on a live fest with 3 holders (one of them a co-holder through a transfer). Expect 3 outbox rows
   with old → new and status stays live. Change dates so a sold lunch day falls out → blocked with the day named, nothing saved. Change
   dates that keep the lunch days → saved and emailed.
4. **M4 review state:** after a rename to review, holder opens /tickets and the QR → it works. Gate scan admits. Lunch scan works. A new
   buyer sees "not on sale". A pending bank-UPI order confirmed in review → tickets issued. Admin approves → live, note cleared.
5. **Zero tickets:** rename/date change on an approved fest with no tickets → no box, no emails, stays live.
6. **F3:** open Settings on a fest with 0 holders, buy a ticket in another browser, then rename → check the message lets the organizer go on.
7. **H1 live:** logged in, open `/login?next=` with each of `//e.org`, `/%5Ce.org`, `/%09/e.org`, `/..//e.org`, `/\e.org`, `javascript:alert(1)`.
   The browser must end on the same site every time. Also POST the login form with a tampered hidden `next`.
8. **M3:** two tabs: Confirm then Reject → calm note. Reject then Confirm → tickets issued (accepted behaviour). Reject twice → no crash.
9. **M1/M2 edges:** capacity `1000000` OK, `1000001` gets the message. Payout `20000000` OK, `20000001` gets the message. Sponsor `10000000`
   OK, `10000000.01` gets the message, `-1` says "can't be negative".
10. **M5:** create fests named only Kannada, only Hindi, only emoji, and "Fest" ×10 with college "Fest 2026" and city "Utsav". Expect readable,
    unique slugs and no error page.

## Questions for Harshith
- When an **approved fest with no tickets sold yet** is renamed, should it also go back to admin review? Today it stays live under the
  new name. Your decision said "nothing changes when no tickets are sold". Re-review would close a "get approved, then rename" scam,
  and the cost is low: no buyers to email, only a short wait for approval.

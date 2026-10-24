# Team & Roles — research brief + build plan (Oct 24, 2026)

## 1. Goal
The committee that runs a fest is many students, not one organizer. The owner (and co-organizers) should add each student
by email with a fixed role (Finance lead, Sponsorship lead, Media/PR, volunteers…) so each person sees and does only
their part. Access starts when the student's email is confirmed, ends the moment the role is removed, and every
important action (refunds, edits, scans, role changes) shows up in an activity log with who did it.

## 2. What Harshith already decided (BRIEF.md)
- "Team & Roles (approved plan, Oct 20): organizers assign roles to students — Co-organizer, Event head (one competition),
  Judge, Finance lead, Sponsorship lead, Media/PR, Volunteer (Gate/Lunch/Stay), Desk volunteer. Fixed roles in v1 (no
  custom roles); owner and co-organizers can assign, only the owner adds co-organizers; one student may hold several
  roles; optional limit to one event/day; activity log; pending until email confirmed. Comes before Competitions."
- Scanner counters (Oct 17): a volunteer's counter is set by the organizer (Gate / Lunch / Stay); a lunch volunteer only
  sees lunch, the stay desk only stay. No other counters.
- "The gate scanner always asks to log in again." Smart QR: sealed sections per role (gate / lunch / stay / organizer).
- Open decision 4: "Should co-organizers be allowed to refund? (Currently owner only.)" — still open; keep owner-only.
- Standing: plans lean, few rounds; changes to Supabase need his say-so (v2.7 is applied only after he says yes).

## 3. Findings
- **Current code (what exists):**
  - `fest_members` (co-organizers, by email) and `fest_staff` (volunteers: `duty`, `can_scan`, `checked_in_at`) —
    `db/schema.sql` L141, L294. Two tables, two UIs (Settings → co-organizers; Volunteers tab).
  - All organizer authorization goes through 3 helpers: `ownFest(fd,{ownerOnly})` (src/app/organizer/actions.ts L48, used
    by ~35 actions), `getOwnFest()` and the SQL fragment `canManage()` (src/lib/queries.ts). `canManage` is also used by
    `organizer/page.tsx`, the layout fest switcher, `sponsor/fests/[festId]/page.tsx`, `lib/sponsor-requests.ts` L125,
    `export/route.ts`, and `scannableFests()` → `/api/scan` + `/api/scan/keys`.
  - Access is binary today: owner = everything; co-organizer = everything except `ownerOnly` (refunds, UPI refund sent,
    cancel fest, add co-organizer, some Payments settings gated in UI by `is_owner`).
  - **Trap 1:** `requireUser('organizer')` guards every organizer page/action, so a **student account cannot open the
    dashboard**. Role holders are students → this guard must change to "any verified account with an active role".
  - **Trap 2:** scanner "manager" = `duty === null` row from `scannableFests` (via `canManage`). If `canManage` is simply
    widened to all roles, a Finance lead becomes a scanner manager and gets **every sealed QR section**. Manager must stay
    owner + co-organizer only.
  - **Trap 3:** a volunteer with two counters (Gate + Lunch) — `/api/scan` uses `rows[0].duty` only.
  - Volunteer counter comes from free-text `duty` via `counterFor()` (src/lib/scan.ts L21). Pending-until-verified
    already exists as a pattern: `canManage` ignores `fest_members` unless `user.verified`.
  - Existing test `tests/team.py` covers co-organizers; `tests/smartqr.py`, `tests/sponsor_requests.py` touch these tables.
- **Competitors:**
  - KonfHub: fixed roles per event — Organizer (one, unrestricted), Admin (no bank/settlement or ownership change),
    Admin-no-downloads, Member (no Team/Payments/Settlements), plus check-in roles (Co-organizer, Check-in staff,
    Volunteer). Invite by email; account required; "Removal revokes access immediately."
    [help.konfhub.com/dashboard/team](https://help.konfhub.com/dashboard/team.md),
    [KonfHub blog: team roles](https://blog.konfhub.com/managing-teams-in-konfhub-roles-permissions-and-collaboration-made-easy).
  - Eventbrite: custom roles built from permission groups (event creation, marketing, orders & attendees incl. refunds,
    reporting, payouts & billing, organization/team); event-level restriction exists for payouts.
    [Eventbrite permissions glossary](https://www.eventbrite.ca/help/en-ca/articles/362073/permissions-definitions/).
  - Takeaway: fixed roles + a hidden permission list underneath (so custom roles later = just new rows), money and
    team management kept to the top role, "no downloads" as a separate permission. That matches the BRIEF.
- **Law (India):** DPDP Rules 2025, Rule 6 — access control, "visibility on the accessing of such personal data, through
  appropriate logs", and "retain such logs and personal data for a period of one year"
  [dpdpa.com Rule 6](https://dpdpa.com/dpdparules/rule6.html). **Uncertain:** that page doesn't confirm final/commencement
  dates; treat 1-year log retention as the safe default, not a confirmed legal deadline. Not legal advice.

## 4. Recommendation (build plan)

### 4.1 Data model — schema v2.7 (additive, idempotent; old tables kept, not dropped)
```sql
-- v2.7 (Oct 2026): Team & Roles
create table if not exists fest_roles (
  id            uuid primary key default gen_random_uuid(),
  fest_id       uuid not null references fests(id) on delete cascade,
  email         citext not null,
  name          text not null default '',
  role          text not null check (role in ('co_organizer','event_head','judge','finance','sponsorship','media',
                                              'vol_gate','vol_lunch','vol_stay','desk')),
  scope_label   text,            -- "Battle of Bands" (free text in v1)
  scope_day     date,            -- optional: role works only on this IST day
  event_id      uuid,            -- reserved for Competitions; no FK yet
  duty          text,            -- volunteer's desk name, e.g. "Gate 2" (display only; counter comes from role)
  can_scan      boolean not null default true,
  checked_in_at timestamptz,
  added_by      uuid references users(id),
  created_at    timestamptz not null default now()
);
create unique index if not exists fest_roles_uniq
  on fest_roles(fest_id, email, role, coalesce(scope_day, '1970-01-01'::date), coalesce(scope_label, ''));
create index if not exists fest_roles_email_idx on fest_roles(email);

create table if not exists fest_activity (
  id          bigserial primary key,
  fest_id     uuid not null references fests(id) on delete cascade,
  actor_id    uuid references users(id) on delete set null,
  actor_email citext not null,
  actor_role  text not null,     -- 'owner' | role key | 'system'
  action      text not null,     -- 'refund','fest.edit','role.add','upi.confirm',…
  summary     text not null,     -- plain sentence shown in the log
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists fest_activity_idx on fest_activity(fest_id, created_at desc);
alter table fest_roles    enable row level security;
alter table fest_activity enable row level security;

-- one-time copy (safe to re-run): co-organizers and volunteers become roles
insert into fest_roles (fest_id, email, role, added_by, created_at)
  select fest_id, email, 'co_organizer', added_by, created_at from fest_members on conflict do nothing;
insert into fest_roles (fest_id, email, name, role, duty, can_scan, checked_in_at, created_at)
  select fest_id, email, name,
         case when lower(trim(duty)) like 'lunch%' then 'vol_lunch'
              when lower(trim(duty)) like 'stay%' or lower(trim(duty)) like 'hostel%' then 'vol_stay'
              else 'vol_gate' end,
         duty, can_scan, checked_in_at, created_at from fest_staff on conflict do nothing;
```
- After v2.7 the app reads and writes **only `fest_roles`**. `fest_members`/`fest_staff` stay untouched (rollback
  safety); drop them in a later version. Add `fest_roles`, `fest_activity` to `schema-check.ts`; the app shows the
  usual "database needs v2.7" notice if missing (pattern of `requestsReady()`).
- **Active role** = row exists AND a `users` row with that email has `email_verified_at` AND (`scope_day` is null or
  = today IST). Otherwise **Pending** (no account / email not confirmed) or **Not today**. Computed on every request —
  no caching — so removal cuts access on the next click.
- Limits: 10 co-organizers (as today); 300 role rows per fest.

### 4.2 Permission matrix (one file `src/lib/roles.ts`: role → permissions; nothing else decides access)
| Permission (tabs/actions) | Owner | Co-org | Finance | Sponsorship | Media/PR | Event head | Judge | Desk | Vol G/L/S |
|---|---|---|---|---|---|---|---|---|---|
| Overview (stats) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (read) | – | – | – |
| Fest edit, Publish, Tickets tab, ticket types, transfers toggle | ✓ | ✓ | – | – | – | – | – | – | – |
| Sales list (buyers' names/emails) | ✓ | ✓ | ✓ | – | – | – | – | ✓ (lookup, no totals) | – |
| Refund / mark UPI refund sent | ✓ | – * | – * | – | – | – | – | – | – |
| Payments tab: confirm/reject UPI, paste alerts, statements | ✓ | ✓ | ✓ | – | – | – | – | – | – |
| Payments settings (UPI ID, inbound link) | ✓ | – | – | – | – | – | – | – | – |
| Analytics | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| CSV export | ✓ | ✓ | ✓ | – | – | – | – | – | – |
| Schedule edit | ✓ | ✓ | – | – | ✓ | view | – | – | – |
| Announcements | ✓ | ✓ | – | – | ✓ | – | – | – | – |
| Sponsors tab, brand requests, open-to-brands, reports | ✓ | ✓ | – | ✓ | – | – | – | – | – |
| Team: add/remove non-co-org roles, reset scanner keys | ✓ | ✓ | – | – | – | – | – | – | – |
| Team: add/remove co-organizers | ✓ | leave self | – | – | – | – | – | – | – |
| Activity log | ✓ | ✓ | – | – | – | – | – | – | – |
| Cancel fest | ✓ | – | – | – | – | – | – | – | – |
| Scanner | all counters + organizer seal | same | – | – | – | – | – | Gate | own counter(s) only |

\* Refunds stay owner-only until Harshith answers Q1 (one constant in `roles.ts`).
Several roles → union of permissions. Event head / Judge get little in v1 on purpose — they are ready for Competitions
(event_id) and show on the student's "My fest roles".

### 4.3 Server-side enforcement (biggest risk — do this first)
- New `src/lib/fest-access.ts`:
  - `festAccess(festId, user)` → `{ fest, isOwner, roles[], perms: Set<Perm> }` or null (one SQL query, active roles only).
  - `requirePerm(fd, perm)` — replaces **every** `ownFest()` call in `actions.ts` (each action names its permission;
    no default). Returns the same `{ user, fest }` shape so action bodies barely change. Wrong perm → error
    "Your role can't do this." Unknown fest / no role → "Fest not found" (don't reveal fests).
  - `pageAccess(festId, perm)` — replaces `getOwnFest` in each page under `organizer/[festId]/**` and
    `export/route.ts`; no fest access → `notFound()`, missing perm → a "Your role can't open this tab" page.
  - Replace `canManage()` uses: organizer home + switcher list fests with any active role; sponsor-requests decide →
    `sponsorship` perm; `sponsor/fests/[festId]` organizer branch → `sponsorship`.
  - `requireUser('organizer')` stays only for creating a fest (`/organizer/new`, `createFest`). Fest pages/actions accept
    any account role with an active fest role; owner is still the organizer-account owner.
- Scanner: `scannableFests` returns `manager` only for owner/co-organizer; others get the **set** of their counters
  (`vol_gate`, `desk` → gate; `vol_lunch` → lunch; `vol_stay` → stay). `/api/scan` accepts the browser's counter only if
  it is in that set; `/api/scan/keys` seals only those roles. `scope_day` respected (not today → 403 "Your shift is on <day>").
- Removing a role: delete the row, delete that person's **scanner sessions** if they have no scan role left for the fest
  (same SQL as `resetScannerKeys`), log it. Show: "They may still hold offline keys until the end of the fest — reset
  scanner keys if their phone is not trusted."
- Static guard test: a script fails the build if any exported function in `organizer/actions.ts` doesn't call
  `requirePerm`/`requireOwner`, or any page under `organizer/[festId]` doesn't call `pageAccess`.

### 4.4 Activity log
- `logActivity(tx, {festId, user, role, action, summary, detail})` called inside the same transaction as: role add/
  remove/leave, fest edit/status/rename, ticket type add/edit/toggle, refunds, UPI confirm/reject/refund sent, statement
  upload, payments settings, sponsor add/remove, brand request send/decide, announcement post/delete, schedule add/delete,
  scanner key reset, cancel fest.
- Scans are **not** copied (already in `scans` with `scanner_id`); the log viewer has a "Scans" filter that reads
  `scans` (per volunteer counts + latest 100).
- Viewer: Team page → "Activity" section, newest first, 50 per page, filter by person / type; times in IST.
  Append-only: no edit/delete in the app. Keep 1 year (cleanup job like the error log).
- Never store ticket QR secrets, bank details or full UPI statements in `detail` — only ids, amounts, counts.

### 4.5 Team page (rename "Volunteers" tab → "Team"; `/volunteers` redirects to `/team`)
- Top: counts — Active, Pending, On duty today.
- "Add to team" form: email, name, role (dropdown; Co-organizer only shown to owner), optional "Only for" event text,
  optional day (date picker limited to fest dates), desk name (volunteer roles only). Same person can be added again
  with another role.
- List grouped by person: name, email, role badges (with scope/day), status badge **Pending — email not confirmed /
  no account yet**, Active, Not today; actions Remove role, Check in (volunteers), scans count.
- Co-organizer block moves here from Settings (Settings links to Team).
- Email on add (existing `afterResponse` + `sendEmail`): "You've been added as <role> for <fest>. Sign up / log in and
  confirm your email." Any account type works.
- Mobile 390px: one column cards, role select full width, no horizontal scroll.

### 4.6 Student "My fest roles" (`/me` and organizer home)
- Card per fest: fest name, dates, role badges + scope/day, status. Buttons: "Open dashboard" (if the role has any tab;
  lands on the first allowed tab), "Open scanner" (scan roles), "Leave role" (confirm). Pending shows "Confirm your email
  to start" + resend link. Replaces the current `fest_staff` count on `/me`.
- OrgShell shows only allowed tabs (from `perms`), header shows "You: Finance lead".

### 4.7 Tests (`tests/team_roles.py`, add to `run-e2e.sh`)
- Per role, log in as that role and **POST forged forms** (hidden `festId` / `id` of a fest/row they don't control) to
  every action outside their permissions → refused, DB unchanged. Same for direct URLs of every tab + export.
- Pending: unverified account with role → no tab, no scan; after confirming → access.
- Removal: role holder has a tab open → owner removes → next click shows not found; scanner gets 401/403.
- Co-org can't add/remove co-orgs or touch owner; co-org can add Finance lead; Finance lead can't add anyone.
- Day scope: role with tomorrow's date → "Not today" and scanner 403.
- Two counters: Gate + Lunch volunteer can switch only between those two; Finance lead gets no sealed sections.
- Migration: run v2.7 twice on a DB with old members/staff → same row counts, old volunteers still scan same counter.
- Activity rows written for refund, role add/remove, fest edit; viewer hidden from non-co-org roles.
- Existing `team.py`, `smartqr.py`, `sponsor_requests.py`, full `run-e2e.sh` still pass. 390px screenshots of Team, /me.

## 5. Acceptance criteria
1. Owner and co-organizers can add any listed role except Co-organizer; only the owner can add/remove co-organizers;
   a co-organizer can leave; nobody can remove or demote the owner.
2. One email can hold several roles (and the same role on two days); duplicates are refused with a clear message.
3. A role grants nothing until an account with that email has confirmed its email; the Team page shows "Pending".
4. Removing a role cuts dashboard access on the very next request and ends that person's scanner sessions.
5. Each role sees exactly the tabs in the matrix (4.2); other tabs are hidden **and** their URLs return
   not-found/"Your role can't open this tab"; export CSV follows the same rule.
6. Every organizer server action checks its permission server-side; forged forms from every role are refused and
   change nothing (tested); the static guard finds no unguarded action/page.
7. Refunds remain owner-only (until Q1 answered); Payments settings and Cancel fest owner-only.
8. Volunteers scan only their counter(s); desk volunteers scan Gate; only owner/co-org get the organizer sealed section;
   a day-limited role works only on that IST day.
9. Existing co-organizers and volunteers keep the same access after v2.7 with no action by the organizer; v2.7 can be
   run twice safely and drops nothing.
10. Activity log records who (name, role), what, when (IST) for the actions in 4.4, amounts in ₹ match the orders;
    visible only to owner and co-organizers; cannot be edited or deleted in the app.
11. Students see "My fest roles" on /me with status and the right buttons; leaving a role works.
12. Team page, /me roles card and role-limited dashboard work at 390px with no horizontal scroll.
13. Full `run-e2e.sh` passes.

## 6. Out of scope (v1)
- Custom roles or per-person permission ticks; role templates; copying a team from last year.
- Real event-linked scoping (needs Competitions) — `event_id` column reserved only; Judge scoring.
- Accept/decline invite step (email confirmation is the gate); sponsor-side roles; WhatsApp invites.
- Volunteer shifts (separate Must item), payouts to volunteers, certificates.
- Dropping `fest_members`/`fest_staff` (later version after a release).
- Revoking offline scanner keys already downloaded (existing "Reset scanner keys" covers it).

## 7. Questions for Harshith
1. **Who may refund?** (also open decision 4) — Options: owner only / owner + Finance lead / owner + co-orgs + Finance.
   **Recommend: owner + Finance lead**, every refund in the activity log. Built as owner-only until he answers.
2. **Can a role holder use a student account, or must they make an organizer account?** **Recommend: any account** —
   students already have student accounts; making them sign up again loses people. (Co-organizers today need an
   organizer account; this would relax that too.)
3. **Desk volunteer's job** — **Recommend: attendee lookup (name/email/ticket code, no money totals) + Gate scanning.**
   Alternative: also confirm bank-UPI payments at the desk (more money risk).
4. **Applying v2.7 to both Supabase databases** (`thefest` and `thefest-preview`) once tests pass — **Recommend: yes, both**
   (additive, old tables kept).

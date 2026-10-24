# Team & Roles: Tester pass 1 (Oct 24, 2026)

HEAD 4b5fe45 (full-app). Local Postgres, demo seed (`db:seed -- --reset`), `DEMO_PAYMENTS=1 next start` on :3000.
Manual real-browser pass (Playwright Chromium) at 390px (phone) and 1280px, logged in as each role.
Release check: not re-run, per the coordinator (the Builder's full run passed, 920 checks).

## Result: FAILURES (2 functional, 3 wording/layout, 3 minor)

## Failures

**F1. Sponsorship lead and Media/PR see revenue on Analytics, and get a CSV button that leads to "Not found"**
- Did: logged in as sponsorlead@seed.thefest.in (and media@seed.thefest.in), opened the Analytics tab.
- Expected: no money figures, because these roles lack the `money` permission. Overview already hides ₹ for them.
  No export button, because they lack `export`.
- Happened: the "Your revenue ₹83.2K after fees · ₹85.2k collected" card shows, plus refund counts.
  The "Download attendee CSV" button shows, and clicking it goes to `/export`, which returns a plain-text 404 "Not found".
  The footer links to Sales, which they also can't open.
- Screenshot: roles-shots/sponsorship_tab_analytics_390.png (also media_tab_analytics_*.png)
- Likely file: `src/app/organizer/[festId]/analytics/page.tsx` (line 73: CSV link not gated by `perms.has('export')`;
  revenue cards not gated by `perms.has('money')`; line 185: Sales link).

**F2. "Open scanner" / "Gate scanner" shown to roles that can't scan**
- Did: as Finance lead, Media/PR+Judge, Sponsorship lead, or a Judge on their day, opened a forbidden tab
  (no-access page) and looked at the sidebar.
- Expected: the scanner link only for roles that have a counter (owner, co-organizer, gate/lunch/stay/desk volunteers).
- Happened: the no-access page always shows an "Open scanner" button, and the sidebar always shows "📷 Gate scanner".
  Clicking either and logging in gives "You're not on any fest's gate team yet". A lunch or stay volunteer also sees
  the label "Gate scanner" for their lunch/stay scanner.
- Screenshots: roles-shots/media_noaccess_390.png, finance_noaccess_1280.png, judge_today_dashboard_390.png
- Likely files: `src/app/organizer/[festId]/no-access/page.tsx` (unconditional `<Link href="/scan/login">`),
  `src/components/OrgShell.tsx` line 47.

## Wording / layout (should fix)
- W1. Scanner counter picker at 390px: when the counter dropdown shows (owner, co-organizer, and now any two-counter
  volunteer), the "GATE" heading gets squeezed into one letter per line beside the select.
  roles-shots/scanner_owner_390.png. `src/app/scan/Scanner.tsx` ~L320 (`.grow display` + select `minWidth:150`).
  This existed before for managers. v2.7 now shows it to Gate+Lunch volunteers as well.
- W2. The unconfirmed-email banner on /me still says "Fests can only share access (co-organizer, gate team, sponsor
  dashboard) with a confirmed email". That is out of date now that there are 10 roles. roles-shots/pending_unverified_me_390.png.
- W3. "Add to team" date field at 390/1280 is prefilled as "10/dd/2026" (half-filled month/year). This looks like a bug.
  roles-shots/owner_tab_team_390.png.

## Minor / observations
- M1. The owner appears twice in the Team list: an "Owner" card, plus a separate "Riya Kapoor · Gate volunteer" card.
  The plan says one card per person. A co-organizer sees a "Remove" button on the owner's volunteer role. It only removes the
  volunteer role, not ownership, but it can be confusing.
- M2. Pending people (no account yet) still show a "Check in" button. The seed has pending gate2/gate3 marked "In since 9:20".
- M3. The seed adds roles for desk@, gate2@, gate3@ and stage@seed.thefest.in but creates **no accounts** for them, so the
  Desk volunteer and Gate 2 can't be tried from the seed with password123 (login fails; they show "Pending — no
  account yet"). For this pass I created accounts for desk@ and gate2@ with SQL. `scripts/seed.mjs` L163–176.

## Passed (checked by hand)
- Tabs per role match the plan 4.2 matrix at 390 and 1280. Owner/co-org: all 10. Finance: Overview, Sales,
  Analytics, Payments. Sponsorship: Overview, Analytics, Sponsors. Media+Judge: Overview, Analytics, Schedule,
  Announce. Event head: Overview, Schedule (read-only, no forms). Desk: Sales only. Lunch/Stay: none.
  Typing the URL of a forbidden tab shows "Your role can't open this tab". `/volunteers` redirects to `/team`.
  CSV export works for owner, co-org and finance, and returns 404 for everyone else.
- Owner's role list includes Co-organizer. The co-organizer's list doesn't. Co-org sees "Leave" on themselves and
  adds an Event head ("Dance off") fine. Co-org sees the Activity log.
- Adding someone with a Kannada name (ರಾಹುಲ್ ಶರ್ಮಾ) works, and a double-click creates exactly 1 row. Adding the same
  email again in UPPERCASE with the same role is refused: "already has that role". The log shows "Added ರಾಹುಲ್ ಶರ್ಮಾ
  as Finance lead". A Hindi-name unconfirmed account shows "Pending — email not confirmed" on /me and gets 404
  on its tabs.
- Finance lead: refund works (double-click = 1 refund, ₹314, logged as finance). Payments page has no UPI settings
  ("Only the fest's owner can change this"). The scanner refuses them, so they get no organizer sealed section.
- Desk volunteer: Sales lookup by ticket code works with no ₹ anywhere. Gate scanner only. "Open dashboard" and
  "Open scanner" on /me.
- Lunch / Stay volunteers: the scanner opens only on "Lunch counter" / "Stay desk".
- Day-limited Judge: "Not today" on /me and the Team tab, and 404 on the dashboard. On their day: Active, no-access page.
  A day-limited volunteer on another day is told "Your shift at Neon Utsav is on Oct 25, 2026."
- Leave role on /me (lunch): confirm step, "You left that role.", row deleted, logged "Lata Lunch left the role".
- Removal: Finance's next click after removal shows 404. Desk removed while their scanner is open: owner sees "Role
  removed — their access ends now. They may still hold offline scanner keys…". `/api/scan` returns 401 and a reload
  goes to `/scan/login`. Both removals are logged with "Riya Kapoor (Owner)" and the IST time.
- No horizontal scroll on any page visited at 390 or 1280 (every tab × 13 accounts).

## Screenshots reviewed
In /tmp/claude-0/-home-claude/cc088623-4899-552f-8085-96c0a732cfaf/scratchpad/roles-shots/:
- owner_tab_team_390/1280: counts, form, cards, badges, activity filters. W3 and M1 found here.
- lunch_me_roles_390, media_me_1280, pending_unverified_me_390: My fest roles cards, buttons, pending text (W2).
- finance_noaccess_1280, media_noaccess_390, judge_today_dashboard_390: restricted tab bars and the no-access page (F2).
- sponsorship_tab_analytics_390: revenue and CSV leak (F1).
- owner_activity_390/1280: log entries, readable at both widths.
- scanner_*_390: counters per role. W1 found on scanner_owner_390.
- desk_sales_lookup_390, finance_refund_open_390, eventhead_schedule_390, daylimited_scanner_390.

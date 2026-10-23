#!/usr/bin/env bash
# Full release check against a LOCAL database. Never point this at production:
# it wipes and reseeds the database.
# Needs: local Postgres in DATABASE_URL (.env.local), ffmpeg, Python + playwright (chromium).
# Usage: bash tests/run-e2e.sh        (starts its own server on :3000 after `npm run build`)
set -euo pipefail
cd "$(dirname "$0")/.."
export E2E_DIR="${E2E_DIR:-/tmp/thefest-e2e}"; mkdir -p "$E2E_DIR"
DB_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-)
case "$DB_URL" in *localhost*|*127.0.0.1*) ;; *) echo "Refusing: DATABASE_URL is not local"; exit 1;; esac
PSQL="psql $DB_URL -qtA -F ' '"

# Pure-logic checks first (fast)
node scripts/check-pricing.mjs 2>/dev/null
node scripts/check-upi-parse.mjs 2>/dev/null
node --conditions=react-server scripts/check-qr2.mjs 2>/dev/null
node scripts/check-format.mjs 2>/dev/null

# Stop any server already on :3000
for d in /proc/[0-9]*; do c=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null || true); case "$c" in next-server*) kill "${d#/proc/}" 2>/dev/null || true;; esac; done
sleep 1

npm run -s db:setup
npm run -s db:setup   # twice: the schema must be safe to re-run
npm run -s db:seed -- --reset > /dev/null
# Local test settings (never set in Vercel): the pretend demo checkout, a test-only error route,
# and an admin address for error alerts. Production-mode behaviour is tested in tests/prod.py.
export DEMO_PAYMENTS=1 E2E_ERROR_ROUTE=1 ADMIN_EMAILS=admin@thefest.in
PORT=3000 npx next start > "$E2E_DIR/server.log" 2>&1 &
SERVER=$!; trap 'kill $SERVER 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf localhost:3000/api/health > /dev/null && break; sleep 1; done

# Fake camera feed: the demo student's real signed ticket QR
eval "$PSQL" -c "\"select t.id, t.fest_id, t.code from tickets t join users u on u.id=t.user_id join fests f on f.id=t.fest_id where u.email='student@thefest.in' and f.slug='neon-utsav' and t.status='valid' limit 1\"" > "$E2E_DIR/student_ticket.txt"
PAYLOAD=$(node scripts/sign-ticket.mjs $(cut -d' ' -f1,2 "$E2E_DIR/student_ticket.txt"))
node -e "require('qrcode').toFile(process.argv[1], process.argv[2], {width:600, margin:4})" "$E2E_DIR/qr.png" "$PAYLOAD"
ffmpeg -loglevel error -y -loop 1 -i "$E2E_DIR/qr.png" -vf "scale=640:640,format=yuv420p" -t 6 -r 15 "$E2E_DIR/qr.y4m"

python3 tests/e2e.py
python3 tests/upi.py
python3 tests/refunds.py
python3 tests/password.py

# Race tests on fresh rows
export RACE_FEST=$(eval "$PSQL" -c "\"select id from fests where slug='neon-utsav'\"")
export RACE_CODE=$(eval "$PSQL" -c "\"select code from tickets where fest_id='$RACE_FEST' and status='valid' limit 1\"")
export RACE_TT=$(eval "$PSQL" -c "\"update ticket_types set quota = sold + 1 where fest_id=(select id from fests where slug='kalaa-fest') and name='Workshop Bundle' returning id\"")
export RACE_LUNCH_CODE=$(eval "$PSQL" -c "\"select t.code from tickets t join ticket_types tt on tt.id=t.ticket_type_id where t.fest_id='$RACE_FEST' and tt.name='3-Day Pass' and t.status<>'void' and not exists (select 1 from perk_redemptions p where p.ticket_id=t.id) order by t.code desc limit 1\"")
python3 tests/race.py
python3 tests/team.py
python3 tests/analytics.py
python3 tests/errors.py
# Production-mode checks start their own servers on :3001/:3002 (APP_ENV=production etc.)
python3 tests/prod.py
bash tests/ops.sh
# Tester round 1 (2026-10-17): money safety with a fake Cashfree (:3003), schema-upgrade/backup encryption,
# missing-table health, /setup/keys pairs, error bursts, keys-removed ticket page (:3004)
python3 tests/money.py
bash tests/schema_backup.sh
python3 tests/prod_extra.py
# Fix round 1 (2026-10-17): fail-safe production detection, database setup check, per-network login throttle,
# error-log de-duplication/pruning, /setup/keys for another environment, 390px margins, safe .env.example (:3005)
python3 tests/fixes1.py
# Fix round 2 (2026-10-17): login throttle counts first (parallel bursts can't overshoot), admin "Unlock a login"
python3 tests/throttle.py
# Tester round 2 (2026-10-17): the supervisor's round-2 plan on database copies (:3006): production detection and
# money with a fake Cashfree, 200-way login bursts, 60 rotating networks, admin "Unlock a login" abuse and odd emails,
# missing tables/columns, Part 2a on old databases, error-log bursts and pruning, /setup/keys, 390/1280 screenshots
python3 tests/round2.py
# Smart QR (2026-10-18): public /t/ page, sealed sections per scanner role offline, live code, key reset, offline sync (fix round 1: first aid removed, sync resilience, lunch day, lock)
python3 tests/smartqr.py
# Sponsor leads + ROI report (2026-10-18): opt-in sharing at the booth (18+), stop sharing, sponsor leads/CSV/withdrawn,
# report numbers, access, organizer counts only, print, 390px, old database without v2.5 (:3007)
python3 tests/sponsor_leads.py
# Sponsorship requests (2026-10-18): brand profile + directory, Find fests + media kit (real numbers, no personal data),
# requests both ways, accept → sponsors row (double-click safe), limits, side checks, contacts after accept,
# co-organizers, 390px, old database without v2.6 (:3008)
python3 tests/sponsor_requests.py
# Bug-hunt fixes (2026-10-23): safe ?next= redirects, number limits, two-tab Confirm/Reject, fest changes after tickets are
# sold (holders emailed, rename → review, sold lunch days kept), Kannada/Hindi slugs, UTR/past-date/reset-link/?sent= fixes,
# whole-letter cuts, budget hints, Sales paging, no hydration errors
python3 tests/bugfix_oct23.py
echo "✓ Release check passed"

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

# Stop any server already on :3000
for d in /proc/[0-9]*; do c=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null || true); case "$c" in next-server*) kill "${d#/proc/}" 2>/dev/null || true;; esac; done
sleep 1

npm run -s db:setup
npm run -s db:seed -- --reset > /dev/null
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

# Race tests on fresh rows
export RACE_FEST=$(eval "$PSQL" -c "\"select id from fests where slug='neon-utsav'\"")
export RACE_CODE=$(eval "$PSQL" -c "\"select code from tickets where fest_id='$RACE_FEST' and status='valid' limit 1\"")
export RACE_TT=$(eval "$PSQL" -c "\"update ticket_types set quota = sold + 1 where fest_id=(select id from fests where slug='kalaa-fest') and name='Workshop Bundle' returning id\"")
python3 tests/race.py
echo "✓ Release check passed"

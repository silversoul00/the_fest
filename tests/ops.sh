#!/usr/bin/env bash
# Operational checks (no browser): seed safety, schema/RLS, encrypted backup round-trip, deploy config,
# no fire-and-forget promises on the server, and a build with NO environment variables at all.
# Called by tests/run-e2e.sh. Local Postgres only.
set -uo pipefail
cd "$(dirname "$0")/.."
E2E_DIR="${E2E_DIR:-/tmp/thefest-e2e}"; mkdir -p "$E2E_DIR"
PG="psql -h /tmp -U postgres"
pass=0; fail=0
check() { if [ "$2" = 0 ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 ${3:-}"; fail=$((fail+1)); fi; }

# ── Seed refuses any non-local database (criterion 24) ──
out=$(DATABASE_URL='postgresql://postgres.abc:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres' timeout 20 node scripts/seed.mjs 2>&1); rc=$?
[ $rc -ne 0 ] && grep -q "Refusing to seed" <<<"$out"; check "seed refuses a Supabase URL" $?
out=$(DATABASE_URL='postgresql://u:p@db.example.com:5432/x' timeout 20 node scripts/seed.mjs --reset 2>&1); rc=$?
[ $rc -ne 0 ] && grep -q "Refusing to seed" <<<"$out"; check "seed --reset refuses a remote URL too" $?

# ── Schema re-runs cleanly and new tables have RLS on (criterion 25) ──
npm run -s db:setup >/dev/null && npm run -s db:setup >/dev/null; check "schema applies twice in a row" $?
n=$($PG thefest -tAc "select count(*) from pg_class where relname in ('login_attempts','app_errors','app_alert_state') and relrowsecurity")
[ "$n" = 3 ]; check "login_attempts, app_errors, app_alert_state have RLS enabled" $? "$n"
n=$($PG thefest -tAc "select count(*) from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and not c.relrowsecurity")
[ "$n" = 0 ]; check "every table in public has RLS enabled" $? "$n without"

# ── Encrypted backup → restore round-trip (criterion 26) ──
BK="$E2E_DIR/backup"; rm -rf "$BK"; mkdir -p "$BK"
FILE=$(BACKUP_DATABASE_URL=postgres://postgres@localhost:5432/thefest BACKUP_PASSPHRASE='release check pass' bash scripts/backup.sh "$BK" 2>&1 | tail -1)
[ -s "$FILE" ]; check "backup.sh writes an encrypted file" $?
[ "$(grep -c 'CREATE TABLE' "$FILE")" = 0 ] && ! grep -q "student@thefest.in" "$FILE"; check "backup file is not readable as SQL / no plain emails" $?
$PG postgres -qc "drop database if exists thefest_restore" 2>/dev/null; $PG postgres -qc "create database thefest_restore"
RESTORE_DATABASE_URL=postgres://postgres@localhost:5432/thefest_restore BACKUP_PASSPHRASE='wrong' bash scripts/restore.sh "$FILE" >/dev/null 2>&1
[ $? -ne 0 ]; check "restore fails with the wrong passphrase" $?
RESTORE_DATABASE_URL=postgres://postgres@localhost:5432/thefest_restore BACKUP_PASSPHRASE='release check pass' bash scripts/restore.sh "$FILE" >/dev/null; check "restore.sh restores into a fresh database" $?
COUNTS="select (select count(*) from users)||','||(select count(*) from fests)||','||(select count(*) from orders)||','||(select count(*) from tickets)"
a=$($PG thefest -tAc "$COUNTS"); b=$($PG thefest_restore -tAc "$COUNTS")
[ "$a" = "$b" ]; check "restored row counts match (users,fests,orders,tickets)" $? "$a vs $b"
RESTORE_DATABASE_URL=postgres://postgres@localhost:5432/thefest BACKUP_PASSPHRASE='release check pass' bash scripts/restore.sh "$FILE" >/dev/null 2>&1
[ $? -ne 0 ]; check "restore refuses a database that already has data" $?
$PG postgres -qc "drop database if exists thefest_restore"

# ── Deploy config (criterion 23) ──
node -e "const v=require('./vercel.json'); process.exit(v.framework==='nextjs' && JSON.stringify(v.regions)==='[\"bom1\"]' ? 0 : 1)"; check "vercel.json: framework nextjs, region bom1 (Mumbai)" $?
node -e "process.exit(require('./package.json').engines.node==='22.x' ? 0 : 1)"; check "package.json engines.node is 22.x" $?
if git rev-parse -q --verify main >/dev/null && git rev-parse -q --verify origin/main >/dev/null; then
  [ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ]; check "no local commits on main" $?
fi
WF=.github/workflows/db-backup.yml
grep -q 'secrets.BACKUP_DATABASE_URL' $WF && grep -q 'secrets.BACKUP_PASSPHRASE' $WF && grep -q 'retention-days' $WF && ! grep -qE 'postgres(ql)?://' $WF
check "backup workflow uses secrets only and sets retention-days" $?

# ── No fire-and-forget promises in server code (criterion 15) ──
bad=$(grep -rln "catch(() => {})" src | xargs -r grep -L "^'use client'" || true)
[ -z "$bad" ]; check "'.catch(() => {})' only in client files" $? "$bad"

# ── next build works with no environment variables at all (criterion 12) ──
if [ "${SKIP_BARE_BUILD:-}" != 1 ]; then
  BARE="$E2E_DIR/bare-build"; rm -rf "$BARE"; mkdir -p "$BARE"
  tar --exclude=./node_modules --exclude=./.next --exclude='./.env*' --exclude=./.git --exclude=./tests -cf - . | tar -xf - -C "$BARE"
  ln -s "$PWD/node_modules" "$BARE/node_modules"
  (cd "$BARE" && env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 npx next build > "$E2E_DIR/bare-build.log" 2>&1); check "next build succeeds with no env vars (no DB, no keys)" $? "see $E2E_DIR/bare-build.log"
  rm -rf "$BARE"
fi

echo; echo "$pass/$((pass+fail)) ops checks passed"
[ $fail = 0 ]

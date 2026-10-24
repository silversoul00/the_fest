#!/usr/bin/env bash
# Upgrade path and backup encryption checks (no browser). Local Postgres only.
#  • The production update SQL in docs/LAUNCH-CHECKLIST.md Part 2a, run twice on a v2.1 database (abc3924),
#    gives the same three tables, index and RLS as db/schema.sql.
#  • A backup file is really encrypted: not a pg_dump file, gpg sees a symmetric-key packet, pg_restore can't read it.
#  • The plain "no CREATE TABLE" grep can't tell an encrypted backup from an unencrypted pg_dump -Fc (recorded).
set -uo pipefail
cd "$(dirname "$0")/.."
E2E_DIR="${E2E_DIR:-/tmp/thefest-e2e}"; mkdir -p "$E2E_DIR"
PG="psql -h /tmp -U postgres -v ON_ERROR_STOP=1"
pass=0; fail=0
check() { if [ "$2" = 0 ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 ${3:-}"; fail=$((fail+1)); fi; }

# ── Part 2a on a v2.1 database ──
SQL="$E2E_DIR/part2a.sql"
awk '/^\*\*2a\./{f=1} f&&/^```sql/{g=1;next} g&&/^```/{exit} g' docs/LAUNCH-CHECKLIST.md > "$SQL"
grep -q 'create table if not exists login_attempts' "$SQL"; check "Part 2a SQL found in LAUNCH-CHECKLIST.md" $?
for db in tf_v21 tf_now; do $PG postgres -qc "drop database if exists $db" >/dev/null 2>&1; $PG postgres -qc "create database $db" >/dev/null; done
git show abc3924:db/schema.sql > "$E2E_DIR/schema-v21.sql"
$PG tf_v21 -q -f "$E2E_DIR/schema-v21.sql" >/dev/null 2>"$E2E_DIR/v21.err"; check "v2.1 schema (abc3924) builds" $? "$(head -3 "$E2E_DIR/v21.err")"
n=$($PG tf_v21 -tAc "select count(*) from pg_class where relname in ('login_attempts','app_errors','app_alert_state')")
[ "$n" = 0 ]; check "v2.1 database has none of the three new tables (true starting point)" $? "$n"
$PG tf_v21 -q -f "$SQL" >/dev/null 2>"$E2E_DIR/p2a-1.err"; check "Part 2a runs on v2.1 with no error" $? "$(cat "$E2E_DIR/p2a-1.err")"
$PG tf_v21 -q -f "$SQL" >/dev/null 2>"$E2E_DIR/p2a-2.err"; check "Part 2a runs a second time with no error" $? "$(cat "$E2E_DIR/p2a-2.err")"
$PG tf_now -q -f db/schema.sql >/dev/null 2>&1; check "current db/schema.sql builds a fresh database" $?
shape() { # columns, defaults, constraints, indexes and RLS of the three tables
  $PG "$1" -tAc "select table_name, column_name, data_type, is_nullable, coalesce(column_default,'') from information_schema.columns
                  where table_schema='public' and table_name in ('login_attempts','app_errors','app_alert_state') order by 1,2"
  $PG "$1" -tAc "select conrelid::regclass, contype, pg_get_constraintdef(oid) from pg_constraint
                  where conrelid::regclass::text in ('login_attempts','app_errors','app_alert_state') order by 1,2,3"
  $PG "$1" -tAc "select indexname, indexdef from pg_indexes where tablename in ('login_attempts','app_errors','app_alert_state') order by 1"
  $PG "$1" -tAc "select relname, relrowsecurity from pg_class where relname in ('login_attempts','app_errors','app_alert_state') order by 1"
}
shape tf_v21 > "$E2E_DIR/shape-v21.txt"; shape tf_now > "$E2E_DIR/shape-now.txt"
diff "$E2E_DIR/shape-v21.txt" "$E2E_DIR/shape-now.txt" > "$E2E_DIR/shape.diff"; check "after Part 2a the three tables match db/schema.sql exactly" $? "$(head -5 "$E2E_DIR/shape.diff")"
[ "$(grep -c '|t$' "$E2E_DIR/shape-v21.txt")" = 3 ]; check "RLS on for all three after Part 2a" $?
# The whole current schema applied over v2.1 + Part 2a is also clean (the "(Running all of db/schema.sql does the same)" note)
$PG tf_v21 -q -f db/schema.sql >/dev/null 2>"$E2E_DIR/full-over.err"; check "full db/schema.sql applies on top afterwards" $? "$(head -3 "$E2E_DIR/full-over.err")"
for db in tf_v21 tf_now; do $PG postgres -qc "drop database if exists $db" >/dev/null; done

# ── Backup really encrypted ──
BK="$E2E_DIR/backup2"; rm -rf "$BK"; mkdir -p "$BK"
FILE=$(BACKUP_DATABASE_URL=postgres://postgres@localhost:5432/thefest BACKUP_PASSPHRASE='tester pass' bash scripts/backup.sh "$BK" 2>&1 | tail -1)
[ -s "$FILE" ]; check "backup.sh wrote a file" $?
[ "$(head -c 5 "$FILE")" != "PGDMP" ]; check "backup file is not a pg_dump file (no PGDMP header)" $?
pk=$(gpg --batch --list-packets --pinentry-mode loopback --passphrase '' "$FILE" 2>&1 </dev/null || true)
grep -qE 'symkey enc packet|:symkey enc packet:' <<<"$pk"; check "gpg --list-packets (no passphrase) shows a symmetric-key packet" $? "$(head -3 <<<"$pk")"
pg_restore --list "$FILE" >/dev/null 2>&1; [ $? -ne 0 ]; check "pg_restore --list cannot read the backup file" $?
PLAIN="$BK/plain.dump"; pg_dump --format=custom --schema=public --no-owner postgres://postgres@localhost:5432/thefest > "$PLAIN"
old=1; [ "$(grep -c 'CREATE TABLE' "$PLAIN")" = 0 ] && ! grep -q "student@thefest.in" "$PLAIN" && old=0
echo "  note: ops.sh's 'not readable as SQL' grep on an UNENCRYPTED pg_dump -Fc: $([ $old = 0 ] && echo 'passes too (Finding 8: weak check)' || echo 'fails (check is meaningful)')"
[ "$(head -c 5 "$PLAIN")" = "PGDMP" ]; check "the PGDMP check does catch an unencrypted dump" $?
rm -rf "$BK"

echo; echo "$pass/$((pass+fail)) schema-upgrade and backup checks passed"
[ $fail = 0 ]

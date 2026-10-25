#!/usr/bin/env bash
# Restore an encrypted backup made by scripts/backup.sh (or the GitHub backup workflow).
#
#   RESTORE_DATABASE_URL=postgresql://...   BACKUP_PASSPHRASE='long secret'   bash scripts/restore.sh thefest-....dump.gpg
#
# Restores into an EMPTY database only (a new local database or a new Supabase project) — it refuses a
# database that already has THE FEST's tables, so it can never overwrite live data.
set -euo pipefail
FILE="${1:?Usage: restore.sh <backup.dump.gpg>}"
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL (an empty database)}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
if [ "$(psql "$RESTORE_DATABASE_URL" -qtAc "select to_regclass('public.users') is not null")" = "t" ]; then
  echo "Refusing: the target database already has THE FEST tables. Restore into an empty database." >&2
  exit 1
fi
PGOPTIONS='-c client_min_messages=warning' psql "$RESTORE_DATABASE_URL" -qc "create extension if not exists pgcrypto; create extension if not exists citext;" >/dev/null
umask 077
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
gpg --batch --quiet --pinentry-mode loopback --decrypt --passphrase-fd 3 --output "$TMP/db.dump" "$FILE" 3<<<"$BACKUP_PASSPHRASE"
# Skip "CREATE SCHEMA public" (every database already has it) and extensions (created above)
pg_restore --list "$TMP/db.dump" | grep -vE ' SCHEMA - public | EXTENSION - | COMMENT - (SCHEMA public|EXTENSION )' > "$TMP/list"
pg_restore --no-owner --no-privileges --exit-on-error --use-list "$TMP/list" --dbname "$RESTORE_DATABASE_URL" "$TMP/db.dump"
echo "Restored into the target database."

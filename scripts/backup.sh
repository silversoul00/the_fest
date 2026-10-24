#!/usr/bin/env bash
# Encrypted database backup. Same steps as .github/workflows/db-backup.yml, for use on a computer.
#
#   BACKUP_DATABASE_URL=postgresql://...   BACKUP_PASSPHRASE='long secret'   bash scripts/backup.sh [out-dir]
#
# • For Supabase use the SESSION pooler (port 5432 on the aws-…pooler.supabase.com host): pg_dump needs a
#   session, and the direct db.… address is IPv6-only.
# • Dumps the app's tables (schema "public") in pg_dump's custom format, then encrypts with
#   gpg (AES-256, passphrase). The plain dump never touches the disk.
# • Output: <out-dir>/thefest-YYYYMMDD-HHMMSS.dump.gpg   — restore with scripts/restore.sh
# • pg_dump must be the same major version as the server, or newer.
set -euo pipefail
: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
OUT_DIR="${1:-.}"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/thefest-$(date -u +%Y%m%d-%H%M%S).dump.gpg"
umask 077
pg_dump --format=custom --schema=public --no-owner --no-privileges "$BACKUP_DATABASE_URL" \
  | gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
        --passphrase-fd 3 --output "$FILE" 3<<<"$BACKUP_PASSPHRASE"
# pipefail makes a failed pg_dump fail the script; also refuse an empty file
[ -s "$FILE" ] || { echo "Backup is empty" >&2; rm -f "$FILE"; exit 1; }
echo "$FILE"

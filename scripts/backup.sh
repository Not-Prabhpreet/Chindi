#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
backup="backups/chindi-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
temporary="$backup.tmp"
# A temporary plain dump lets us check pg_dump's exit status without a pipe masking it.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$temporary"
gzip -c "$temporary" > "$backup"
rm -f "$temporary"
find backups -maxdepth 1 -type f -name 'chindi-*.sql.gz' -mtime +13 -delete
printf 'Backup written: %s\n' "$backup"

#!/bin/sh
# Applies a compiled app's SQL migrations to the running Supabase Postgres.
#
# Usage:
#   sh scripts/apply_schema.sh apps/biomedical-studies
#
# Requires the stack to be running (docker compose up -d) and .env to be
# present at the repo root.

set -e

cd "$(dirname "$0")/.."

app_dir="$1"
if [ -z "$app_dir" ]; then
    echo "usage: $0 <app_dir>" >&2
    exit 1
fi

if [ ! -f .env ]; then
    echo "No .env found - copy .env.example to .env first." >&2
    exit 1
fi

postgres_db=$(grep -E '^POSTGRES_DB=' .env | tail -1 | cut -d= -f2-)
postgres_db=${postgres_db:-postgres}

for f in "$app_dir"/migrations/*.sql; do
    echo "Applying $f ..."
    docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 -d "$postgres_db" < "$f"
done

echo "Done."

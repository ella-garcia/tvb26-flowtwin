#!/usr/bin/env bash
# Run the RLS tests against the local Supabase database (needs `supabase start` and a seeded DB).
set -uo pipefail
cd "$(dirname "$0")"
# Target THIS project's container only: other local Supabase projects run their own supabase_db_* containers.
project=$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' ../config.toml)
c="supabase_db_${project}"
docker ps --format '{{.Names}}' | grep -qx "$c" || { echo "ERROR: container $c is not running (supabase start)"; exit 1; }
out=$(docker exec -i "$c" psql -U postgres -d postgres -X -q < rls_test.sql 2>&1) || { echo "$out"; exit 1; }
echo "$out" | grep -E '^(PASS|FAIL|ERROR|All assertions|[0-9]+ assertion|TESTS FAILED)'
if echo "$out" | grep -qE '^(FAIL|ERROR|TESTS FAILED)'; then exit 1; fi

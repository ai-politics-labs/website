#!/bin/sh
# Disposable local-only PostgreSQL cluster. Never contacts Supabase.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FOUNDING_TMP=$(mktemp -d /private/tmp/aip-founding-signup-db.XXXXXX)
cleanup() {
  pg_ctl -D "$FOUNDING_TMP/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$FOUNDING_TMP"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$FOUNDING_TMP/data" -A trust --no-locale >/dev/null
pg_ctl -D "$FOUNDING_TMP/data" -l "$FOUNDING_TMP/postgres.log" -o "-k $FOUNDING_TMP -c listen_addresses=''" -w start >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$FOUNDING_TMP" -d postgres -f "$ROOT/tests/founding-signup.sql"

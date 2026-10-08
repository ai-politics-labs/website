#!/bin/sh
# Disposable local-only PostgreSQL cluster. Never contacts Supabase.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BOARD_TMP=$(mktemp -d /private/tmp/aip-disable-board-db.XXXXXX)
cleanup() {
  pg_ctl -D "$BOARD_TMP/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$BOARD_TMP"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$BOARD_TMP/data" -A trust --no-locale >/dev/null
pg_ctl -D "$BOARD_TMP/data" -l "$BOARD_TMP/postgres.log" -o "-k $BOARD_TMP -c listen_addresses=''" -w start >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$BOARD_TMP" -d postgres -f "$ROOT/tests/disable-board.sql"

#!/bin/sh
# Isolated, disposable local cluster; never contacts the production database.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMMUNITY_TMP=$(mktemp -d /private/tmp/aip-community-db.XXXXXX)
cleanup() {
  pg_ctl -D "$COMMUNITY_TMP/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$COMMUNITY_TMP"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$COMMUNITY_TMP/data" -A trust --no-locale >/dev/null
pg_ctl -D "$COMMUNITY_TMP/data" -l "$COMMUNITY_TMP/postgres.log" -o "-k $COMMUNITY_TMP -c listen_addresses=''" -w start >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$COMMUNITY_TMP" -d postgres -f "$ROOT/tests/community.sql"

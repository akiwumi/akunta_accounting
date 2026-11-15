#!/usr/bin/env bash
# Runs the integration tests against a disposable database built from the
# migrations, so a passing run also proves the migrations apply from empty.
#
# Needs a local PostgreSQL server. TEST_DATABASE_URL overrides the default,
# and its database name must end in _test.
set -euo pipefail

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  if [[ -f .env ]]; then set -a; . ./.env; set +a; fi
  BASE="${DIRECT_URL:-${DATABASE_URL:?set DATABASE_URL or TEST_DATABASE_URL}}"
  TEST_DATABASE_URL="$(printf '%s' "$BASE" | sed -E 's#/[^/?]+(\?.*)?$#/akunta_test#')"
fi
ADMIN_URL="$(printf '%s' "$TEST_DATABASE_URL" | sed -E 's#/[^/?]+(\?.*)?$#/postgres#')"
DB_NAME="$(printf '%s' "$TEST_DATABASE_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"

case "$DB_NAME" in *_test) ;; *) echo "Refusing: \"$DB_NAME\" does not end in _test" >&2; exit 1 ;; esac

psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$DB_NAME\"" -c "CREATE DATABASE \"$DB_NAME\""
trap 'psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$DB_NAME\"" >/dev/null' EXIT

export DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DATABASE_URL" NODE_ENV=test
npx prisma migrate deploy >/dev/null
npx tsx --test tests/*.test.ts

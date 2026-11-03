#!/bin/bash
# Dev only. Creates the test database ${MYSQL_DATABASE}_test and grants the app user
# ${MYSQL_USER} all privileges on it. The MySQL entrypoint runs this once, when the data
# volume is initialised (the root password and the app user already exist by then).
# The entrypoint may source this file instead of executing it, so: no "exit", no "set -u".
# To rerun it on an existing volume:
#   docker compose -f compose.dev.yaml exec db bash /docker-entrypoint-initdb.d/01-test-db.sh

if [ -z "${MYSQL_DATABASE:-}" ] || [ -z "${MYSQL_USER:-}" ]; then
  echo "01-test-db.sh: MYSQL_DATABASE or MYSQL_USER not set, test database not created" >&2
else
  echo "01-test-db.sh: creating database ${MYSQL_DATABASE}_test for '${MYSQL_USER}'@'%'"
  mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<EOSQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_test\`;
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_test\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
EOSQL
fi

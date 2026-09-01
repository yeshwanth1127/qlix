#!/bin/zsh

set -eu

QLIX_ROOT="/Users/raghuvamsi/exora/qlix"
DOCKER_BIN="/usr/local/bin/docker"
PM2_BIN="/Users/raghuvamsi/.nvm/versions/node/v24.13.0/bin/pm2"
NODE_BIN_DIR="/Users/raghuvamsi/.nvm/versions/node/v24.13.0/bin"
LOG_PREFIX="[qlix-startup]"

export PATH="${NODE_BIN_DIR}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

log() {
  print -r -- "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} $*"
}

log "waiting for Docker Desktop"
docker_ready=0
for attempt in {1..120}; do
  if "${DOCKER_BIN}" info >/dev/null 2>&1; then
    docker_ready=1
    break
  fi
  sleep 5
done

if (( docker_ready == 0 )); then
  log "Docker did not become ready within 10 minutes"
  exit 1
fi

cd "${QLIX_ROOT}" || exit 1
log "starting PostgreSQL, Redis, and the nginx tunnel gateway"
"${DOCKER_BIN}" compose -f docker-compose.tunnel.yml up -d

postgres_ready=0
for attempt in {1..60}; do
  postgres_health=$("${DOCKER_BIN}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' qlix-postgres 2>/dev/null || true)
  if [[ "${postgres_health}" == "healthy" ]]; then
    postgres_ready=1
    break
  fi
  sleep 2
done

if (( postgres_ready == 0 )); then
  log "PostgreSQL did not become healthy"
  exit 1
fi

if [[ ! -x "${PM2_BIN}" ]]; then
  log "PM2 is missing at ${PM2_BIN}"
  exit 1
fi

log "starting Qlix application processes"
"${PM2_BIN}" startOrReload "${QLIX_ROOT}/ecosystem.config.cjs" --update-env
"${PM2_BIN}" save --force

services_ready=0
for attempt in {1..60}; do
  if /usr/bin/nc -z 127.0.0.1 3000 \
    && /usr/bin/nc -z 127.0.0.1 4000 \
    && /usr/bin/nc -z 127.0.0.1 8081; then
    services_ready=1
    break
  fi
  sleep 2
done

if (( services_ready == 0 )); then
  log "one or more required ports (3000, 4000, 8081) did not become ready"
  "${PM2_BIN}" list
  exit 1
fi

log "Qlix startup complete"

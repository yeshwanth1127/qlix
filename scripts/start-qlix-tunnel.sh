#!/bin/bash
# Same pattern as ~/exora/scripts/start-litellm.sh — wait for Docker, then start the local origin.

until /usr/local/bin/docker info >/dev/null 2>&1; do
  sleep 5
done

cd "$HOME/exora/qlix" || exit 1
/usr/local/bin/docker compose -f docker-compose.tunnel.yml up -d

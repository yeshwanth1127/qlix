#!/bin/bash
cd "$(dirname "$0")"
export QLIX_AGENT_FILE="$PWD/agent.json"

if [ ! -f "$QLIX_AGENT_FILE" ]; then
  echo "Missing agent.json. Download a new starter pack from Qlix."
  read -r -p "Press Enter to close…"
  exit 1
fi

PY=""
command -v python3 >/dev/null && PY=python3
command -v python >/dev/null && [ -z "$PY" ] && PY=python

if [ -z "$PY" ]; then
  echo "Install Python 3.10+ from https://www.python.org/downloads/ then try again."
  read -r -p "Press Enter to close…"
  open "https://www.python.org/downloads/" 2>/dev/null || true
  exit 1
fi

echo "Starting your Qlix agent… Keep this window open."
echo ""

if [ -f "$PWD/qlix-agent.whl" ]; then
  "$PY" -m pip install "$PWD/qlix-agent.whl[hybrid]" -q --disable-pip-version-check 2>/dev/null
elif [ -d "$PWD/lib/qlix" ]; then
  export PYTHONPATH="$PWD/lib:${PYTHONPATH:-}"
fi

exec "$PY" -m qlix.hybrid_runner

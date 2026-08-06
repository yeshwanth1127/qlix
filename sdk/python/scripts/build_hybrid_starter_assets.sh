#!/usr/bin/env bash
# Build qlix wheel + copy into backend assets for hybrid starter packs.
set -euo pipefail

SDK_PYTHON="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SDK_PYTHON/../.." && pwd)"
ASSETS="$ROOT/backend/assets/hybrid-starter"
STARTER_SRC="$SDK_PYTHON/qlix/starter_pack"
TEMPLATES="$ASSETS/templates"
VENV="$SDK_PYTHON/.venv"

mkdir -p "$ASSETS" "$TEMPLATES" "$SDK_PYTHON/dist"

# Sync launcher templates (source of truth: sdk/python/qlix/starter_pack).
cp -f "$STARTER_SRC/Start Qlix Agent.bat" "$TEMPLATES/"
cp -f "$STARTER_SRC/Start Qlix Agent.sh" "$TEMPLATES/"
cp -f "$STARTER_SRC/Start Qlix Agent.command" "$TEMPLATES/"
cp -f "$STARTER_SRC/README.txt" "$TEMPLATES/"
if [[ -f "$STARTER_SRC/install.sh" ]]; then
  cp -f "$STARTER_SRC/install.sh" "$TEMPLATES/"
fi
chmod +x "$TEMPLATES/Start Qlix Agent.sh" "$TEMPLATES/Start Qlix Agent.command" "$TEMPLATES/install.sh" 2>/dev/null || true
echo "Synced starter templates → $TEMPLATES"

if [[ ! -x "$VENV/bin/pip" ]]; then
  python3 -m venv "$VENV"
fi

"$VENV/bin/pip" install -q build hatchling wheel
(
  cd "$SDK_PYTHON"
  "$VENV/bin/pip" wheel . -w dist --no-deps
)

WHEEL="$(ls -t "$SDK_PYTHON"/dist/qlix-*.whl | head -1)"
if [[ -z "$WHEEL" || ! -f "$WHEEL" ]]; then
  echo "No qlix-*.whl produced in $SDK_PYTHON/dist" >&2
  exit 1
fi

# hybridStarterPack.ts + Start Qlix Agent.bat expect this exact filename.
cp -f "$WHEEL" "$ASSETS/qlix-0.1.0-py3-none-any.whl"
cp -f "$WHEEL" "$ASSETS/qlix-agent.whl"
echo "Built $ASSETS/qlix-0.1.0-py3-none-any.whl"

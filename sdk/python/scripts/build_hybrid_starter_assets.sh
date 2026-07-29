#!/usr/bin/env bash
# Build qlix wheel + copy into backend assets for hybrid starter packs.
set -euo pipefail

SDK_PYTHON="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SDK_PYTHON/../.." && pwd)"
ASSETS="$ROOT/backend/assets/hybrid-starter"
VENV="$SDK_PYTHON/.venv"

mkdir -p "$ASSETS" "$SDK_PYTHON/dist"

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

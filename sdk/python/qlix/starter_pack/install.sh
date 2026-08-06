#!/bin/bash
# One-click hybrid runner installer — run from an unpacked Qlix starter pack.
set -euo pipefail
cd "$(dirname "$0")"

# macOS: clear browser-download quarantine so launchers can start cleanly.
# (Only runs if this script itself was allowed to start — e.g. from Terminal.)
if [ "$(uname -s)" = "Darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$PWD" 2>/dev/null || true
fi
chmod +x "install.sh" "Start Qlix Agent.sh" "Start Qlix Agent.command" 2>/dev/null || true

echo "══ Qlix hybrid agent installer ══"
echo ""

if [ ! -f agent.json ]; then
  echo "Missing agent.json — download a fresh starter pack from Qlix."
  exit 1
fi

MIN_MAJOR=3
MIN_MINOR=10

ok_python() {
  local bin="$1"
  [ -n "$bin" ] && [ -x "$bin" ] || return 1
  "$bin" -c "import sys; raise SystemExit(0 if sys.version_info >= (${MIN_MAJOR}, ${MIN_MINOR}) else 1)" 2>/dev/null
}

find_python() {
  local c
  for c in python3.12 python3.11 python3.10 python3 python; do
    if command -v "$c" >/dev/null 2>&1 && ok_python "$(command -v "$c")"; then
      echo "$(command -v "$c")"
      return 0
    fi
  done
  case "$(uname -s)" in
    Darwin)
      for c in \
        /opt/homebrew/bin/python3 \
        /usr/local/bin/python3 \
        /Library/Frameworks/Python.framework/Versions/3.12/bin/python3; do
        if ok_python "$c"; then echo "$c"; return 0; fi
      done
      ;;
  esac
  return 1
}

ensure_pip() {
  local py="$1"
  if "$py" -m pip --version >/dev/null 2>&1; then return 0; fi
  echo "Verifying pip…"
  "$py" -m ensurepip --upgrade >/dev/null 2>&1 || true
  "$py" -m pip --version >/dev/null 2>&1
}

install_python() {
  echo "Checking for Python…"
  echo "Python not found — downloading / installing Python 3.12+…"
  case "$(uname -s)" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        echo "Installing… (Homebrew python@3.12)"
        brew install python@3.12 || brew install python3
        export PATH="/opt/homebrew/opt/python@3.12/bin:/usr/local/opt/python@3.12/bin:$PATH"
        return 0
      fi
      echo "Homebrew not found — downloading official python.org pkg…"
      local pkg
      pkg="$(mktemp -t qlix-python.XXXXXX.pkg)"
      curl -fL --progress-bar "https://www.python.org/ftp/python/3.12.8/python-3.12.8-macos11.pkg" -o "$pkg"
      echo "Installing… (may prompt for your password)"
      sudo installer -pkg "$pkg" -target /
      rm -f "$pkg"
      export PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:$PATH"
      ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        echo "Installing… (apt) — needs sudo"
        sudo apt-get update -y
        sudo apt-get install -y python3 python3-pip python3-venv || sudo apt-get install -y python3 python3-pip
      elif command -v dnf >/dev/null 2>&1; then
        echo "Installing… (dnf) — needs sudo"
        sudo dnf install -y python3 python3-pip
      elif command -v yum >/dev/null 2>&1; then
        echo "Installing… (yum) — needs sudo"
        sudo yum install -y python3 python3-pip
      elif command -v pacman >/dev/null 2>&1; then
        echo "Installing… (pacman) — needs sudo"
        sudo pacman -Sy --noconfirm python python-pip
      elif command -v zypper >/dev/null 2>&1; then
        echo "Installing… (zypper) — needs sudo"
        sudo zypper install -y python3 python3-pip python3-venv
      else
        echo "No supported package manager. Install from https://www.python.org/downloads/"
        return 1
      fi
      ;;
    *)
      echo "Unsupported OS. Install Python 3.10+ from https://www.python.org/downloads/"
      return 1
      ;;
  esac
}

echo "Checking for Python…"
PY="$(find_python || true)"
if [ -z "${PY}" ]; then
  install_python
  PY="$(find_python || true)"
fi
if [ -z "${PY}" ]; then
  echo "Python 3.10+ is required. Install from https://www.python.org/downloads/"
  exit 1
fi

VER="$("$PY" -c 'import sys; print("%d.%d"%sys.version_info[:2])')"
echo "Using Python ${VER} ($PY)"
ensure_pip "$PY" || { echo "Could not set up pip."; exit 1; }
echo "Verifying pip… OK"

# pip requires a PEP 427 name; qlix-agent.whl is not valid.
WHEEL=""
if [ -f qlix-0.1.0-py3-none-any.whl ]; then
  WHEEL="./qlix-0.1.0-py3-none-any.whl"
elif WHEEL="$(ls -1 ./qlix-*-py3-none-any.whl 2>/dev/null | head -1 || true)" && [ -n "$WHEEL" ]; then
  :
elif [ -f qlix-agent.whl ]; then
  cp -f qlix-agent.whl qlix-0.1.0-py3-none-any.whl
  WHEEL="./qlix-0.1.0-py3-none-any.whl"
fi

VENV_DIR="$PWD/.venv"
VENV_PY="$VENV_DIR/bin/python"
if [ ! -x "$VENV_PY" ]; then
  echo "Creating local Python environment…"
  if ! "$PY" -c "import venv" 2>/dev/null; then
    echo "Python venv module missing — installing python3-venv…"
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update -y && sudo apt-get install -y python3-venv python3-pip
    elif command -v zypper >/dev/null 2>&1; then
      sudo zypper install -y python3-venv
    fi
  fi
  if ! "$PY" -m venv "$VENV_DIR"; then
    echo "Could not create .venv. On Debian/Ubuntu: sudo apt-get install -y python3-venv"
    exit 1
  fi
fi
PY="$VENV_PY"

if ! "$PY" -m pip --version >/dev/null 2>&1; then
  "$PY" -m ensurepip --upgrade >/dev/null 2>&1 || true
fi

if [ -n "$WHEEL" ]; then
  echo "Installing bundled qlix wheel…"
  # Install by path only (no path[extra]) — avoids pip wheel-name / extras bugs.
  "$PY" -m pip install --upgrade --disable-pip-version-check "$WHEEL"
  if ! "$PY" -m pip install --upgrade --disable-pip-version-check \
      gui-agents pyautogui reportlab openpyxl >/dev/null 2>&1; then
    echo "Optional desktop extras skipped (core agent still works)."
  fi
else
  echo "No wheel in pack — re-download the starter pack from Qlix."
  exit 1
fi

if ! "$PY" -c "import qlix.hybrid_runner" 2>/dev/null; then
  echo "qlix is not importable after install."
  exit 1
fi

LAUNCHER=""
case "$(uname -s)" in
  Darwin) LAUNCHER="Start Qlix Agent.command" ;;
  Linux)  LAUNCHER="Start Qlix Agent.sh" ;;
  *)      LAUNCHER="Start Qlix Agent.sh" ;;
esac

chmod +x "$LAUNCHER" 2>/dev/null || true
chmod +x install.sh 2>/dev/null || true
chmod +x "Start Qlix Agent.sh" 2>/dev/null || true
chmod +x "Start Qlix Agent.command" 2>/dev/null || true

echo ""
echo "Install complete. Start the agent with:"
echo "  ./${LAUNCHER}"
echo ""
read -r -p "Start now? [Y/n] " ans || true
ans=${ans:-Y}
if [[ "$ans" =~ ^[Yy]$ ]]; then
  exec "./${LAUNCHER}"
fi

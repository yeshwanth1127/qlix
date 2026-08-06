#!/bin/bash
# Qlix Agent launcher (macOS) — auto-fetches Python 3.12+ if missing.
cd "$(dirname "$0")"
export QLIX_AGENT_FILE="$PWD/agent.json"

# Clear download quarantine on this pack so later double-clicks / nested
# executables are less likely to re-trigger Gatekeeper.
# NOTE: If macOS already blocked this .command with "Not Opened", this line
# never ran — open once via Terminal instead:
#   bash "Start Qlix Agent.command"
clear_macos_quarantine() {
  if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$PWD" 2>/dev/null || true
  fi
  chmod +x "$0" "install.sh" "Start Qlix Agent.command" "Start Qlix Agent.sh" 2>/dev/null || true
}
clear_macos_quarantine

if [ ! -f "$QLIX_AGENT_FILE" ]; then
  echo "Missing agent.json. Download a new starter pack from Qlix."
  read -r -p "Press Enter to close…"
  exit 1
fi

MIN_MAJOR=3
MIN_MINOR=10
PREF_VER="3.12"
# Prefer 3.10–3.13; 3.14+ is often too new for hybrid extras.
MAX_MINOR_PREF=13

ok_python_pref() {
  local bin="$1"
  [ -n "$bin" ] && [ -x "$bin" ] || return 1
  "$bin" -c "import sys; v=sys.version_info; raise SystemExit(0 if v >= (${MIN_MAJOR}, ${MIN_MINOR}) and v.minor <= ${MAX_MINOR_PREF} else 1)" 2>/dev/null
}

ok_python() {
  local bin="$1"
  [ -n "$bin" ] && [ -x "$bin" ] || return 1
  "$bin" -c "import sys; raise SystemExit(0 if sys.version_info >= (${MIN_MAJOR}, ${MIN_MINOR}) else 1)" 2>/dev/null
}

find_python() {
  local c
  for c in python3.12 python3.13 python3.11 python3.10 python3 python; do
    if command -v "$c" >/dev/null 2>&1 && ok_python_pref "$(command -v "$c")"; then
      echo "$(command -v "$c")"
      return 0
    fi
  done
  for c in \
    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.10/bin/python3 \
    /opt/homebrew/bin/python3.12 \
    /opt/homebrew/bin/python3.13 \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3.12 \
    /usr/local/bin/python3.13 \
    /usr/local/bin/python3; do
    if ok_python_pref "$c"; then
      echo "$c"
      return 0
    fi
  done
  # Last resort: any 3.10+ (including 3.14).
  for c in python3.12 python3.13 python3.11 python3.10 python3 python; do
    if command -v "$c" >/dev/null 2>&1 && ok_python "$(command -v "$c")"; then
      echo "$(command -v "$c")"
      return 0
    fi
  done
  for c in /opt/homebrew/bin/python3 /usr/local/bin/python3; do
    if ok_python "$c"; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

ensure_pip() {
  local py="$1"
  if "$py" -m pip --version >/dev/null 2>&1; then
    return 0
  fi
  echo "Verifying pip…"
  "$py" -m ensurepip --upgrade >/dev/null 2>&1 || true
  if ! "$py" -m pip --version >/dev/null 2>&1; then
    echo "Bootstrapping pip via get-pip.py…"
    local getpip
    getpip="$(mktemp -t qlix-get-pip.XXXXXX.py)"
    if curl -fsSL "https://bootstrap.pypa.io/get-pip.py" -o "$getpip"; then
      "$py" "$getpip" --user >/dev/null 2>&1 || "$py" "$getpip" >/dev/null 2>&1 || true
    fi
    rm -f "$getpip"
  fi
  "$py" -m pip --version >/dev/null 2>&1
}

install_python_macos() {
  echo "Python not found — downloading Python ${PREF_VER}…"
  if command -v brew >/dev/null 2>&1; then
    echo "Installing… (Homebrew python@${PREF_VER})"
    brew install "python@${PREF_VER}" || brew install python3 || return 1
    if [ -d "/opt/homebrew/opt/python@${PREF_VER}/bin" ]; then
      export PATH="/opt/homebrew/opt/python@${PREF_VER}/bin:$PATH"
    elif [ -d "/usr/local/opt/python@${PREF_VER}/bin" ]; then
      export PATH="/usr/local/opt/python@${PREF_VER}/bin:$PATH"
    fi
    return 0
  fi

  echo "Homebrew not found — downloading official python.org installer…"
  local pkg url
  pkg="$(mktemp -t qlix-python.XXXXXX.pkg)"
  url="https://www.python.org/ftp/python/3.12.8/python-3.12.8-macos11.pkg"
  echo "Downloading…"
  if ! curl -fL --progress-bar "$url" -o "$pkg"; then
    echo "Download failed."
    rm -f "$pkg"
    return 1
  fi
  echo "Installing… (may prompt for your password)"
  if ! sudo installer -pkg "$pkg" -target /; then
    echo "Installer failed."
    rm -f "$pkg"
    return 1
  fi
  rm -f "$pkg"
  export PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:$PATH"
  return 0
}

# pip requires a PEP 427 name (e.g. qlix-0.1.0-py3-none-any.whl).
# "qlix-agent.whl" is NOT valid — never pass it straight to pip.
find_wheel() {
  local w
  if [ -f "$PWD/qlix-0.1.0-py3-none-any.whl" ]; then
    echo "$PWD/qlix-0.1.0-py3-none-any.whl"
    return 0
  fi
  w="$(ls -1 "$PWD"/qlix-*-py3-none-any.whl 2>/dev/null | head -1 || true)"
  if [ -n "$w" ] && [ -f "$w" ]; then
    echo "$w"
    return 0
  fi
  # Legacy alias from older packs: copy to a valid filename for pip.
  if [ -f "$PWD/qlix-agent.whl" ]; then
    cp -f "$PWD/qlix-agent.whl" "$PWD/qlix-0.1.0-py3-none-any.whl"
    echo "$PWD/qlix-0.1.0-py3-none-any.whl"
    return 0
  fi
  return 1
}

install_qlix_wheel() {
  local venv_py="$1"
  local wheel="$2"
  echo "Installing Qlix agent package…"
  # Install by path only (no path[extra]) — avoids pip wheel-name / extras bugs.
  if ! "$venv_py" -m pip install --upgrade --disable-pip-version-check "$wheel"; then
    echo "pip install failed for: $wheel"
    return 1
  fi
  # Optional desktop extras — never block startup if they fail (e.g. very new Python).
  if ! "$venv_py" -m pip install --upgrade --disable-pip-version-check \
      gui-agents pyautogui reportlab openpyxl >/dev/null 2>&1; then
    echo "Optional desktop extras skipped (core agent still works)."
  fi
  return 0
}

# Install into a pack-local venv so Homebrew / PEP 668 system Pythons work.
ensure_qlix_installed() {
  local base_py="$1"
  local venv_dir="$PWD/.venv"
  local venv_py="$venv_dir/bin/python"
  local wheel

  if [ ! -x "$venv_py" ]; then
    echo "Creating local Python environment…"
    if ! "$base_py" -m venv "$venv_dir"; then
      echo "Could not create .venv (reinstall Python 3.10–3.13 from python.org)."
      return 1
    fi
  fi

  if ! "$venv_py" -m pip --version >/dev/null 2>&1; then
    "$venv_py" -m ensurepip --upgrade >/dev/null 2>&1 || true
  fi
  if ! "$venv_py" -m pip --version >/dev/null 2>&1; then
    echo "pip is not available inside .venv."
    return 1
  fi

  wheel="$(find_wheel || true)"
  if [ -n "$wheel" ]; then
    install_qlix_wheel "$venv_py" "$wheel" || return 1
  elif [ -d "$PWD/lib/qlix" ]; then
    export PYTHONPATH="$PWD/lib:${PYTHONPATH:-}"
  else
    echo "No qlix-*-py3-none-any.whl found in this folder."
    echo "Re-download the starter pack from the Qlix dashboard."
    return 1
  fi

  if ! "$venv_py" -c "import qlix.hybrid_runner" 2>/dev/null; then
    echo "qlix is not importable after install."
    return 1
  fi

  PY="$venv_py"
  return 0
}

echo "Checking for Python…"
PY="$(find_python || true)"
if [ -z "$PY" ]; then
  if ! install_python_macos; then
    echo "Could not install Python automatically."
    echo "Install Python 3.10+ from https://www.python.org/downloads/ then try again."
    open "https://www.python.org/downloads/" 2>/dev/null || true
    read -r -p "Press Enter to close…"
    exit 1
  fi
  PY="$(find_python || true)"
  if [ -z "$PY" ]; then
    echo "Python installed but not found on PATH. Open a new terminal and try again."
    read -r -p "Press Enter to close…"
    exit 1
  fi
fi

echo "Using $($PY -c 'import sys; print("Python %d.%d"%sys.version_info[:2])') ($PY)"
if ! ensure_pip "$PY"; then
  echo "Could not set up pip."
  read -r -p "Press Enter to close…"
  exit 1
fi
echo "Verifying pip… OK"

if ! ensure_qlix_installed "$PY"; then
  echo ""
  echo "Could not install the Qlix agent package."
  echo "Try:  ./install.sh"
  read -r -p "Press Enter to close…"
  exit 1
fi

echo "Starting your Qlix agent…"
echo "When you see >>> type here to chat. Keep this window open."
echo ""

exec "$PY" -m qlix.hybrid_runner

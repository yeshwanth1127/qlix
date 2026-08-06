#!/bin/bash
# Qlix Agent launcher (Linux) — auto-fetches Python 3.10+ if missing.
cd "$(dirname "$0")"
export QLIX_AGENT_FILE="$PWD/agent.json"

# Some unzip tools drop +x; keep launchers runnable.
chmod +x "$0" "install.sh" "Start Qlix Agent.sh" "Start Qlix Agent.command" 2>/dev/null || true

if [ ! -f "$QLIX_AGENT_FILE" ]; then
  echo "Missing agent.json. Download a new starter pack from Qlix."
  read -r -p "Press Enter to close…"
  exit 1
fi

MIN_MAJOR=3
MIN_MINOR=10
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
  for c in python3.12 python3.13 python3.11 python3.10 python3 python; do
    if command -v "$c" >/dev/null 2>&1 && ok_python "$(command -v "$c")"; then
      echo "$(command -v "$c")"
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
    getpip="$(mktemp /tmp/qlix-get-pip.XXXXXX.py)"
    if curl -fsSL "https://bootstrap.pypa.io/get-pip.py" -o "$getpip" 2>/dev/null \
      || wget -qO "$getpip" "https://bootstrap.pypa.io/get-pip.py" 2>/dev/null; then
      "$py" "$getpip" --user >/dev/null 2>&1 || "$py" "$getpip" >/dev/null 2>&1 || true
    fi
    rm -f "$getpip"
  fi
  "$py" -m pip --version >/dev/null 2>&1
}

install_python_linux() {
  echo "Python not found — installing Python 3…"
  if command -v apt-get >/dev/null 2>&1; then
    echo "Installing… (apt: python3 python3-pip python3-venv)"
    echo "This needs administrator rights (sudo)."
    sudo apt-get update -y && sudo apt-get install -y python3 python3-pip python3-venv python3-ensurepip 2>/dev/null \
      || sudo apt-get install -y python3 python3-pip python3-venv
    return $?
  fi
  if command -v dnf >/dev/null 2>&1; then
    echo "Installing… (dnf: python3 python3-pip)"
    echo "This needs administrator rights (sudo)."
    sudo dnf install -y python3 python3-pip
    return $?
  fi
  if command -v yum >/dev/null 2>&1; then
    echo "Installing… (yum: python3 python3-pip)"
    echo "This needs administrator rights (sudo)."
    sudo yum install -y python3 python3-pip
    return $?
  fi
  if command -v pacman >/dev/null 2>&1; then
    echo "Installing… (pacman: python python-pip)"
    echo "This needs administrator rights (sudo)."
    sudo pacman -Sy --noconfirm python python-pip
    return $?
  fi
  if command -v zypper >/dev/null 2>&1; then
    echo "Installing… (zypper: python3 python3-pip python3-venv)"
    echo "This needs administrator rights (sudo)."
    sudo zypper install -y python3 python3-pip python3-venv
    return $?
  fi
  echo "No supported package manager found (apt/dnf/yum/pacman/zypper)."
  echo "Install Python 3.10+ from https://www.python.org/downloads/ then try again."
  return 1
}

# Debian/Ubuntu often ship python3 without the venv module.
ensure_venv_module() {
  local py="$1"
  if "$py" -c "import venv" 2>/dev/null; then
    return 0
  fi
  echo "Python venv module missing — installing…"
  if command -v apt-get >/dev/null 2>&1; then
    echo "This needs administrator rights (sudo)."
    sudo apt-get update -y && sudo apt-get install -y python3-venv python3-pip
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y python3
  elif command -v zypper >/dev/null 2>&1; then
    sudo zypper install -y python3-venv
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm python
  else
    echo "Install the python3-venv package for your distro, then try again."
    return 1
  fi
  "$py" -c "import venv" 2>/dev/null
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

ensure_qlix_installed() {
  local base_py="$1"
  local venv_dir="$PWD/.venv"
  local venv_py="$venv_dir/bin/python"
  local wheel

  if [ ! -x "$venv_py" ]; then
    echo "Creating local Python environment…"
    if ! ensure_venv_module "$base_py"; then
      return 1
    fi
    if ! "$base_py" -m venv "$venv_dir"; then
      echo "Could not create .venv."
      echo "On Debian/Ubuntu try:  sudo apt-get install -y python3-venv"
      return 1
    fi
  fi

  # Fresh venvs sometimes lack pip.
  if ! "$venv_py" -m pip --version >/dev/null 2>&1; then
    "$venv_py" -m ensurepip --upgrade >/dev/null 2>&1 || true
  fi
  if ! "$venv_py" -m pip --version >/dev/null 2>&1; then
    echo "pip is not available inside .venv."
    return 1
  fi

  wheel="$(find_wheel || true)"
  if [ -n "$wheel" ]; then
    echo "Installing Qlix agent package…"
    # Install by path only (no path[extra]) — avoids pip wheel-name / extras bugs.
    if ! "$venv_py" -m pip install --upgrade --disable-pip-version-check "$wheel"; then
      echo "pip install failed for: $wheel"
      return 1
    fi
    if ! "$venv_py" -m pip install --upgrade --disable-pip-version-check \
        gui-agents pyautogui reportlab openpyxl >/dev/null 2>&1; then
      echo "Optional desktop extras skipped (core agent still works)."
    fi
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
  if ! install_python_linux; then
    echo "Could not install Python automatically."
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
  echo "Or:   bash \"Start Qlix Agent.sh\""
  read -r -p "Press Enter to close…"
  exit 1
fi

echo "Starting your Qlix agent…"
echo "When you see >>> type here to chat. Keep this window open."
echo ""

exec "$PY" -m qlix.hybrid_runner

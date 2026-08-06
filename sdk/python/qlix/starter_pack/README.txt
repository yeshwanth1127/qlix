Qlix Agent — quick start
========================

1. Unzip this folder anywhere on your computer.
2. Start the agent:

   Windows: double-click "Start Qlix Agent.bat"

   macOS:   double-click "Start Qlix Agent.command"
            (see Gatekeeper notes below if macOS blocks it)

   Linux:   open a terminal in this folder and run:
              chmod +x install.sh "Start Qlix Agent.sh"
              ./install.sh
            Or:
              bash "Start Qlix Agent.sh"
            (File-manager double-click often fails on Linux — use a terminal.)

3. Keep that window open. When you see ">>>", type to chat with your agent
   in this terminal (like a local coding assistant). Your messages also appear
   in Qlix in the browser. WhatsApp still works if you connected it.

macOS: "Not Opened" / Gatekeeper
--------------------------------
Apple may block the .command the first time (unsigned download). The launcher
clears quarantine automatically once it is allowed to run — but if macOS
shows "Not Opened", the script never started, so clear it this way:

  Recommended — Terminal (from this folder):
    bash "Start Qlix Agent.command"
  That run clears quarantine on the folder; later double-clicks usually work.

  Or System Settings:
    1. Open System Settings → Privacy & Security
    2. Scroll to the message about "Start Qlix Agent.command"
    3. Click "Open Anyway", then confirm Open

  Or right-click → Open → Open

  Manual clear (same as what the launcher does once running):
    xattr -dr com.apple.quarantine .


Linux notes
-----------
- Prefer a terminal over double-clicking the .sh file.
- If you see "Permission denied", run:
    chmod +x install.sh "Start Qlix Agent.sh"
- If creating .venv fails on Debian/Ubuntu:
    sudo apt-get install -y python3-venv python3-pip
  then run ./install.sh again.

Python setup
------------
If Python 3.10+ is not already installed, the launcher will try to fetch and
install it for you (and set up pip), with progress messages such as:

  Checking for Python…
  Python not found — downloading Python 3.12…
  Installing…
  Verifying pip…

- Windows: uses winget when available, otherwise the official python.org
  installer (silent, adds PATH). Prefer Python 3.12.
- Mac: uses Homebrew when available, otherwise the official python.org .pkg
  (may ask for your password).
- Linux: uses apt, dnf, yum, pacman, or zypper when available (asks for sudo
  with an explanation). Otherwise opens a link to python.org.

Machines that already have a suitable Python skip install and start normally.

The first launch creates a local .venv in this folder and installs the bundled
qlix wheel (may take a minute).

Tips
----
- Interactive chat is the default when you start from a terminal window.
- Slash commands: /help  /history  /chats  /new  /fork  /use <id>
- When a tool needs approval (JIT), answer JIT › y or n in this window.
- For a background service (no chat prompt): set QLIX_HEADLESS=1 or run
    python -m qlix.hybrid_runner --headless
- To stop the agent, close the window or press Ctrl+C.
- Approvals also still work from the Qlix dashboard or WhatsApp if you prefer.

If you see "No module named 'qlix'"
----------------------------------
Run from this folder:

  ./install.sh

Or manually:

  python3 -m venv .venv
  .venv/bin/python -m pip install ./qlix-0.1.0-py3-none-any.whl
  bash "Start Qlix Agent.sh"          # Linux
  # macOS:  ./Start\ Qlix\ Agent.command

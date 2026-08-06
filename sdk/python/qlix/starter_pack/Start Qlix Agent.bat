@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Qlix Agent
cd /d "%~dp0"

set "QLIX_AGENT_FILE=%~dp0agent.json"
if not exist "%QLIX_AGENT_FILE%" (
  echo.
  echo   Missing agent.json in this folder.
  echo   Download a new starter pack from the Qlix dashboard.
  echo.
  pause
  exit /b 1
)

echo.
echo   Checking for Python…

call :find_python
if defined PYLAUNCHER goto :have_python

echo   Python not found — downloading Python 3.12…
call :install_python
call :refresh_path
call :find_python
if not defined PYLAUNCHER (
  echo.
  echo   Could not install Python automatically.
  echo   Install from https://www.python.org/downloads/ ^(check "Add python.exe to PATH"^)
  echo   then double-click this file again.
  echo.
  pause
  start "" "https://www.python.org/downloads/"
  exit /b 1
)

:have_python
echo   Verifying pip…
call :ensure_pip
if errorlevel 1 (
  echo   Could not set up pip. Contact your Qlix administrator.
  pause
  exit /b 1
)

:: pip requires a PEP 427 name; qlix-agent.whl is not valid.
set "WHEEL="
if exist "%~dp0qlix-0.1.0-py3-none-any.whl" (
  set "WHEEL=%~dp0qlix-0.1.0-py3-none-any.whl"
) else if exist "%~dp0qlix-agent.whl" (
  copy /Y "%~dp0qlix-agent.whl" "%~dp0qlix-0.1.0-py3-none-any.whl" >nul
  set "WHEEL=%~dp0qlix-0.1.0-py3-none-any.whl"
)

if not defined WHEEL if exist "%~dp0lib\qlix" (
  set "PYTHONPATH=%~dp0lib;%PYTHONPATH%"
)

if defined WHEEL (
  echo   Installing Qlix agent package…
  :: Install by path only (no path[extra]) — avoids pip wheel-name / extras bugs.
  if /i "!PYLAUNCHER!"=="py" (
    py -3 -m pip install --upgrade --disable-pip-version-check "!WHEEL!"
    if errorlevel 1 goto :wheel_fail
    py -3 -m pip install --upgrade --disable-pip-version-check gui-agents pyautogui reportlab openpyxl >nul 2>&1
  ) else (
    "!PYEXE!" -m pip install --upgrade --disable-pip-version-check "!WHEEL!"
    if errorlevel 1 goto :wheel_fail
    "!PYEXE!" -m pip install --upgrade --disable-pip-version-check gui-agents pyautogui reportlab openpyxl >nul 2>&1
  )
) else if not exist "%~dp0lib\qlix" (
  echo.
  echo   No qlix-*.whl found in this folder.
  echo   Re-download the starter pack from the Qlix dashboard.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting your Qlix agent...
echo   When you see ^>^>^> type here to chat. Keep this window open.
echo.

if /i "!PYLAUNCHER!"=="py" (
  py -3 -m qlix.hybrid_runner
) else (
  "!PYEXE!" -m qlix.hybrid_runner
)

if errorlevel 1 (
  echo.
  echo   Could not start the agent. Contact your Qlix administrator.
  pause
)
exit /b %ERRORLEVEL%

:wheel_fail
echo.
echo   Could not install the Qlix agent package from the starter pack.
echo   Re-download the pack from the Qlix dashboard, or contact your admin.
echo.
pause
exit /b 1

:: ── helpers ──────────────────────────────────────────────────────────────────

:find_python
set "PYLAUNCHER="
set "PYEXE="
where py >nul 2>&1
if not errorlevel 1 (
  py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" 2>nul
  if not errorlevel 1 (
    set "PYLAUNCHER=py"
    set "PYEXE=py"
    exit /b 0
  )
)
where python >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%i in ('where python 2^>nul') do (
    "%%i" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" 2>nul
    if not errorlevel 1 (
      set "PYLAUNCHER=python"
      set "PYEXE=%%i"
      exit /b 0
    )
  )
)
:: Known install locations after silent / winget install (PATH may lag).
for %%P in (
  "%LocalAppData%\Programs\Python\Python312\python.exe"
  "%LocalAppData%\Programs\Python\Python311\python.exe"
  "%LocalAppData%\Programs\Python\Python310\python.exe"
  "%ProgramFiles%\Python312\python.exe"
  "%ProgramFiles%\Python311\python.exe"
  "%ProgramFiles%\Python310\python.exe"
) do (
  if exist %%~P (
    %%~P -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" 2>nul
    if not errorlevel 1 (
      set "PYLAUNCHER=python"
      set "PYEXE=%%~P"
      exit /b 0
    )
  )
)
exit /b 1

:refresh_path
:: Reload PATH from the registry so a just-installed Python is visible.
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"
if defined SYS_PATH if defined USER_PATH (
  set "PATH=!SYS_PATH!;!USER_PATH!"
) else if defined SYS_PATH (
  set "PATH=!SYS_PATH!"
) else if defined USER_PATH (
  set "PATH=!USER_PATH!;!PATH!"
)
:: Also prepend common install dirs for this session.
set "PATH=%LocalAppData%\Programs\Python\Python312;%LocalAppData%\Programs\Python\Python312\Scripts;%LocalAppData%\Programs\Python\Python311;%LocalAppData%\Programs\Python\Python311\Scripts;%ProgramFiles%\Python312;%ProgramFiles%\Python312\Scripts;%PATH%"
exit /b 0

:install_python
:: Prefer winget when available (user-visible progress).
where winget >nul 2>&1
if not errorlevel 1 (
  echo   Installing… ^(winget Python 3.12^)
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  if not errorlevel 1 exit /b 0
  echo   winget install did not succeed — trying official installer…
)

:: Official python.org installer, silent, with PATH + pip.
set "PY_INSTALLER=%TEMP%\qlix-python-3.12.8-amd64.exe"
set "PY_URL=https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"
echo   Downloading Python 3.12 installer…
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='Continue'; try { Invoke-WebRequest -Uri '%PY_URL%' -OutFile '%PY_INSTALLER%' -UseBasicParsing } catch { exit 1 }"
if errorlevel 1 (
  echo   Download failed.
  exit /b 1
)
echo   Installing…
"%PY_INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_test=0 SimpleInstall=1
set "RC=%ERRORLEVEL%"
del /f /q "%PY_INSTALLER%" 2>nul
exit /b %RC%

:ensure_pip
if /i "!PYLAUNCHER!"=="py" (
  py -3 -m pip --version >nul 2>&1
  if not errorlevel 1 exit /b 0
  echo   Bootstrapping pip…
  py -3 -m ensurepip --upgrade >nul 2>&1
  py -3 -m pip --version >nul 2>&1
  exit /b %ERRORLEVEL%
)
"!PYEXE!" -m pip --version >nul 2>&1
if not errorlevel 1 exit /b 0
echo   Bootstrapping pip…
"!PYEXE!" -m ensurepip --upgrade >nul 2>&1
"!PYEXE!" -m pip --version >nul 2>&1
exit /b %ERRORLEVEL%

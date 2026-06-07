@echo off
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

set "PYEXE="
for /f "delims=" %%i in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do set "PYEXE=%%i"
if not defined PYEXE (
  for /f "delims=" %%i in ('python -c "import sys; print(sys.executable)" 2^>nul') do set "PYEXE=%%i"
)

if not defined PYEXE (
  echo.
  echo   Python 3.10+ is required once on this computer.
  echo   Install from https://www.python.org/downloads/
  echo   Check "Add python.exe to PATH", then double-click this file again.
  echo.
  pause
  start "" "https://www.python.org/downloads/"
  exit /b 1
)

echo.
echo   Found Python: %PYEXE%
echo   Starting your Qlix agent...
echo   Keep this window open while you use the agent in your browser.
echo.

if exist "%~dp0qlix-0.1.0-py3-none-any.whl" (
  "%PYEXE%" -m pip install "%~dp0qlix-0.1.0-py3-none-any.whl" -q --disable-pip-version-check --force-reinstall --no-deps
  "%PYEXE%" -m pip install "%~dp0qlix-0.1.0-py3-none-any.whl" -q --disable-pip-version-check
  if errorlevel 1 (
    echo.
    echo   Failed to install the Qlix package. See error above.
    pause
    exit /b 1
  )
) else if exist "%~dp0lib\qlix" (
  set "PYTHONPATH=%~dp0lib;%PYTHONPATH%"
)

"%PYEXE%" -m qlix.hybrid_runner

if errorlevel 1 (
  echo.
  echo   Could not start the agent. Contact your Qlix administrator.
  pause
)

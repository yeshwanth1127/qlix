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

set "PYLAUNCHER="
where py >nul 2>&1 && set "PYLAUNCHER=py"
if not defined PYLAUNCHER where python >nul 2>&1 && set "PYLAUNCHER=python"

if not defined PYLAUNCHER (
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
echo   Starting your Qlix agent...
echo   Keep this window open while you use the agent in your browser.
echo.

if exist "%~dp0qlix-agent.whl" (
  if /i "%PYLAUNCHER%"=="py" (
    py -3 -m pip install "%~dp0qlix-agent.whl[hybrid]" -q --disable-pip-version-check 2>nul
  ) else (
    python -m pip install "%~dp0qlix-agent.whl[hybrid]" -q --disable-pip-version-check 2>nul
  )
) else if exist "%~dp0lib\qlix" (
  set "PYTHONPATH=%~dp0lib;%PYTHONPATH%"
)

if /i "%PYLAUNCHER%"=="py" (
  py -3 -m qlix.hybrid_runner
) else (
  python -m qlix.hybrid_runner
)

if errorlevel 1 (
  echo.
  echo   Could not start the agent. Contact your Qlix administrator.
  pause
)

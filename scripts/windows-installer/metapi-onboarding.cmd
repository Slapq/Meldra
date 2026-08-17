@echo off
call "%~dp0metapi.cmd" setup
if errorlevel 1 (
  echo.
  echo MetaPi setup did not complete. You can run setup again from the desktop shortcut.
  pause
  exit /b %errorlevel%
)
call "%~dp0metapi.cmd" --profile default --workspace
exit /b %errorlevel%

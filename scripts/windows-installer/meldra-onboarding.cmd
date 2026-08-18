@echo off
call "%~dp0meldra.cmd" setup
if errorlevel 1 (
  echo.
  echo Meldra setup did not complete. You can run setup again from the desktop shortcut.
  pause
  exit /b %errorlevel%
)
call "%~dp0meldra.cmd" --profile default --workspace --startup-command /setup
exit /b %errorlevel%

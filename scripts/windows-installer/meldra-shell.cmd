@echo off
call "%~dp0meldra.cmd" --profile default --workspace
exit /b %errorlevel%

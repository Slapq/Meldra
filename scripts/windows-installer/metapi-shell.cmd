@echo off
call "%~dp0metapi.cmd" --profile default --workspace
exit /b %errorlevel%

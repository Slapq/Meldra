@echo off
setlocal
set "MELDRA_ROOT=%~dp0"
set "MELDRA_APP=%MELDRA_ROOT%app"
set "MELDRA_CLI=%MELDRA_APP%\node_modules\@earendil-works\pi-coding-agent\dist\cli.js"

if exist "%MELDRA_ROOT%runtime\node.exe" goto bundled_node
where node.exe >nul 2>nul
if errorlevel 1 goto missing_node
set "MELDRA_NODE=node.exe"
node.exe -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)" >nul 2>nul
if not errorlevel 1 goto run_meldra
echo Warning: Meldra supports Node.js 22.19.0 or newer.
echo The installed Node.js will still be used as requested.
goto run_meldra

:bundled_node
set "PATH=%MELDRA_ROOT%runtime;%PATH%"
set "MELDRA_NODE=%MELDRA_ROOT%runtime\node.exe"
goto run_meldra

:missing_node
echo Meldra is installed, but Node.js was not found.
echo Install Node.js 22.19.0 or newer, or install Meldra-Setup.exe.
exit /b 2

:run_meldra
if not exist "%MELDRA_CLI%" goto incomplete_install
"%MELDRA_NODE%" "%MELDRA_CLI%" %*
exit /b %errorlevel%

:incomplete_install
echo Meldra installation is incomplete: %MELDRA_CLI%
exit /b 3

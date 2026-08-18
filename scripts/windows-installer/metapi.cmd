@echo off
setlocal
set "METAPI_ROOT=%~dp0"
set "METAPI_APP=%METAPI_ROOT%app"
set "METAPI_CLI=%METAPI_APP%\node_modules\@earendil-works\pi-coding-agent\dist\cli.js"

if exist "%METAPI_ROOT%runtime\node.exe" goto bundled_node
where node.exe >nul 2>nul
if errorlevel 1 goto missing_node
set "METAPI_NODE=node.exe"
node.exe -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)" >nul 2>nul
if not errorlevel 1 goto run_metapi
echo Warning: Meldra supports Node.js 22.19.0 or newer.
echo The installed Node.js will still be used as requested.
goto run_metapi

:bundled_node
set "PATH=%METAPI_ROOT%runtime;%PATH%"
set "METAPI_NODE=%METAPI_ROOT%runtime\node.exe"
goto run_metapi

:missing_node
echo Meldra is installed, but Node.js was not found.
echo Install Node.js 22.19.0 or newer, or install Meldra-Setup.exe.
exit /b 2

:run_metapi
if not exist "%METAPI_CLI%" goto incomplete_install
"%METAPI_NODE%" "%METAPI_CLI%" %*
exit /b %errorlevel%

:incomplete_install
echo Meldra installation is incomplete: %METAPI_CLI%
exit /b 3

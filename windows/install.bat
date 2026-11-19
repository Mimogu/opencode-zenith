@echo off
setlocal
title OpenCode setup
cd /d "%~dp0"

if not exist "%~dp0install.ps1" (
    echo install.ps1 is missing. Extract the whole zip first, then run install.bat from the extracted folder.
    pause
    exit /b 1
)

echo.
echo  OpenCode setup - installs OpenCode, its rules, agents, skills and plugins,
echo  the automatic model ranking, and OmniRoute.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set RESULT=%ERRORLEVEL%

echo.
if "%RESULT%"=="0" (
    echo  Setup finished.
) else (
    echo  Setup stopped with an error ^(code %RESULT%^). See the messages above.
)
pause
exit /b %RESULT%

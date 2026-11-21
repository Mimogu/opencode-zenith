@echo off
setlocal
title OpenCode Zenith - Setup
if exist "%~dp0windows\install.bat" (
    call "%~dp0windows\install.bat" %*
) else if exist "%~dp0windows\install.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\install.ps1" %*
) else (
    echo Error: windows\install.bat not found. Extract the whole zip first, then run install.bat.
    pause
    exit /b 1
)
exit /b %ERRORLEVEL%

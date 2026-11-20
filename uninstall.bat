@echo off
setlocal
title OpenCode Zenith - Uninstall
if exist "%~dp0windows\uninstall.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\uninstall.ps1"
) else if exist "%~dp0uninstall.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
) else (
    echo Error: uninstall.ps1 not found.
)
pause

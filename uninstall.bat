@echo off
setlocal
title OpenCode Zenith - Uninstall
if exist "%~dp0windows\uninstall.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\uninstall.ps1"
) else (
    echo Error: windows\uninstall.ps1 not found.
)
pause

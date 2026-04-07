@echo off
REM ============================================================
REM  Draymond Orchestrator + Cloudflare Quick Tunnel
REM  
REM  Starts the Next.js production server and opens a public
REM  HTTPS tunnel so Open-Chat on your phone can reach it.
REM
REM  Requirements:
REM    - cloudflared installed (already in PATH)
REM    - Run "npm run build" first if not already built
REM
REM  Usage:
REM    Double-click this file OR run from a terminal.
REM    Copy the *.trycloudflare.com URL into Open-Chat Settings
REM    under Host (no port needed — HTTPS is handled by Cloudflare).
REM ============================================================

title Draymond + Tunnel

echo ============================================================
echo  Starting Draymond Orchestrator...
echo ============================================================

REM Start Next.js server in a new window so it stays open
start "Draymond Server" cmd /k "cd /d "%~dp0" && npm run start"

REM Wait 5 seconds for Next.js to bind to port 3000
echo Waiting for server to start on port 3000...
timeout /t 5 /nobreak >nul

echo ============================================================
echo  Starting Cloudflare Quick Tunnel -> localhost:3000
echo  (No login required — tunnel URL printed below)
echo ============================================================

REM Start cloudflare quick tunnel, output URL to console
REM The URL will look like: https://xxxx-xxxx.trycloudflare.com
cloudflared tunnel --url http://localhost:3000 --no-autoupdate

pause

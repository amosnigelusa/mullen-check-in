@echo off
rem Launch the Welcome Desk Check-In app on http://localhost:8000
cd /d "%~dp0"
start "" http://localhost:8000
node server.js

@echo off
REM Serve this repo to the phone over Tailscale. Helios launches this; it is
REM also fine to double-click. pythonw keeps it windowless -- the server logs
REM nothing anyone reads, and a console flashing up on every start is noise.
REM Stop it from Helios, or with:  curl -X POST http://127.0.0.1:8123/api/shutdown
cd /d "%~dp0"
start "" pythonw "%~dp0arcade\tools\serve.py" --port 8123

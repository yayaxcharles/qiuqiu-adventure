@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
call npx vite --port 5393 --open

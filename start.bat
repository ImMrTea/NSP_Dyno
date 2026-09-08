@echo off
title NSP Dyno - Virtual Dyno
echo Starting NSP Dyno Server...
start "" "http://localhost:3300"
node server/index.js
pause

@echo off
title Preparer la publication
cd /d "%~dp0"
node tools/build-site.js
pause

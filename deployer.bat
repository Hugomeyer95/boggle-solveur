@echo off
title Deployer sur Netlify
cd /d "%~dp0"

echo.
echo   [1/2] Preparation du dossier publier/
call node tools/build-site.js
if errorlevel 1 goto erreur

echo   [2/2] Envoi vers Netlify (site deja lie)
call npx.cmd --yes netlify-cli deploy --prod --dir publier
if errorlevel 1 goto erreur

echo.
echo   Termine. L'adresse du site est inchangee.
goto fin

:erreur
echo.
echo   Echec. Si c'est le premier lancement, lance d'abord
echo   netlify-connexion.bat (double-clic).

:fin
pause

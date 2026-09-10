@echo off
title Connexion a Netlify (une seule fois)
cd /d "%~dp0"

echo.
echo   Ce script tourne sous cmd.exe : la politique PowerShell qui
echo   bloque npx.ps1 ne s'applique pas ici.
echo.
echo   [1/2] Connexion au compte Netlify (ouvre le navigateur)
call npx.cmd --yes netlify-cli login
if errorlevel 1 goto erreur

echo.
echo   [2/2] Rattachement de ce dossier au site existant
echo   Choisis ton site dans la liste proposee.
call npx.cmd --yes netlify-cli link
if errorlevel 1 goto erreur

echo.
echo   C'est fait. Utilise desormais deployer.bat a chaque mise a jour.
goto fin

:erreur
echo.
echo   Echec. Reessaie, ou consulte le README.

:fin
pause

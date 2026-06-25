@echo off
setlocal
cd /d "%~dp0"
title Build Windows Installer
echo.
echo ============================================
echo Building Windows installer for Resume AI Screener
echo ============================================
echo.
if not exist package.json (
  echo package.json not found.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install Node.js LTS first.
  echo https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies first...
  npm install
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)
echo.
echo Building installer. This may take several minutes...
echo.
npm run dist:win
if errorlevel 1 (
  echo.
  echo Build failed. Please check the error above.
  pause
  exit /b 1
)
echo.
echo Build completed. Please check the dist folder.
echo.
pause

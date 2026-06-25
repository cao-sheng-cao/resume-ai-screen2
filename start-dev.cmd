@echo off
setlocal
cd /d "%~dp0"
title Start Resume AI Screener Dev
echo.
echo ============================================
echo Starting Electron app in development mode...
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
npm start
pause

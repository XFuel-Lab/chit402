@echo off
REM XFUEL Whitepaper PDF Generator (Windows)
REM Usage: Double-click this file or run from command prompt

echo ================================
echo XFUEL Whitepaper PDF Generator
echo ================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js 24+ from https://nodejs.org
    pause
    exit /b 1
)

echo Node.js version:
node --version
echo.

REM Check if required packages are installed
echo Checking dependencies...
npm list -g marked >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Installing 'marked' globally...
    npm install -g marked
)

npm list -g puppeteer >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Installing 'puppeteer' globally...
    npm install -g puppeteer
)

echo.
echo Dependencies installed!
echo.

REM Navigate to whitepaper directory
cd /d "%~dp0docs\whitepaper"

REM Generate PDF
echo Generating PDF from markdown...
echo.
node generate-pdf-v2.mjs

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ================================
    echo SUCCESS! PDF generated.
    echo ================================
    echo.
    echo Output: docs\whitepaper\XFUEL-ZK-Bridge-Whitepaper.pdf
    echo Preview: docs\whitepaper\XFUEL-ZK-Bridge-Whitepaper.html
    echo.
    
    REM Ask if user wants to open PDF
    set /p OPEN_PDF="Open PDF now? (y/n): "
    if /i "%OPEN_PDF%"=="y" (
        start XFUEL-ZK-Bridge-Whitepaper.pdf
    )
) else (
    echo.
    echo ================================
    echo ERROR: PDF generation failed!
    echo ================================
    echo.
    echo Check the error messages above.
)

echo.
pause


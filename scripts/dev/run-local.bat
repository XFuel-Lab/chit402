@echo off
echo Starting XFUEL Local Development...
echo.
echo Starting Backend API Server (Port 3001)...
start "XFUEL Backend" cmd /k "npm run dev:backend"
timeout /t 3 /nobreak >nul
echo.
echo Starting Frontend Dev Server...
start "XFUEL Frontend" cmd /k "npm run dev"
echo.
echo Both servers starting...
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo.
echo Press any key to close this window (servers will keep running)
pause >nul


@echo off
REM Quick script to toggle maintenance mode (Windows)

set ENV_FILE=.env.local

if exist "%ENV_FILE%" (
  findstr /C:"VITE_MAINTENANCE=true" "%ENV_FILE%" >nul
  if %errorlevel% equ 0 (
    echo 🟢 Disabling maintenance mode...
    echo VITE_MAINTENANCE=false > "%ENV_FILE%"
    echo ✅ Maintenance mode is now OFF
    echo    App will run normally
  ) else (
    echo 🔴 Enabling maintenance mode...
    echo VITE_MAINTENANCE=true > "%ENV_FILE%"
    echo ✅ Maintenance mode is now ON
    echo    Maintenance overlay will show
  )
) else (
  echo 🔴 Enabling maintenance mode...
  echo VITE_MAINTENANCE=true > "%ENV_FILE%"
  echo ✅ Maintenance mode is now ON
  echo    Maintenance overlay will show
)

echo.
echo 📝 Note: Restart your dev server for changes to take effect:
echo    npm run dev
pause


#!/bin/bash
# Quick script to toggle maintenance mode

ENV_FILE=".env.local"

# Check current state
if [ -f "$ENV_FILE" ]; then
  CURRENT=$(grep "VITE_MAINTENANCE" "$ENV_FILE" | cut -d '=' -f2)
  
  if [ "$CURRENT" = "true" ]; then
    echo "🟢 Disabling maintenance mode..."
    echo "VITE_MAINTENANCE=false" > "$ENV_FILE"
    echo "✅ Maintenance mode is now OFF"
    echo "   App will run normally"
  else
    echo "🔴 Enabling maintenance mode..."
    echo "VITE_MAINTENANCE=true" > "$ENV_FILE"
    echo "✅ Maintenance mode is now ON"
    echo "   Maintenance overlay will show"
  fi
else
  echo "🔴 Enabling maintenance mode..."
  echo "VITE_MAINTENANCE=true" > "$ENV_FILE"
  echo "✅ Maintenance mode is now ON"
  echo "   Maintenance overlay will show"
fi

echo ""
echo "📝 Note: Restart your dev server for changes to take effect:"
echo "   npm run dev"


#!/bin/sh
# Minimal entrypoint: one log line then run CMD or default.
echo "[zkgpt-entrypoint] start"
if [ $# -gt 0 ]; then
  exec "$@"
else
  exec node /app/wrapper-template.cjs
fi

#!/bin/bash
set -euo pipefail

BINARY="/app/target/release/prove"
ARGS="serve --port 80"
MAX_RESTARTS=50
RESTART_DELAY=3
HEALTH_URL="http://localhost:80/healthz"
HEALTH_CHECK_INTERVAL=30
HEALTH_TIMEOUT=10

restart_count=0

log() {
  echo "[watchdog $(date -u '+%Y-%m-%d %H:%M:%S')] $*"
}

health_check() {
  local response
  response=$(curl -sf --max-time "$HEALTH_TIMEOUT" "$HEALTH_URL" 2>/dev/null) || return 1
  echo "$response" | grep -q '"status"' || return 1
  return 0
}

start_health_monitor() {
  while true; do
    sleep "$HEALTH_CHECK_INTERVAL"
    if ! health_check; then
      log "WARN: Health check failed, prover may be unhealthy"
    fi
  done
}

while true; do
  if [ "$restart_count" -ge "$MAX_RESTARTS" ]; then
    log "ERROR: Max restarts ($MAX_RESTARTS) reached, giving up"
    exit 1
  fi

  log "Starting SP1 prover (attempt $((restart_count + 1))/$MAX_RESTARTS)"
  log "Command: $BINARY $ARGS"

  start_health_monitor &
  HEALTH_PID=$!

  $BINARY $ARGS
  EXIT_CODE=$?

  kill "$HEALTH_PID" 2>/dev/null || true

  restart_count=$((restart_count + 1))

  if [ "$EXIT_CODE" -eq 0 ]; then
    log "Prover exited cleanly (code 0), restarting in ${RESTART_DELAY}s..."
  else
    log "Prover crashed (exit code $EXIT_CODE), restarting in ${RESTART_DELAY}s..."
  fi

  sleep "$RESTART_DELAY"
done

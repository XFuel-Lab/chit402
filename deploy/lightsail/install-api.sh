#!/usr/bin/env bash
# Idempotent installer for the gateway systemd unit.
# Required environment (do not commit the values):
#   XFUEL_REPO            checkout path
#   XFUEL_SYSTEMD_UNIT    systemd unit name, without the .service suffix
#   XFUEL_SERVICE_USER    account the process runs as
# Optional:
#   XFUEL_LEGACY_SYSTEMD_UNIT   previous unit name to stop and archive
#   XFUEL_LEGACY_PM2_APP        previous process-manager app name to delete
set -euo pipefail

: "${XFUEL_REPO:?Set XFUEL_REPO to the checkout path}"
: "${XFUEL_SYSTEMD_UNIT:?Set XFUEL_SYSTEMD_UNIT to the systemd unit name}"
: "${XFUEL_SERVICE_USER:?Set XFUEL_SERVICE_USER to the service account}"

GW="$XFUEL_REPO/services/gateway"
TEMPLATE="$XFUEL_REPO/deploy/lightsail/gateway.service.in"
UNIT_DST="/etc/systemd/system/${XFUEL_SYSTEMD_UNIT}.service"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }

die() { red "ERROR: $*"; exit 1; }

[[ "$(id -u)" -eq 0 ]] && die "Run as the service user (script will sudo), not as root"
[[ -d "$GW" ]] || die "Gateway missing: $GW"
[[ -f "$GW/src/server.js" ]] || die "server.js missing under $GW"
[[ -f "$GW/src/cdp-jwt.js" ]] || die "cdp-jwt.js missing — wrong / stale tree"
[[ -f "$GW/.env" ]] || die "Missing $GW/.env — copy the mainnet payment block first"
[[ -f "$TEMPLATE" ]] || die "Unit template missing: $TEMPLATE"

ylw "==> Checking .env (names only)"
grep -E '^X402_NETWORK=|^X402_PAY_TO=|^X402_ENABLED=|^CDP_API_KEY_ID=' "$GW/.env" \
  || die ".env missing X402_/CDP_ keys"
grep -q '^X402_NETWORK=base$' "$GW/.env" || die "X402_NETWORK must be exactly: base"
grep -q '^CDP_API_KEY_SECRET=.' "$GW/.env" || die "CDP_API_KEY_SECRET missing"

ylw "==> npm install"
( cd "$GW" && npm install --omit=dev )

ylw "==> Stopping / disabling legacy units"
if [[ -n "${XFUEL_LEGACY_PM2_APP:-}" ]] && command -v pm2 >/dev/null 2>&1; then
  pm2 delete "$XFUEL_LEGACY_PM2_APP" 2>/dev/null || true
  pm2 save 2>/dev/null || true
fi
if [[ -n "${XFUEL_LEGACY_SYSTEMD_UNIT:-}" ]]; then
  sudo systemctl stop "${XFUEL_LEGACY_SYSTEMD_UNIT}.service" 2>/dev/null || true
  sudo systemctl disable "${XFUEL_LEGACY_SYSTEMD_UNIT}.service" 2>/dev/null || true
  old_unit="/etc/systemd/system/${XFUEL_LEGACY_SYSTEMD_UNIT}.service"
  if [[ -f "$old_unit" ]]; then
    sudo mv "$old_unit" "/tmp/${XFUEL_LEGACY_SYSTEMD_UNIT}.service.bak.$(date +%Y%m%d%H%M%S)"
    ylw "Archived legacy unit"
  fi
fi
sudo systemctl stop "${XFUEL_SYSTEMD_UNIT}.service" 2>/dev/null || true

ylw "==> Installing $UNIT_DST"
tmp="$(mktemp)"
sed \
  -e "s|<ENV_PATH>|${GW}|g" \
  -e "s|<SERVICE_USER>|${XFUEL_SERVICE_USER}|g" \
  "$TEMPLATE" > "$tmp"
sudo cp "$tmp" "$UNIT_DST"
rm -f "$tmp"
sudo systemctl daemon-reload
sudo systemctl enable "${XFUEL_SYSTEMD_UNIT}.service"

ylw "==> Freeing :3002 (best effort — reboot is definitive)"
sudo systemctl stop "${XFUEL_SYSTEMD_UNIT}.service" 2>/dev/null || true
sudo fuser -k 3002/tcp 2>/dev/null || true
sleep 1

if sudo ss -H -lptn 'sport = :3002' | grep -q .; then
  red "Port 3002 still in use:"
  sudo ss -lptn 'sport = :3002' || true
  ylw ""
  ylw "Unit is installed + enabled. Do a clean reboot so only ${XFUEL_SYSTEMD_UNIT} starts:"
  ylw "  sudo reboot"
  ylw ""
  ylw "After reboot:"
  ylw "  curl -sS http://127.0.0.1:3002/health"
  exit 2
fi

ylw "==> Starting ${XFUEL_SYSTEMD_UNIT}"
sudo systemctl reset-failed "${XFUEL_SYSTEMD_UNIT}.service" 2>/dev/null || true
sudo systemctl start "${XFUEL_SYSTEMD_UNIT}.service"
sleep 3

state="$(systemctl is-active "${XFUEL_SYSTEMD_UNIT}.service" || true)"
if [[ "$state" != "active" ]]; then
  red "Service not active ($state). Logs:"
  sudo journalctl -u "${XFUEL_SYSTEMD_UNIT}.service" -n 40 --no-pager || true
  die "start failed"
fi

ylw "==> Health fingerprint"
health="$(curl -sS --max-time 5 http://127.0.0.1:3002/health || true)"
echo "$health" | head -c 500; echo

if echo "$health" | grep -q '30% BBB'; then
  die "OLD gateway fingerprint still live (30% BBB). Wrong tree or orphan."
fi
if ! echo "$health" | grep -q 'usdc-base-splits\|"buckets"'; then
  ylw "WARN: unexpected health shape — check revenue_split manually"
fi

quote="$(curl -sS --max-time 5 http://127.0.0.1:3002/task-quote \
  -H 'content-type: application/json' -H 'X-API-Key: xfuel-demo' \
  -d '{"model_id":"llama-3-70b","amount":"10000"}' || true)"
echo "$quote" | head -c 400; echo
echo "$quote" | grep -q '"network":"base"' || die "quote network is not base"

grn "OK — ${XFUEL_SYSTEMD_UNIT} active on the gateway tree (Base mainnet quote)."
grn "Public check: curl -sS https://api.chit402.com/health"

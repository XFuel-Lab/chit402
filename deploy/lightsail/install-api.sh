#!/usr/bin/env bash
# Idempotent Lightsail installer for the XFuel gateway.
# Run on the box as ubuntu (script uses sudo):
#   cd ~/xfuel-protocol && bash deploy/lightsail/install-api.sh
# Then either: sudo systemctl start xfuel-api
#          or: sudo reboot   ← cleanest if port 3002 is haunted
set -euo pipefail

REPO="${REPO:-/home/ubuntu/xfuel-protocol}"
GW="$REPO/services/gateway"
UNIT_SRC="$REPO/deploy/lightsail/xfuel-api.service"
UNIT_DST="/etc/systemd/system/xfuel-api.service"
OLD_UNIT="/etc/systemd/system/xfuel-testnet-api.service"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }

die() { red "ERROR: $*"; exit 1; }

[[ "$(id -u)" -eq 0 ]] && die "Run as ubuntu (script will sudo), not as root"
[[ -d "$GW" ]] || die "Gateway missing: $GW"
[[ -f "$GW/src/server.js" ]] || die "server.js missing under $GW"
[[ -f "$GW/src/cdp-jwt.js" ]] || die "cdp-jwt.js missing — wrong / stale tree"
[[ -f "$GW/.env" ]] || die "Missing $GW/.env — copy mainnet CDP + X402 block first"
[[ -f "$UNIT_SRC" ]] || die "Unit template missing: $UNIT_SRC"

ylw "==> Checking .env (names only)"
grep -E '^X402_NETWORK=|^X402_PAY_TO=|^X402_ENABLED=|^CDP_API_KEY_ID=' "$GW/.env" \
  || die ".env missing X402_/CDP_ keys"
grep -q '^X402_NETWORK=base$' "$GW/.env" || die "X402_NETWORK must be exactly: base"
grep -q '^CDP_API_KEY_SECRET=.' "$GW/.env" || die "CDP_API_KEY_SECRET missing"

ylw "==> npm install"
( cd "$GW" && npm install --omit=dev )

ylw "==> Stopping / disabling legacy units (pm2 + old systemd names)"
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete xfuel-m2m 2>/dev/null || true
  pm2 save 2>/dev/null || true
fi
sudo systemctl stop xfuel-testnet-api.service 2>/dev/null || true
sudo systemctl disable xfuel-testnet-api.service 2>/dev/null || true
sudo systemctl stop xfuel-api.service 2>/dev/null || true

if [[ -f "$OLD_UNIT" ]]; then
  sudo mv "$OLD_UNIT" "/tmp/xfuel-testnet-api.service.bak.$(date +%Y%m%d%H%M%S)"
  ylw "Archived legacy unit → /tmp/"
fi

ylw "==> Installing $UNIT_DST"
sudo cp "$UNIT_SRC" "$UNIT_DST"
sudo systemctl daemon-reload
sudo systemctl enable xfuel-api.service

ylw "==> Freeing :3002 (best effort — reboot is definitive)"
sudo systemctl stop xfuel-api.service 2>/dev/null || true
sudo fuser -k 3002/tcp 2>/dev/null || true
sleep 1

if sudo ss -H -lptn 'sport = :3002' | grep -q .; then
  red "Port 3002 still in use:"
  sudo ss -lptn 'sport = :3002' || true
  ylw ""
  ylw "Unit is installed + enabled. Do a CLEAN reboot so only xfuel-api starts:"
  ylw "  sudo reboot"
  ylw ""
  ylw "After reboot:"
  ylw "  curl -sS http://127.0.0.1:3002/health"
  ylw "  # pass = revenue_split is an OBJECT (usdc-base-splits), NOT '30% BBB...'"
  exit 2
fi

ylw "==> Starting xfuel-api"
sudo systemctl reset-failed xfuel-api.service 2>/dev/null || true
sudo systemctl start xfuel-api.service
sleep 3

state="$(systemctl is-active xfuel-api.service || true)"
if [[ "$state" != "active" ]]; then
  red "Service not active ($state). Logs:"
  sudo journalctl -u xfuel-api.service -n 40 --no-pager || true
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

grn "OK — xfuel-api active on new gateway tree (Base mainnet quote)."
grn "Public check: curl -sS https://api-testnet.xfuel.app/health"
grn "Then: cd packages/sdk && \$env:XFUEL_API_URL='https://api-testnet.xfuel.app'; npx tsx examples/flagship-demo.ts"

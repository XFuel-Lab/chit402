# Lightsail gateway ops

Canonical way to run `https://api-testnet.xfuel.app` — **not** PM2, **not** `/opt/.../theta-bridge`.

## Layout

| Piece | Path |
|-------|------|
| Code | `/home/ubuntu/xfuel-protocol/services/gateway` |
| Env | `/home/ubuntu/xfuel-protocol/services/gateway/.env` |
| Unit | `xfuel-api.service` (this folder → `/etc/systemd/system/`) |
| Port | `3002` |

Do **not** use `EnvironmentFile=` for CDP secrets — systemd mangles base64 (`+/=`). The unit sources `.env` via bash.

## One-time / recover (recommended)

On the box:

```bash
cd ~/xfuel-protocol
git pull   # when this folder is on the remote; or scp deploy/lightsail/* up

# Ensure .env has mainnet block (X402_NETWORK=base, CDP_*, new X402_PAY_TO ≠ deployer)
nano services/gateway/.env

bash deploy/lightsail/install-api.sh
```

If the script exits saying port 3002 is busy:

```bash
sudo reboot
```

After reboot only `xfuel-api` should start. Then:

```bash
curl -sS http://127.0.0.1:3002/health
# PASS: revenue_split is an object (usdc-base-splits / buckets)
# FAIL: revenue_split string "30% BBB / 30% LP / ..."  → still old process

curl -sS https://api-testnet.xfuel.app/task-quote \
  -H 'content-type: application/json' -H 'X-API-Key: xfuel-demo' \
  -d '{"model_id":"llama-3-70b","amount":"10000"}'
# PASS: "network":"base"
```

Day-to-day:

```bash
cd ~/xfuel-protocol && git pull
cd services/gateway && npm install --omit=dev
sudo systemctl restart xfuel-api
sudo systemctl status xfuel-api --no-pager
```

## Why reboot

Orphan `node` processes from the old `npm run m2m-server` unit held `:3002` while `Restart=always` respawned. Killing in a loop races systemd. **Install the new unit + reboot** clears orphans in one shot.

## Legacy to remove

- `/etc/systemd/system/xfuel-testnet-api.service` → `WorkingDirectory=/opt/.../theta-bridge` (dead)
- PM2 app `xfuel-m2m`

`install-api.sh` archives/disables those.

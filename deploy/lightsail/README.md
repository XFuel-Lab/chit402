# Gateway host ops

Canonical way to run the public API at `https://api.chit402.com`. Keep `api.xfuel.app` on the same site block so that hostname still resolves. Do not provision a retired demo hostname. Do not give `api.xfuel.app` out as the default.

DNS for extra API names points at this instance. TLS is terminated on the box (Caddy or nginx + certbot), not on the marketing host. Add a new name to the existing site block and cert; do not stand up a second proxy or instance.

```bash
sudo ss -tlnp | grep -E ':443|:80'
systemctl is-active caddy nginx
sudo certbot certificates
```

Caddy — all names on one site:

```
api.chit402.com, api.xfuel.app {
    reverse_proxy 127.0.0.1:3002
}
```

Do not point the apex marketing host at this API box.

certbot + nginx — the cert covers the public API names; add both to `server_name`, reload.

Receipt links: Set `PUBLIC_HOSTS=api.chit402.com,api.xfuel.app` in `.env` so a request that still arrives on the older hostname gets self-links on that host. Set `PUBLIC_BASE_URL=https://api.chit402.com` as the fallback for unrecognized hosts. Then restart the systemd unit. Do not rotate `RECEIPT_SIGNING_SECRET`.

## Layout

Identifiers live in the environment, not in this file.

| Variable | Meaning |
|----------|---------|
| `XFUEL_REPO` | Checkout path on the host |
| `XFUEL_SYSTEMD_UNIT` | systemd unit name, without `.service` |
| `XFUEL_SERVICE_USER` | Account the process runs as |
| `XFUEL_LEGACY_SYSTEMD_UNIT` | Optional previous unit to stop and archive |
| `XFUEL_LEGACY_PM2_APP` | Optional previous process-manager app to delete |

| Piece | Path |
|-------|------|
| Code | `$XFUEL_REPO/services/gateway` |
| Env | `$XFUEL_REPO/services/gateway/.env` (`<ENV_PATH>`) |
| Unit template | `deploy/lightsail/gateway.service.in` |
| Installed unit | `/etc/systemd/system/$XFUEL_SYSTEMD_UNIT.service` |
| Port | `3002` |

Do not use `EnvironmentFile=` for CDP secrets — systemd mangles base64 (`+/=`). The unit sources `.env` via bash:

```
ExecStart=/bin/bash -lc 'set -a; source ./.env; set +a; exec /usr/bin/node src/server.js'
```

Because it is bash-sourced, any value containing `{ } " ' space` must be single-quoted in `.env`
(`PROVIDER_FLOATS_JSON='{"theta-edgecloud":{…}}'`). Unquoted JSON is mangled or fails to source, and
the service then starts with the variable silently empty.

## Required env

`install-api.sh` checks the `X402_*` / `CDP_*` block. These are not checked and each fails
quietly — the service starts, serves traffic, and is wrong:

| Var | Missing means |
|-----|---------------|
| `RECEIPT_SIGNING_SECRET` | Receipts are unsigned. They still render with model, provider, payment and output hash, and look authoritative. Tier-1 verifiability is simply off. Visible at `GET /health` → `receipts.tier1_signed` and in the boot log. Do not rotate it once set — every receipt already issued verifies against the old value |
| `AKASHML_API_KEY` | Must start `akml-` (a console key is a different product and is rejected). Without it the Akash hub drops out of the catalogue |
| `ALLOW_MOCK_INFERENCE` | Leave unset in production. `true` lets a paid task be answered by a mock |
| `PROVIDER_FLOATS_JSON` | Optional, but a float id must exist per provider you route to or that provider's COGS never burns. Ids are `theta-edgecloud` and `akash-network` |
| `FREE_TIER_DAILY_COGS_USD` | A per-caller daily ceiling. `0` restores uncapped serving. Visible at `GET /health` → `free_tier` |

Check names without printing values, from the gateway directory:

```bash
cd "$XFUEL_REPO/services/gateway"
for v in RECEIPT_SIGNING_SECRET AKASHML_API_KEY ALLOW_MOCK_INFERENCE PROVIDER_FLOATS_JSON FREE_TIER_DAILY_COGS_USD; do
  grep -q "^$v=" .env && echo "SET      $v" || echo "MISSING  $v"
done
```

## Install

On the host, export the variables above, then:

```bash
cd "$XFUEL_REPO"
git pull
bash deploy/lightsail/install-api.sh
```

If the script exits saying port 3002 is busy:

```bash
sudo reboot
```

After reboot only `$XFUEL_SYSTEMD_UNIT` should start. Then:

```bash
curl -sS http://127.0.0.1:3002/health
curl -sS https://api.chit402.com/task-quote \
  -H 'content-type: application/json' -H 'X-API-Key: xfuel-demo' \
  -d '{"model_id":"xfuel/auto","amount":"10000"}'
```

Day-to-day:

```bash
cd "$XFUEL_REPO" && git pull
cd services/gateway && npm install --omit=dev
sudo systemctl restart "$XFUEL_SYSTEMD_UNIT"
sudo systemctl status "$XFUEL_SYSTEMD_UNIT" --no-pager
```

Then verify from a workstation:

```bash
node scripts/dev/_verify_deploy.mjs https://api.chit402.com
```

## Why reboot

Orphan `node` processes can hold `:3002` while a restart policy respawns. Killing in a loop races systemd. Install the unit and reboot to clear orphans in one shot.

`install-api.sh` archives and disables `XFUEL_LEGACY_SYSTEMD_UNIT` and `XFUEL_LEGACY_PM2_APP` when those variables are set.

# Lightsail gateway ops

Canonical way to run `https://api.xfuel.app` (alias `api-testnet.xfuel.app`) — **not** PM2, **not** `/opt/.../theta-bridge`.

To add a hostname: [docs/API_HOSTNAME.md](../../docs/API_HOSTNAME.md). Same box, same static IP. Do not create a new instance.

## Layout

| Piece | Path |
|-------|------|
| Code | `/home/ubuntu/xfuel-protocol/services/gateway` |
| Env | `/home/ubuntu/xfuel-protocol/services/gateway/.env` |
| Unit | `xfuel-api.service` (this folder → `/etc/systemd/system/`) |
| Port | `3002` |

Do **not** use `EnvironmentFile=` for CDP secrets — systemd mangles base64 (`+/=`). The unit sources `.env` via bash:

```
ExecStart=/bin/bash -lc 'set -a; source ./.env; set +a; exec /usr/bin/node src/server.js'
```

Because it is **bash-sourced**, any value containing `{ } " ' space` must be single-quoted in `.env`
(`PROVIDER_FLOATS_JSON='{"theta-edgecloud":{…}}'`). Unquoted JSON is mangled or fails to source, and
the service then starts with the variable silently empty.

## Required env

`install-api.sh` checks the `X402_*` / `CDP_*` block. These are **not** checked and each fails
quietly — the service starts, serves traffic, and is wrong:

| Var | Missing means |
|-----|---------------|
| `RECEIPT_SIGNING_SECRET` | **Receipts are unsigned.** They still render with model, provider, payment and output hash, and look authoritative. Tier-1 verifiability is simply off. Visible at `GET /health` → `receipts.tier1_signed` and in the boot log. **Do not rotate it** once set — every receipt already issued verifies against the old value |
| `AKASHML_API_KEY` | Must start `akml-` (an `ac.sk.…` Akash *Console* key is a different product and is rejected). Without it the Akash hub drops out of the catalogue, `xfuel/auto` degrades to Theta, and any request carrying `tools` fails with `tools_unsupported_on_hub` — Theta cannot serve tools |
| `ALLOW_MOCK_INFERENCE` | Leave **unset** in production. `true` lets a paid task be answered by a mock, which is a signed receipt for an inference that never ran |
| `PROVIDER_FLOATS_JSON` | Optional, but a float id must exist per provider you route to or that provider's COGS never burns. Ids are `theta-edgecloud` and `akash-network` |
| `FREE_TIER_DAILY_COGS_USD` | Defaults to `$1` per caller per UTC day, so **leaving it unset still enforces a ceiling**. Past it, unmetered `/v1` returns 402 `free_tier_exhausted`. The demo key is one bucket for all public traffic, making this the cap on public exposure (~10 agent-shaped calls or ~110 short completions). `0` restores uncapped serving; COGS is measured either way. Visible at `GET /health` → `free_tier` |

Check names without printing values:

```bash
cd ~/xfuel-protocol/services/gateway
for v in RECEIPT_SIGNING_SECRET AKASHML_API_KEY ALLOW_MOCK_INFERENCE PROVIDER_FLOATS_JSON FREE_TIER_DAILY_COGS_USD; do
  grep -q "^$v=" .env && echo "SET      $v" || echo "MISSING  $v"
done
```

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

curl -sS https://api.xfuel.app/task-quote \
  -H 'content-type: application/json' -H 'X-API-Key: xfuel-demo' \
  -d '{"model_id":"xfuel/auto","amount":"10000"}'
# PASS: "network":"base"
```

Day-to-day:

```bash
cd ~/xfuel-protocol && git pull
cd services/gateway && npm install --omit=dev
sudo systemctl restart xfuel-api
sudo systemctl status xfuel-api --no-pager
```

Then verify from a workstation — one command, and it exits non-zero on any failure:

```bash
node scripts/dev/_verify_deploy.mjs https://api.xfuel.app
```

It checks that the build actually deployed, signing is on, the quote prices the model that will
serve, the receipt is signed and identical inline vs canonical, and the paid path reaches a real
provider. `systemctl status` showing `active` proves none of that.

## Why reboot

Orphan `node` processes from the old `npm run m2m-server` unit held `:3002` while `Restart=always` respawned. Killing in a loop races systemd. **Install the new unit + reboot** clears orphans in one shot.

## Legacy to remove

- `/etc/systemd/system/xfuel-testnet-api.service` → `WorkingDirectory=/opt/.../theta-bridge` (dead)
- PM2 app `xfuel-m2m`

`install-api.sh` archives/disables those.

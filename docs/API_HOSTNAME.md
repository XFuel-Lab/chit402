# Public API hostname

Canonical host: `https://api.xfuel.app`  
Permanent alias: `https://api-testnet.xfuel.app`  
OpenAI path (not a hostname): `https://api.xfuel.app/v1`

The Lightsail **instance name** is a label. The public name is a DNS record pointing at the existing static IP. **Do not create a new instance.**

Product language is **public beta**. That is a stage, not a third hostname. Do not add `api-beta.xfuel.app` — we would only have to rename it again.

## What is already live

| Piece | Value | Change? |
|-------|--------|---------|
| Box | Lightsail `35.180.10.142` | Keep |
| Process | systemd `xfuel-api` → `:3002` | Keep |
| Site | `xfuel.app` / `www.xfuel.app` on Vercel | Keep — do **not** add `api` as a Vercel domain |
| Old host | `api-testnet.xfuel.app` | Keep as alias forever |
| New host | `api.xfuel.app` | **You add this** |

`/v1` does not move. Partners still set `baseURL` to `https://api.xfuel.app/v1`.

## You (founder) — in this order

### 1. DNS

Wherever `xfuel.app` NS live (Cloudflare, Route53, registrar):

```
api.xfuel.app    A     35.180.10.142
```

Leave `api-testnet.xfuel.app` pointing at the same IP.

Do **not** create this record on Vercel. Vercel hosts the marketing site only. An `api` domain on the Vercel project would steal the name from Lightsail.

If the zone is Cloudflare:

- Grey-cloud (DNS only) if TLS is already terminated on the box (Caddy / nginx / certbot). That matches how `api-testnet` almost certainly works today.
- Orange-cloud only if you already proxy `api-testnet` that way. Then copy the same SSL mode (Full / Full strict).

Wait until `api.xfuel.app` resolves from your laptop:

```powershell
nslookup api.xfuel.app
curl.exe -sS --connect-timeout 5 http://api.xfuel.app:3002/health
```

Port 3002 may be firewalled from the public internet (only 80/443 open). If HTTP on 3002 fails, that is fine — go to step 2.

### 2. TLS on the same box

SSH to the existing instance. Find what already serves `api-testnet.xfuel.app` on 443:

```bash
sudo ss -tlnp | grep -E ':443|:80'
systemctl is-active caddy nginx 2>/dev/null
sudo certbot certificates 2>/dev/null
sudo ls /etc/caddy/Caddyfile /etc/nginx/sites-enabled 2>/dev/null
```

Add `api.xfuel.app` next to `api-testnet.xfuel.app` in that same site block. Examples:

Caddy:

```
api.xfuel.app, api-testnet.xfuel.app {
    reverse_proxy 127.0.0.1:3002
}
```

```bash
sudo systemctl reload caddy
```

certbot + nginx: expand the existing cert, do not issue a second unrelated one.

```bash
sudo certbot certonly --nginx -d api-testnet.xfuel.app -d api.xfuel.app
# then add server_name api.xfuel.app; to the same server {} and reload nginx
```

Do not install a second reverse proxy.

### 3. Confirm both names hit the same process

From your laptop:

```powershell
curl.exe -sS https://api.xfuel.app/health
curl.exe -sS https://api-testnet.xfuel.app/health
```

Both must return `"status":"ok"` and the same `fee_config.revenue_split.model`. Then:

```powershell
curl.exe -sS https://www.xfuel.app/v1
```

That is still the **site** explainer, not the gateway. The gateway is only `api*.xfuel.app`.

### 4. Canonical receipt links (optional, same box)

In `~/xfuel-protocol/services/gateway/.env`:

```
PUBLIC_BASE_URL=https://api.xfuel.app
```

Then `sudo systemctl restart xfuel-api`. Receipt `verify_url`s will use the new host. Old `api-testnet` receipt URLs keep working because the alias still serves the same app.

Do not rotate `RECEIPT_SIGNING_SECRET`. Leave `ALLOW_MOCK_INFERENCE` unset.

```powershell
node scripts/dev/_verify_deploy.mjs https://api.xfuel.app
node scripts/dev/_verify_deploy.mjs https://api-testnet.xfuel.app
```

### 5. Merge this PR, then site + npm

After step 3 is green:

1. Merge the hostname copy PR (site, docs, SDK default, outreach).
2. Vercel deploys `xfuel.app` snippets to `api.xfuel.app`.
3. Publish `xfuel-sdk@0.5.5` so `DEFAULT_BASE_URL` on npm matches. Until then, published `0.5.4` / `xfuel-mcp@0.3.0` still default to the **alias**, which is correct.
4. Outreach uses `https://api.xfuel.app/v1`.

## What you do not do

- New Lightsail instance, new static IP, or “create from snapshot to rename.”
- Rename the systemd unit. `xfuel-api` is fine.
- Point partners at `xfuel.app/v1`.
- Drop `api-testnet.xfuel.app`. Old curls and npm `0.5.4` keep using it.
- Turn on `X402_METER_V1` as part of this. Unrelated.

## If you only want the instance label to say “beta”

AWS console → Lightsail → instance → rename. That changes the label in the console. It does not change DNS, TLS, or what partners type.

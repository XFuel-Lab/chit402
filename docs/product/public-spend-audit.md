# Public spend audit

`/audit` on the web app. A visitor pastes a Base wallet or a Solana address and gets a report. No signup. The report does not read the possession book.

## What it reads

- **Base USDC out.** `eth_getLogs` on `https://mainnet.base.org` for `Transfer` events from the wallet on Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. That is the same contract and the same public RPC the receipt payer check uses. The window is 302400 blocks (about 7 days at a 2-second block). The public RPC rejects a wider `eth_getLogs` span with HTTP 413 (`eth_getLogs is limited to a 500 range`), so the page walks the window in chunks of 500 blocks. A chunk that still returns 413, or another range-limit error, is halved down to a single block. Log reads run two at a time, with a short gap between starts. HTTP 429 backs off and pauses the rest of the scan so the public RPC is not asked for the whole window at once.
- **Solana USDC out.** Mainnet mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, classic Token program only, last 7 days by block time. The browser calls `/api/solana-audit/*`. That function calls Helius. See below.
- **Public Chit receipt.** `GET /receipt/by-tx?tx=base:<hash>&format=json` or `tx=solana:<signature>&format=json`. The lookup follows one redirect only when the target is `https://api.chit402.com/receipt/<id>?format=json`. A row is receipted only when the shell's chain, transaction, asset, payee, and amount all match that row. HTTP 404 means no public receipt. A failed lookup is unavailable. A shell that does not match is `receipt_mismatch`. Neither is counted as receipted.

Incoming transfers are not spend and are not included.

## What the report shows

- USDC out per `payTo`. The documented fee sink `0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334` is labeled "Chit402 fee sink". The label is not proof the transfer was a protocol fee. A Solana destination with no owner in the transaction is "pay_to unknown" and cannot be receipted.
- **x402** when a public Chit receipt matches that row, or (Base only) the transaction calls USDC `transferWithAuthorization` (`0xe3ee160e`). A plain transfer with no matching receipt is **other**. A Solana `transferChecked` with no matching receipt stays **undetected**, including when another account paid the network fee. The page then says "Network fee paid by another account" and does not show or export that fee payer.
- Unreceipted spend is the chain amount whose receipt lookup returned 404. The possession book can hold rows this page cannot see.
- Spikes: a positive transfer at least 5× the median, and only when the window has at least four positive transfers. Near-duplicates: same payee, same amount, different transaction, within 90 seconds (or 25 blocks when a timestamp is missing).
- CSV and JSON download. Schema `chit402.public_spend_audit.v1`. The CSV preamble repeats whether the total is complete.

## Solana

Paste a Solana mainnet address and click Run. A `?address=` link prefills the field and does not start the scan. Devnet and other tokens are not scanned.

Reads go through `/api/solana-audit/*`, which calls Helius with `HELIUS_API_KEY`. The address is sent to that provider, the same way a Base address is sent to `mainnet.base.org`. The key is read only in the server function. It is not a `VITE_` or `NEXT_PUBLIC_` name and it is not in the browser bundle.

Delegate transfers out of token accounts that were closed before the scan are not visible. An incomplete Solana scan shows no total. A short history page counts only when a pinned coverage check succeeds, or when the page itself contains a signature older than the window.

## What it does not do

- **Agent id.** `GET /v1/agents/:agent_id/book` without a session is possession-gated. The page reports that and does not invent a figure. Paste the wallet that paid.
- **Caps.** Daily and hourly caps stay on `GET /v1/agents/:agent_id/book/policy`. This page does not read them.
- **Incomplete scans.** If a read fails, history is unproven, or a cap is hit, `usdc_out_atomic` is null. Missing reads are not zero. An empty completed window is a real zero for that window only.

Deploy is the web app (Vercel). No gateway change. No Lightsail deploy.

Vercel request logs record the full URL, including `?address=` and `?sig=` on the Solana proxy. Application logs do not. Those platform logs are not scrubbed by this code. The proxy returns fixed error codes and does not log the upstream URL.

## Production settings

Set these before the first production deploy of this proxy. This repository does not deploy them.

- Vercel → Settings → Environment Variables → `HELIUS_API_KEY`. Type Sensitive. Scope Production only. Preview and Development stay empty so those deployments return 503 `not_configured`. Enable Require Separate Values if the team policy offers it. Do not use a `VITE_` or `NEXT_PUBLIC_` name. Do not put the value in `vercel.json` or in a committed env file. Use a new Helius key, not the anchoring `SOLANA_RPC_URL`.
- Helius has no method allowlist. The allowlist is the proxy code. A domain allowlist does not protect a server-side key. Vercel functions have no stable egress IP on this plan, so the boundary is key secrecy plus caps. Set a monthly credit cap and alerts at 50% and 80%.
- Vercel → Firewall → rate limit rule on `/api/solana-audit/*`, keyed by IP, 120 requests per minute, action 429. Hobby allows one rate-limit rule per project. The rule publishes without a redeploy. An env change needs a new deployment. Set the rule and the credit cap before that deployment.

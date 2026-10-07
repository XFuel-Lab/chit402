# Public spend audit

`/audit` on the web app. A visitor pastes a Base wallet and gets a report. No signup. The first report does not read the possession book.

## What it reads

- **Base USDC out.** `eth_getLogs` on `https://mainnet.base.org` for `Transfer` events from the wallet on Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. That is the same contract and the same public RPC the receipt payer check uses. The window is 302400 blocks (about 7 days at a 2-second block). The public RPC rejects a wider `eth_getLogs` span with HTTP 413 (`eth_getLogs is limited to a 500 range`), so the page walks the window in chunks of 500 blocks. A chunk that still returns 413, or another range-limit error, is halved down to a single block. Log reads run two at a time, with a short gap between starts. HTTP 429 backs off and pauses the rest of the scan so the public RPC is not asked for the whole window at once.
- **Public Chit receipt.** `GET /receipt/by-tx?tx=base:<hash>&format=json`. HTTP 404 means no public receipt for that transaction. A failed lookup is unavailable. It is not counted as unreceipted.

Incoming transfers are not spend and are not included.

## What the report shows

- USDC out per `payTo`. The documented fee sink `0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334` is labeled "Chit402 fee sink". The label is not proof the transfer was a protocol fee.
- **x402** when a public Chit receipt exists for the transaction, or the transaction calls USDC `transferWithAuthorization` (`0xe3ee160e`), the Base x402 exact path. A plain ERC-20 transfer with no receipt is **other**. If neither check ran, the row is **undetected**. Undetected is not folded into the other two.
- Unreceipted spend is the chain amount whose receipt lookup returned 404. The possession book can hold rows this page cannot see.
- Spikes: a positive transfer at least 5× the median, and only when the window has at least four positive transfers. Near-duplicates: same payee, same amount, different transaction, within 90 seconds (or 25 blocks when a timestamp is missing).
- CSV and JSON download. Schema `chit402.public_spend_audit.v1`. The CSV preamble repeats whether the total is complete.

## What it does not do

- **Solana** is not scanned. The page says so and shows no total.
- **Agent id.** `GET /v1/agents/:agent_id/book` without a session is possession-gated. The page reports that and does not invent a figure. Paste the Base wallet that paid.
- **Caps.** Daily and hourly caps stay on `GET /v1/agents/:agent_id/book/policy`. This page does not read them.
- **Incomplete scans.** If a block range fails, or the row cap (200) is hit, `usdc_out_atomic` is null. Missing ranges are not zero. An empty completed window is a real zero for that window only.

Deploy is the web app (Vercel). No gateway change. No Lightsail deploy.

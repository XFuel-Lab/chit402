# Pending finality

A Chit402 Base payment is booked when the transfer receipt is status 1 and the block number, hash, and timestamp have been read. The intake row is `pending_anchor` with `finality: pending`. The HTTP response is **202**, `Retry-After: 30`, and `pending_anchor`. It is not a 503 and it is not a 402 after the transfer has been seen.

The leaf is sealed only after the sealer RPCs that answer agree a finalized block `F` and the leaf's own block hash. An error or a disagreement seals nothing. That check runs at close, once per close. A committed set is not filtered again on recovery.

A Solana payment, while v13 issuance is on, keeps the legacy receipt. The response header is `x-chit402-receipt-track: legacy-solana`. The same payment can be resent. `GET /receipt/{pending_id}` returns the state to anyone and the receipt body only to the original payment header.

Code: `services/gateway/src/v13-issue.js` (book at status 1), `services/gateway/src/openai-gateway.js` (`v13PaidHookFailure`, `isBaseHousePayment`), `services/chit-sealer/close.js` (`sealCandidates`), `services/chit-sealer/rpc-base.js` (`agreeCloseFinality`).

# XFuel — Pitch Deck Outline

Convert each section into a slide. Keep claims aligned with [docs/POSITIONING.md](docs/POSITIONING.md) and [WHITEPAPER.md](WHITEPAPER.md).

## 1. Title

XFuel Protocol  
The book. This agent spent Y on this job. You hold hub, model, and amount.

## 2. Problem

Agents buy inference with API keys and opaque invoices. No shared receipt. No cryptographic settlement trail. Providers are siloed.

## 3. Solution

XFuel is the book: this agent spent Y on this job. You hold hub, model, and amount.  
Pay USDC via x402 on Base and Solana. Signed receipt is table stakes; on-chain SP1 proof on demand.

## 4. How it works

Agent submits task → you hold hub, model, and amount → USDC settles on Base or Solana → signed receipt (table stakes) or SP1 proof on `ZKVerifierSP1` (Tier 2)

## 5. Trust tiers

1. Signed receipt — live, default  
2. SP1 settlement proof — live, on demand  
3. Verified Inference (zkLLM) — active build  

Tier 2 proves settlement, not black-box model execution.

## 6. Product surfaces

- OpenAI-compatible `/v1`
- M2M REST API
- MCP server
- TypeScript SDK

## 7. Revenue

Token-light: USDC fees to protocol Safe / Splits v2 on Base. Downstream policy set by governance. No fixed per-fee staker yield.

## 8. Traction / status

- `ZKVerifierSP1` live on Base mainnet
- Public gateway: api.xfuel.app
- Tier 1 + Tier 2 live; x402 on Base mainnet
- SDK + MCP published

Details: [docs/RUNTIME_STATE.md](docs/RUNTIME_STATE.md)

## 9. Moat

Settlement + payments + tiered proof on Base, provider-agnostic routing, self-owned Verified Inference prover (build).

## 10. Ask

Equity-first raise (SAFE + token warrant). See [docs/FUNDRAISING_STRUCTURE.md](docs/FUNDRAISING_STRUCTURE.md).

## 11. Links

https://xfuel.app · https://github.com/XFuel-Lab/xfuel-protocol · WHITEPAPER.md

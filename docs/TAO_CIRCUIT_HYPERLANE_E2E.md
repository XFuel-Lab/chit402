# TAO Circuit / Hyperlane E2E

Optional cross-chain proof relay to Bittensor EVM. Settlement home remains Base ([ADR 0002](./adr/0002-base-settlement-home.md)).

Whitepaper: §3.2, §8. Testnet-first — do not reuse testnet domain IDs on mainnet.

## Domains

| Env | Network | Chain ID | Hyperlane domain |
|-----|---------|----------|------------------|
| Testnet | Bittensor | 945 | 945 |
| Mainnet | Bittensor | 964 | 964 |
| (archive) Theta testnet | 365 | 365 | optional provider-side origin |
| (archive) Theta mainnet | 361 | 361 | optional provider-side origin |

## Flow (conceptual)

1. Verify SP1 proof on Base (or origin verifier)
2. `relayProofCrossChain` via Hyperlane to Bittensor domain
3. Destination: stake-gated verify (`verifyWithStakeCheck`) on TAO circuit

## Ops

- Install Hyperlane CLI; deploy/wire mailboxes per network docs
- Env: RPCs + mailbox / ISP / recipient addresses from deploy manifests
- Never run Hardhat fixtures against live Theta RPC

Related: [DEPLOYMENT.md](./DEPLOYMENT.md), `contracts/circuits/` TAO module, [AGENTS.md](../AGENTS.md).

# Legacy contracts

Retired Solidity kept for historical deploy ABIs, Hardhat tests, and archive scripts.

**Do not deploy these as go-forward settlement.** Money + proof home is Base (USDC/x402, `ZKVerifierSP1`) — see [ADR 0002](../../docs/adr/0002-base-settlement-home.md) and [ADR 0001](../../docs/adr/0001-usdc-revenue-and-router-verifier-positioning.md).

| Path | Contents |
|------|----------|
| `contracts/legacy/*.sol` | Older core/router/splitter/treasury experiments |
| `contracts/legacy/circuits/` | Retired sale / engagement circuits (Believer, Angel, etc.) |

Active provider / routing circuits remain under `contracts/circuits/`. Hardhat `paths.sources` is `./contracts`, so both trees still compile.

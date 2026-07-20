# Archived Cypress E2E

Legacy browser specs for retired product surfaces. Not part of the current narrative (Base settlement, USDC/x402, tiered proofs). Do not run in CI.

| Spec | Why archived |
|------|----------------|
| `e2e/ai-depin-e2e.cy.ts` | TaskSimulator UI + CoreRevenueSplitter-style 30/30/25/15 fee preview; multi-chain settlement targets (Theta/Cosmos) |
| `e2e/zk-bridge-e2e.cy.ts` | Theta ZK bridge / TFUEL vault / LST swap flow |
| `e2e/swap.cy.ts` | Manual TFUEL deposit UX |
| `e2e/mainnet-beta.cy.ts` | TFUEL mainnet-beta swap limits + Theta RPC pause checks |
| `e2e/theta-wallet-qr.cy.ts` | Theta Wallet QR / WalletConnect connect modal |
| `e2e/wallet-integration.cy.ts` | Theta + Keplr Cosmos LST (stkATOM/stkTIA/stkXPRT) flows |

## Support harness — kept (not archived)

`cypress/support/` is **not** legacy. Both files are stock Cypress bootstrap with empty command stubs:

| File | Decision | Rationale |
|------|----------|-----------|
| `cypress/support/e2e.ts` | **KEEP** | Standard Cypress `supportFile` entry: imports `./commands`, empty `Chainable` ambient. Needed so Cypress boots when new specs land under `cypress/e2e/`. |
| `cypress/support/commands.ts` | **KEEP** | Thin custom-commands placeholder only — no Theta Wallet, Keplr, TFUEL, or chain-specific helpers. |

Theta / Keplr / TFUEL behavior lived **inline in the archived specs** (mocks, intercepts, selectors), not in shared support helpers. There was nothing to move into `cypress/_archive/support/`.

New e2e specs for the current web app belong in `cypress/e2e/` (placeholder: `.gitkeep`). Add Base/x402 helpers to `cypress/support/commands.ts` when needed.

To run the archived suite locally (not CI):

```bash
npx cypress run --config "specPattern=cypress/_archive/e2e/**/*.cy.ts"
```

Note: there is no active root `cypress.config.*` in this repo; Cypress defaults apply (`supportFile` → `cypress/support/e2e.{js,ts}`).

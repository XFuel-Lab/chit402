# Legacy deploy scripts (Theta-era)

Historical Hardhat deployers for CoreRevenueSplitter, BelieverRound, full circuit stacks, and Theta/Bittensor manifests.

**Not the go-forward path.** Money + proofs = Base ([ADR 0002](../../docs/adr/0002-base-settlement-home.md)).

## Manifest split

| Location | Keep |
|----------|------|
| [`../manifests/`](../manifests/) | Go-forward Base only — e.g. `base-verifier-base-*.json`, future Base VI (`model-registry`, provider staking) |
| [`manifests/`](./manifests/) | Historical Theta / Believer / activation / phase / Hyperlane / Hardhat dry-runs |

Do **not** put new Base manifests under `deploy/legacy/manifests/`.

## Go-forward (use these)

| Script | Purpose |
|--------|---------|
| `../base-verifier.cjs` | `ZKVerifierSP1` on Base |
| `../model-registry.cjs` | PoMA registry |
| `../provider-staking.cjs` | Verified Inference staking |
| `../erc8004-adapter.cjs` | ERC-8004 adapter |
| `../register-model.cjs` | Register a model commitment |
| `../ecs/` | SP1 prover AWS task |
| `../manifests/base-verifier-*.json` | Live Base verifier manifest |

Live addresses: [docs/RUNTIME_STATE.md](../../docs/RUNTIME_STATE.md).  
Canonical deploy docs: [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

## What’s here

| Path | Notes |
|------|--------|
| `mainnet.cjs` / `testnet.cjs` / `full.cjs` | Theta full-stack + BelieverRound |
| `deploy-core.cjs` / `deploy-circuits.cjs` / `deploy-full.cjs` | CoreRevenueSplitter-era core |
| `priority-circuits.cjs` / `theta-inference.cjs` / `bittensor-evm.cjs` | Circuit / cross-chain experiments |
| `manifests/` | Moved from `deploy/manifests/` — see inventory below |

Legacy scripts write new JSON under `deploy/legacy/manifests/` (not `deploy/manifests/`).

### `manifests/` inventory

| File | Kind |
|------|------|
| `mainnet-*.json` / `mainnet-activation-*.json` | Theta mainnet + activation |
| `testnet-*.json` / `testnet-progress.json` | Theta testnet + resume |
| `activation-*.json` / `launch-*.json` | Round / activation launches |
| `phase6-*.json` | Full-stack phase6 dry-run |
| `deploy-theta-inference-*.json` | ThetaInferenceCircuit deploys |
| `hyperlane.json` | Hyperlane mailbox experiment |

If you still need to run a legacy script:

```bash
npx hardhat run deploy/legacy/mainnet.cjs --network hardhat
```

Verify historical manifests:

```bash
npm run verify:testnet   # Theta testnet manifest under deploy/legacy/manifests/
npm run verify:mainnet   # Theta mainnet manifest (historical)
npm run verify:base      # go-forward Base verifier
```

# ChitAnchor Sepolia deploy pack

The owner runs the deploy. This pack does not broadcast, and it holds no key and no RPC secret.

- Contract: `contracts/chit-simple/ChitAnchor.sol`
- Chain: Base Sepolia, chain id 84532 (`base-sepolia` in `hardhat.config.cjs`)
- Constructor: one argument, the checkpoint address (`constructor-args.json`)
- Runtime code hash: `expected-runtime.json`

The runtime bytecode embeds the domain immutable (`chainId` and the contract address), so the hash changes if the deployer, nonce, checkpoint, or chain changes. The checked-in hash is the example in that file (deployer `0x1111…1111`, nonce 0, checkpoint `0x2222…2222`). `test_example_runtime_code_hash` recomputes it.

From this directory, after `CHIT_ANCHOR_CHECKPOINT` is set:

```
forge script DeployChitAnchor.s.sol:DeployChitAnchor --rpc-url <base-sepolia-rpc> --private-key <testnet-key> --broadcast
```

Omit `--broadcast` for a simulation. The script reverts unless the chain id is 84532. Gas for `anchor` is in `gas-snapshot.txt`, from `forge snapshot` in `test/chit-simple`. The repo-level `scripts/gas-snapshot.cjs` baselines other contracts and is unchanged.

# ChitAnchor Sepolia deploy

The owner runs these steps. This pack does not broadcast. It holds no key and no RPC secret.

The script compiles `contracts/chit-simple/ChitAnchor.sol` and `Rfc9162.sol` from this repo. Leave those files where they are. The pack does not copy them.

Chain: Base Sepolia, chain id 84532. Constructor argument: the checkpoint address, in `constructor-args.json`.

The runtime bytecode embeds the domain, so the code hash depends on the chain id and the deployed address. `expected-runtime.json` is the check for one example (deployer `0x1111111111111111111111111111111111111111`, nonce 0, checkpoint `0x2222222222222222222222222222222222222222`). `test_example_runtime_code_hash` in `test/chit-simple` recomputes that example. Before a real deploy, recompute the hash for the real deployer, nonce, and checkpoint, and compare it to the bytecode you are about to send.

1. Install Foundry. `forge` must be on `PATH`.
2. From `test/chit-simple`, check the reviewed bytecode hash:

```
forge test --match-test test_example_runtime_code_hash --offline
```

That test must pass. It checks `expected-runtime.json` against `contracts/chit-simple/ChitAnchor.sol`.
3. Open a shell at `deploy/chit-simple/sepolia-pack`.
4. Set `CHIT_ANCHOR_CHECKPOINT` to the checkpoint address. Do not put a key in the environment for this step.
5. Simulate against a Base Sepolia RPC. This does not send a transaction:

```
forge script DeployChitAnchor.s.sol:DeployChitAnchor --rpc-url <base-sepolia-rpc>
```

The script reverts if the chain id is not 84532.
6. For a real deployer and checkpoint, recompute the runtime code hash the same way the example test does, and stop if it is not the bytecode you intend to send. The example hash applies only to the deployer, nonce, and checkpoint in `expected-runtime.json`.
7. Broadcast with the owner's testnet key only in that command:

```
forge script DeployChitAnchor.s.sol:DeployChitAnchor --rpc-url <base-sepolia-rpc> --private-key <the owner's key> --broadcast
```

8. After the transaction, hash the deployed runtime code and compare:

```
cast keccak $(cast code <deployed-address> --rpc-url <base-sepolia-rpc>)
```

Stop if it differs from the hash computed for that deployer and checkpoint. Gas for `anchor` is in `gas-snapshot.txt`.

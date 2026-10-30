# ChitAnchor on Base Sepolia

The owner runs these steps. This pack does not broadcast. It holds no key and no RPC secret. Use a dedicated testnet deployer key, stored in an encrypted Foundry keystore or on a hardware wallet.

The script compiles `contracts/chit-simple/ChitAnchor.sol` and `Rfc9162.sol` in this repo. Leave those files where they are.

Chain: Base Sepolia, chain id 84532. Constructor argument: the checkpoint address, in `constructor-args.json`.

In v0 on Base Sepolia, `rotateCheckpointKey` is authorized by the checkpoint key alone, so a rotation is not a trust event. The 2-of-3 secp256k1 controller path (SIMPLE §S6) is required before any mainnet deploy.

The runtime code hash does not depend on the checkout path. It does depend on the chain id and the deployed address, because the domain is part of the bytecode. `expected-runtime.json` is the check for one example: deployer `0x1111111111111111111111111111111111111111`, nonce 0, checkpoint `0x2222222222222222222222222222222222222222`.

1. Install Foundry. `forge` and `node` must be on `PATH`.
2. From `test/chit-simple`, prepare the vector file and check the hash:

```
sh pretest.sh
forge test --match-test test_example_runtime_code_hash --offline
```

The test must pass. It checks `expected-runtime.json` and the pack build against `contracts/chit-simple/ChitAnchor.sol`.
3. Open a shell at `deploy/chit-simple/sepolia-pack`.
4. Print the address and code hash for the deployer, nonce, and checkpoint you will use. This does not broadcast:

```
node print-runtime.mjs <deployer> <nonce> <checkpoint>
```

5. Set `CHIT_ANCHOR_CHECKPOINT` to the checkpoint address.
6. Simulate against a Base Sepolia RPC. This does not send a transaction. The script reverts if the chain id is not 84532:

```
forge script DeployChitAnchor.s.sol:DeployChitAnchor --rpc-url <base-sepolia-rpc>
```

7. Import the dedicated testnet deployer key into an encrypted Foundry keystore (`cast wallet import <name> --interactive`), or use a hardware wallet.
8. Broadcast with that account:

```
forge script DeployChitAnchor.s.sol:DeployChitAnchor --rpc-url <base-sepolia-rpc> --account <name> --broadcast
```

A hardware wallet uses `--ledger` in place of `--account <name>`.
9. After the transaction, hash the deployed runtime code and compare it to step 4:

```
cast keccak $(cast code <deployed-address> --rpc-url <base-sepolia-rpc>)
```

Stop if it differs. Gas for `anchor` is in `gas-snapshot.txt`.

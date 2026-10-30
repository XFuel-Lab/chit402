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
6. Simulate against a Base Sepolia RPC. Pass the deployer address with `--sender` so the simulated address matches the later transaction. This does not send a transaction. The script reverts if the chain id is not 84532:

```
forge script DeployChitAnchor.s.sol:DeployChitAnchor --rpc-url <base-sepolia-rpc> --sender <deployer-address>
```

7. Import the dedicated testnet deployer key into an encrypted Foundry keystore at the prompt (`cast wallet import <name>`), or use a hardware wallet. The import takes no key on the command line.
8. Broadcast with that account:

```
forge script DeployChitAnchor.s.sol:DeployChitAnchor --rpc-url <base-sepolia-rpc> --account <name> --broadcast
```

A hardware wallet uses `--ledger` in place of `--account <name>`.
9. Check the deployment. This is read-only. Set `BASE_SEPOLIA_RPC_URL`, `CHIT_ANCHOR_CHECKPOINT` to the address you intended, and `CHIT_ANCHOR_TX` to the deploy transaction. Set `CHIT_ANCHOR_DEPLOYER` and `CHIT_ANCHOR_NONCE` when they are not the pinned example. Then:

```
node check-deploy.mjs <deployed-address>
```

The command exits nonzero unless `checkpoint()` is that address, `checkpointVersion()` is 1, the code hash matches, and the single rotation event is the genesis event (version 1, old address zero, new address the checkpoint). Stop on any mismatch.
10. Verify the source on chain 84532. Run this from `deploy/chit-simple/sepolia-pack`. `--root .` selects this directory's Foundry profile: solc 0.8.24, Cancun, via IR, optimizer 200, `bytecode_hash` none, CBOR metadata off. Put the explorer API key in `ETHERSCAN_API_KEY` or in a gitignored Foundry config. Do not pass `--etherscan-api-key` or any other key flag on the command line.

```
forge verify-contract --root . --chain 84532 --compiler-version 0.8.24 --optimizer-runs 200 --via-ir --evm-version cancun --constructor-args "$(cast abi-encode "constructor(address)" "$CHIT_ANCHOR_CHECKPOINT")" --watch <deployed-address> ../../../contracts/chit-simple/ChitAnchor.sol:ChitAnchor
```

STOP unless the match is exact. Gas for `anchor` is in `gas-snapshot.txt`.

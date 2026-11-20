# ChitAnchor on Base Sepolia

The owner runs these steps. This pack does not broadcast. It holds no key and no RPC secret. Use a dedicated testnet deployer key, stored in an encrypted Foundry keystore or on a hardware wallet.

The script compiles `contracts/chit-simple/ChitAnchor.sol` and `Rfc9162.sol` in this repo. Leave those files where they are.

Chain: Base Sepolia, chain id 84532. Constructor arguments: the checkpoint address and the controller address, in `constructor-args.json`.

Each epoch is one write-once `heads[epoch]`. `latest()` reads `heads[latestEpoch]`. `executePending` does not write `heads`. The controller is a Safe proxy. Its singleton is SafeL2 1.4.1 (`0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`), the threshold is 2, and there are 3 owners. It has no modules, the guard slot is zero, and the fallback handler is the pinned Safe v1.4.1 handler. The owner creates that Sepolia Safe outside this repo. This pack holds no key. Every Chit402 key change waits 24 hours. Losing 2 of the 3 controller keys means a successor contract. A third party, including the checkpoint key, cannot change a key. Nothing in this pack is a mainnet step.

The runtime code hash does not depend on the checkout path or on the constructor addresses. It does depend on the chain id and the deployed address, because the domain is part of the bytecode. `expected-runtime.json` is the check for one example: deployer `0x1111111111111111111111111111111111111111`, nonce 0, checkpoint `0x2222222222222222222222222222222222222222`, preview controller `0x4444444444444444444444444444444444444444`.

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

5. Set `CHIT_ANCHOR_CHECKPOINT` to the checkpoint address and `CHIT_ANCHOR_CONTROLLER` to the Safe.
6. Simulate against a Base Sepolia RPC. Pass the deployer address with `--sender` so the simulated address matches the later transaction. This does not send a transaction. The script reverts if the chain id is not 84532:

```
forge script DeployChitAnchor.s.sol:DeployChitAnchor --rpc-url <base-sepolia-rpc> --sender <deployer-address>
```

7. Import the dedicated testnet deployer key into an encrypted Foundry keystore. Never use --private-key. That flag puts the key on the command line and in shell history. The import uses a hidden prompt and writes an encrypted keystore:

```
cast wallet import <name> --interactive
```

A hardware wallet is the other path.
8. Broadcast with that account:

```
forge script DeployChitAnchor.s.sol:DeployChitAnchor --rpc-url <base-sepolia-rpc> --account <name> --broadcast
```

A hardware wallet uses `--ledger` in place of `--account <name>`.
9. Check the deployment. This is read-only. Set `BASE_SEPOLIA_RPC_URL`, `CHIT_ANCHOR_CHECKPOINT` to the checkpoint you intended, `CHIT_ANCHOR_CONTROLLER` to the Safe, and `CHIT_ANCHOR_TX` to the deploy transaction. Set `CHIT_ANCHOR_DEPLOYER` and `CHIT_ANCHOR_NONCE` when they are not the pinned example. Then:

```
node check-deploy.mjs <deployed-address>
```

The script reads `BASE_SEPOLIA_RPC_URL` and passes it to `cast` as `ETH_RPC_URL`. It does not put the URL on the command line. The command exits nonzero unless the receipt succeeded and its contract address is the deployed address, `checkpoint()` is the checkpoint you set, `controller()` is the controller you set, `checkpointVersion()` is 1, the code hash matches, the single rotation event emitted by that contract is the genesis event (version 1, old address zero, new address the checkpoint), and the controller's code is the Safe proxy whose singleton is the pinned SafeL2 1.4.1, with threshold 2 and 3 owners. An EOA, a different threshold, a different owner count, or an unpinned singleton is rejected. Stop on any mismatch. The offline test of that Safe check reads fixture JSON and does not call an RPC.
10. Verify the source on chain 84532. Run this from `deploy/chit-simple/sepolia-pack`. `--root .` selects this directory's Foundry profile: solc 0.8.24, Cancun, via IR, optimizer 200, `bytecode_hash` none, CBOR metadata off. Read the explorer API key with a hidden prompt. The key stays in the environment. It never goes in argv, and it never goes in the tracked `foundry.toml`. Do not pass `--etherscan-api-key` or any other key flag on the command line.

```
read -rs ETHERSCAN_API_KEY; export ETHERSCAN_API_KEY
forge verify-contract --root . --chain 84532 --compiler-version 0.8.24 --optimizer-runs 200 --via-ir --evm-version cancun --constructor-args "$(cast abi-encode "constructor(address,address)" "$CHIT_ANCHOR_CHECKPOINT" "$CHIT_ANCHOR_CONTROLLER")" --watch <deployed-address> ../../../contracts/chit-simple/ChitAnchor.sol:ChitAnchor
unset ETHERSCAN_API_KEY
```

STOP unless the match is exact. Gas for `anchor` is in `gas-snapshot.txt`.

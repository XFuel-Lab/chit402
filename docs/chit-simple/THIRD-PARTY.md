# Repeat the local Chit Simple loop

This is one page. The run uses a local chain and testnet dummy data. It does not send a Sepolia transaction and it does not use a live key.

## What you need

Node from `.nvmrc` (24). The package engines accept Node 20 or newer. This tree was exercised on Node 22.

Hardhat is the local chain. `anvil` is not required. The repo's Hardhat network stays chain id 1337. The run writes a temporary config that sets the in-process Hardhat chain id to 84532, which is the chain id already pinned for Base Sepolia USDC. The mock USDC bytecode is then installed at that pinned token address. No USDC map entry is added.

The signer and the payer are the public Hardhat development accounts. They are development keys, not secrets. They stay inside `e2e/chit-simple`.

## Setup

Clone this repository at a commit. From the repository root, and again in `packages/verify`:

```
npm ci
```

Build the verifier:

```
npm run build --prefix packages/verify
```

## The local loop

```
node e2e/chit-simple/run.mjs
```

Exit 0 is a pass. The process prints one JSON line. `exit` is 0 and `message` is `PAYMENT PROVEN`. The label is `local`.

The script starts Hardhat on `127.0.0.1:18545` and two proxies on `127.0.0.1:18546` and `127.0.0.1:18547`. The verifier is given the two proxy URLs. `localhost` and `127.0.0.1` are the same URL to the verifier, so the ports are what make the two RPCs distinct. One RPC returns exit 2 `rpc_unconfigured`.

The run imports `checkReceiptInput` with the verifier's existing `TEST_SNAPSHOT` symbol. There is no CLI flag and no production pin is added.

Hardhat 2.19 answered `eth_getBlockByNumber` of `finalized` with a block on this local chain, so the run did not substitute a finality tag. Both proxies rewrite a Hardhat `eth_call` error so the message contains `execution reverted`. The verifier already treats those words as a revert, and a revert of the v0 getters is not a failure.

## The tamper matrix

```
node --test --test-concurrency=1 e2e/chit-simple/test/chain.test.mjs
```

That command also anchors 24 consecutive hours, including empty hours, and forces one `HourNotFinished` revert. It writes `e2e/chit-simple/tamper-matrix.json`. Every tamper row has a non-zero `exit`. `T17` is HTTP 202: the proof stays unreleased.

## Sepolia

```
node e2e/chit-simple/sepolia-dry-run.mjs
```

This builds the anchor transaction, prints it, prints `needs_owner_tap`, and exits 2. It does not send, even if the environment already holds an address. A live Base Sepolia run still needs, from the owner: the deployed `CHITANCHOR_ADDRESS`, a testnet KMS key ARN (`ECC_SECG_P256K1`, a separate account), a funded payer, and two RPC URLs.

## What a pass proves

A pass shows that this machine can pay, seal a core line, anchor through `ChitAnchor`, and read the book back to verifier exit 0. That is the pipeline. It does not prove sigma independence, the book rules, or an independent audit.

The anchor contract is unaudited.

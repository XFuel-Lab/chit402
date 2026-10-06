# Receipt log witness

A root on a chain is an anchor. It becomes a witnessed head only when a party other than us accepts the step from the previous head.

That party, in this design, is the `ChitLogWitness` contract. It stores one head: epoch, tree size, and root. `append` checks an RFC 6962 consistency proof from that stored head and reverts if the proof fails or the tree shrinks. The gateway's own signature is not that check.

This contract is in the repository. It is not deployed. The gateway does not call it unless `RECEIPT_LOG_WITNESS=1`. That variable is off unless it is exactly `1`. No mainnet transaction has been sent for it. A Base mainnet deploy happens only with Christopher's signature through the Safe.

## What is witnessed

When the flag is on and `CHIT_LOG_WITNESS_ADDRESS` is set:

- The daily anchor calls `append(newSize, newRoot, proof)` with an RFC 6962 consistency proof from the head the contract already stores.
- The zero-value self-transfer whose calldata is the bare 32-byte root still goes out. That transfer is an extra witness. It does not carry the tree size, and a stranger cannot check one bare root against the next from the calldata alone.
- At boot the gateway reads the contract head. It refuses to start unless the open journal is the same epoch and an RFC 6962 extension of that head (the same size and root, or a larger size whose proof verifies). A missing address or a failed read also refuses, with `witness_unconfigured` or `witness_rpc`.
- `xfuel-verify receipt.json inclusion.json head.json --rpc --witness 0x…` reads `head()` on that address. The same size must be the same root. A larger head needs `--consistency` set to the RFC proof from the contract size to the signed head. With no address, the command says the contract was not checked. It does not treat a missing address as a pass of the witness.

The appender is a separate key from the Safe and from the bare-root anchor key. Boot refuses `witness_same_key` when those two addresses are the same. The appender can append. It cannot open an epoch, and it cannot change the owner or the appender. The Safe is the owner.

A witness transaction is `broadcast` until a mined receipt succeeds and `head()` on the contract equals that size and root. Only then is it `witnessed`, and only then does the signed head include it. A reverted transaction is `reverted` and is not a signed claim. The daily retry looks at that witness side as well as Base and Solana.

The constructor accepts only epoch 1, size 4, root `dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973`. Any other genesis reverts. `xfuel-verify --rpc --witness` also checks the runtime code hash of this build (`0xdb6c644296d0fd4ca867c38fc4fc9c2fd20ca19b4b8ed69b2701c32c9c79e63a`, solc 0.8.24, optimizer 200). A different contract at that address is not a witness.

Events `HeadAppended` and `EpochDeclared` carry the size and the root. A reader with the leaves can rebuild the consistency proof and compare it to the sequence of heads on the chain. The event does not contain the proof nodes.

## What a reset looks like

A new epoch is `declareEpoch`. Only the owner can call it. The call must name the head the contract currently stores (`finalPrevSize`, `finalPrevRoot`). It then stores the new epoch's opening size and root, and it emits `EpochDeclared`.

The Oct 5 reset would not get through `append`. The contract held epoch 1 at size 4, root `dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973`. A size-1 root with a previous root of zeros is a shrink, and it does not name the stored head. `append` reverts. `declareEpoch` with a previous size of 0 also reverts.

Epoch 2 is accepted only as that Safe call, and only at the pinned opening: size 1, root `f2043ee96b6e9f678b76bb3c512b5d911293dbb2a3bf198c98252c83802f3286`, previous head exactly the epoch 1 final above. That is the same pin as the receipt log. The Sepolia deploy script starts the contract at the epoch 1 final and preflights this `declareEpoch`. It does not broadcast in this change.

`RECEIPT_LOG_ACCEPT_FRESH_GENESIS` does not bypass the witness check. A fresh log is not an extension of the contract head.

A rollback before the day's `append` is still possible. The contract sees the log when the appender sends the proof, which is the daily anchor, not every receipt. Base's sequencer and finality are still trust assumptions.

## Checkpoints

`GET /v1/receipts/tree/checkpoint` is a C2SP signed note next to `GET /v1/receipts/tree/head`. The note is text. It is not a field inside the tree-head JWS.

The origin is `chit402.com/receipt-log/<epoch>`. One origin per epoch, because a reset is not a consistency proof, and a log must not sign two inconsistent checkpoints for the same origin. The signature key name matches that origin. The issuer ES256 key signs the note (signed-note type `0x02`: key id is the first four bytes of SHA-256 of the SPKI DER, then an ASN.1 ECDSA signature).

The body is four lines:

1. origin
2. tree size, decimal, no leading zeros
3. root, standard base64
4. one extension line. Epoch 1 is `epoch 1 0`. Epoch 2 and later require a non-zero previous size and a non-zero previous root, or the signer throws.

A client that ignores extension lines still sees an append-only log inside that origin.

## How to check it yourself

On a process running this build, consistency defaults to RFC 6962:

```bash
curl -sS "http://127.0.0.1:3002/v1/receipts/tree/consistency?first=1&second=2"
curl -sS "http://127.0.0.1:3002/v1/receipts/tree/consistency?first=1&second=2&format=legacy"
curl -sS "http://127.0.0.1:3002/v1/receipts/tree/checkpoint"
```

`format=legacy` is the previous proof, which includes the old root. The checkpoint route is 404 until a head has been signed. `https://api.chit402.com` serves the previous consistency proof until this build is deployed there. It does not serve the checkpoint note yet. This repository does not deploy it.

After a witness address exists, the offline verifier can read it. Until then, omit `--witness`. The command will say the contract was not checked.

```bash
npx xfuel-verify receipt.json inclusion.json head.json --rpc --witness "$CHIT_LOG_WITNESS_ADDRESS" --consistency proof.json
```

`proof.json` is the `chit402.consistency.v2` body for `first` equal to the contract size and `second` equal to the signed head's size.

On a chain where the contract is deployed, `head()` returns `(epoch, size, root)`. `accepts(newSize, newRoot, proof)` is a view. It does not store the head. `append` does, and only the appender can call it.

## What Christopher would sign on Sepolia

The script is `script/DeployChitLogWitness.s.sol`. It refuses every chain except Base Sepolia (chain id 84532), including Base mainnet (8453). Running it without `--broadcast` simulates. This change does not broadcast.

The deployer key (`SEPOLIA_THROWAWAY_PK`) pays for the contract creation and for the Safe `execTransaction` that calls `declareEpoch`. The Safe (`CHIT_LOG_WITNESS_OWNER`) must already be a 2-of-3, and two of its owners (`SEPOLIA_SAFE_OWNER_PK_1`, `SEPOLIA_SAFE_OWNER_PK_2`) sign that inner call. The appender (`CHIT_LOG_WITNESS_APPENDER`) is the gateway key that will later call `append`. It needs Sepolia ETH only when the flag is turned on and it sends. The deploy itself does not spend from the appender.

Before broadcast, the script eth_calls `declareEpoch` against a throwaway copy and rolls that state back. A revert aborts the script. There is no timestamp delay on this contract. The cushion is gas, 20% (`GAS_CUSHION_BPS` = 2000).

`forge test --gas-report` on this commit (solc 0.8.24, optimizer 200) put `append` at a median of about 31,500 gas. The maximum moved between runs as the fuzzer did, in a band of about 54,000 to 56,000. `declareEpoch` stayed at a maximum of 42,616 and a median of about 24,800. The script budgets 60,000 gas for an append and 50,000 for `declareEpoch`. The 20% cushion on those budgets is 72,000 and 60,000. Those numbers are the contract functions. They do not include contract creation or the Safe `execTransaction` wrapper. This is not a mainnet quote.

The initial head the script deploys is epoch 1, size 4, root `dd20e39a…`. The Safe call opens epoch 2 at size 1, root `f2043ee9…`. Leaving the flag off leaves production on the bare-root anchor it has today.

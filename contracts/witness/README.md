# ChitLogWitness

Base witness for the receipt log. `append` checks an RFC 6962 consistency proof. `declareEpoch` is the owner Safe only. The appender cannot open an epoch or change roles.

Not deployed. The script refuses every chain except Base Sepolia (84532). Do not pass `--broadcast` until Christopher funds the deployer and signs. This directory does not broadcast, and it does not configure a mainnet RPC.

```bash
forge test --match-contract ChitLogWitness -vv
forge script script/DeployChitLogWitness.s.sol --rpc-url https://sepolia.base.org
```

The second command simulates. It sends only with `--broadcast`, which is Christopher's step, not part of this change.

Env, in the shell only: `SEPOLIA_THROWAWAY_PK`, `SEPOLIA_SAFE_OWNER_PK_1`, `SEPOLIA_SAFE_OWNER_PK_2`, `CHIT_LOG_WITNESS_OWNER` (the Safe), `CHIT_LOG_WITNESS_APPENDER`. The Safe must already be 2-of-3. This repo does not deploy that Safe and does not hold a signer key.

The deployer pays contract-creation gas and the gas for the Safe `execTransaction` that opens epoch 2. The appender needs Sepolia ETH only later, when `RECEIPT_LOG_WITNESS=1` and it sends `append`. The script's preflight eth_calls `declareEpoch`, then eth_calls `register` with an in-process proof of possession, and rolls both back. The simulated registration is not part of the broadcast. There is no time cushion. The gas cushion is 20%.

`forge test --gas-report` on this commit (solc 0.8.24, optimizer 200) put `append` at a median of about 31,500 gas, with a fuzzer maximum in a band of about 54,000 to 56,000. `declareEpoch` maximum was 42,616. The script budgets 60,000 and 50,000 for those two calls. With the 20% cushion that is 72,000 gas per append and 60,000 for the epoch call. Contract creation and the Safe wrapper are on top of that. Those figures are not a mainnet quote.

The constructor reverts unless the genesis is epoch 1, size 4, root `dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973`. The Safe call opens epoch 2 at size 1, root `f2043ee96b6e9f678b76bb3c512b5d911293dbb2a3bf198c98252c83802f3286`. The runtime code hash is `0xde755e00…` and the creation bytecode hash is `0x5fa3f199…` (8,769 bytes). A matching runtime hash is not enough: the creation transaction input must be that init code plus the epoch-1 constructor args. `CHIT_LOG_WITNESS_ADDRESS` and `CHIT_LOG_WITNESS_CREATION_TX` are empty until that deploy.

`register` stores a witness URL only when `key` signs that URL, bound to `chainId` and this contract (`registry`). A missing signature is refused. A null key is not discoverable and does not count toward `quorum`. A URL on `chit402.com` or any subdomain, including `/.well-known/` on that host, is not an independent custodian. Neither is a registration whose `operator` is the owner or the appender. A second URL is a new registration. It does not inherit the first row.

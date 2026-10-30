# EquivocationEscrowV0 mainnet gates

Copy this list into the deploy pack. Every item below is MUST before any mainnet bond.
Testnet V0 on Base Sepolia (chainId 84532) does not do these. V0 keeps the four-field
per-log domains, with the escrow address in neither one, so the contract matches the
production gateway signer and `packages/verify` as they are today. The testnet rules
(one canonical address, the redeploy quarantine list, heads per log, and the 10–20
test USDC bounty limit) are in [README.md](./README.md).

Re-pin the deploy pack TARGET to the merge commit after merge. The pin is that
merge commit, written into the pack after merge. This repository leaves the pin
for the pack.

## MUST

- [ ] **Refund domain names the escrow, in one release with the signer (b2).**
  `Chit402ReceiptBinding` includes `address verifyingContract` set to that escrow.
  The production gateway binding signer and `packages/verify` ship in the same
  release. The gateway signs the four-field domain today; the escrow accepts a
  binding only when that signature matches the domain it computes. Bindings
  appended before that release are outside the new domain. A later redeploy
  orphans bindings signed for the previous address.

- [ ] **KMS `Sign` is the production gateway role only.**
  The key policy allows `Sign` on the production issuer key from the production
  gateway role alone. A second process that holds the production key and a copy
  of the production log can sign a different root at an already-signed
  `(epoch, tree_size)`. That signature is a real equivocation, and it stays
  provable at every escrow that pins this domain.

- [ ] **No restore of the log in an open epoch.**
  `fixed-heads.jsonl` and the receipt log directory stay at their current state
  while an epoch is open. After any restore, close that epoch and start a new
  one before signing again. A restored log can sign a second root at an
  already-signed `(epoch, tree_size)` with the production key.

- [ ] **The deploy script checks that the log salt is the production salt.**
  Add the check before any mainnet deploy: `ESCROW_LOG_SALT` equals the
  production log id, `EXPECTED_LOG_SALT` in `services/gateway/src/eip712-p256.js`.
  A deploy that pins the production key uses that salt.

- [ ] **A new domain version, or a new issuer key.**
  A mainnet escrow uses a new domain version (for example `Chit402TreeHead` and
  `Chit402ReceiptBinding` version `2`, with chainId 8453) or a distinct issuer
  key. The testnet domain is version `1` with chainId 84532. The production
  gateway hard-codes chainId 84532 for every head and binding it signs today,
  so a mainnet bond on that domain bonds the testnet log.

- [ ] **Publish the canonical escrow address in a signed document after deploy.**
  One address. Monitors and verifiers key on that address, the chain id, and
  the deployed code hash. Another deployer can name the same key and log salt;
  that deployer funds that bond, and it cannot move this one. An indexer that
  keys on the kid would treat the second contract as canonical.

## Still required, carried from testnet

- [ ] One canonical escrow at a time. On redeploy, retire the old escrow, record
  every incident it refunded, and pin a quarantine list on the new escrow that
  excludes at least one head of each of those incidents before activation.
- [ ] The mainnet bond is its own parameter. The testnet floor (10 USDC on
  chain 84532, where a 10–20 USDC bond pays no bounty) is not a mainnet bond.

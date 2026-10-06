# Vendored libraries

These are test and script dependencies for `ChitIssuerRoot`. They are not protocol contracts and Hardhat does not compile this directory.

- `forge-std` at `3b20d60d14b343ee4f908cb8079495c07f5e8981` (MIT / Apache-2.0). Only `src/` is vendored.
- `safe-smart-account` v1.4.1 at `bf943f80fec5ac647159d26161446ac5d716a294` (LGPL-3.0-only). The `contracts/` tree is vendored so Foundry tests can deploy a real Safe 2-of-3. See `LICENSE`.

Do not point a production deploy at a Safe compiled from this tree unless its bytecode matches the canonical SafeL2 1.4.1 singleton. The Base Sepolia gas test uses the canonical singleton and factory already on chain 84532.

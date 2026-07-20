# Legacy circuits (sale / engagement)

Moved out of `contracts/circuits/` — retired fundraising and community-allocation surface. Not part of the Base settlement / x402 / tiered-proof path.

| Contract | Why legacy |
|----------|------------|
| `BelieverRound.sol` | Community TFUEL→XF contribution round on Theta; rounds retired |
| `AngelRound.sol` | Strategic/angel TFUEL→XF round; rounds retired |
| `AngelEscrow.sol` | Theta-native TFUEL multisig escrow for Angel buckets |
| `CommunityEngagementDistributor.sol` | Merkle claims for pre-TGE Community Engagement XF bucket |

Related ops scripts and tests live under `docs/_archive/legacy-believer/` (and residual `believer/` copies). Run: `npm run test:believer`.

Still compiled by Hardhat so `getContractFactory('BelieverRound')` etc. keep working for archive tests and historical deploy scripts.

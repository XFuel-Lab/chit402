# Fair Exchange Design Memo (Phase 1)

> **Purpose:** Map the Fair Exchange primitive to `settleBid` and optionally escrow; define contract/circuit changes and atomicity design.
>
> **Reference:** [PHASE1_INTEGRATION_PLAN.md](../PHASE1_INTEGRATION_PLAN.md) § 1.2. Paper: "How To Make Delegated Payments on Bitcoin: A Question for the AI Agentic Future" (Taylor, Gerhart, Thyagarajan) — **Proxy Adaptor Signatures (PAS)**. Local: `C:\Users\seeha\Downloads\Fairness Exchange Whitepaper.pdf`. Related eprint: 2026/395.

---

## 1. Mapping: paper ↔ XFuel A2A

| Paper concept | XFuel concept |
|---------------|----------------|
| Buyer | Requester (or requester's agent) |
| Seller | Provider |
| Proxies | Relayer(s) or threshold relayer set |
| Witness wit | Delivered result (or resultHash / proof binding) |
| Payment message m | Tx that releases escrow to provider |
| Adapted signature σ | Signature on payment; only obtainable when provider supplies witness to Adapt(τ, wit). Contract verifies σ and releases escrow. |

**Mapping:** Requester exchanges **payment** (escrow release) for **witness** (result). Provider gets σ only by running **Adapt**(τ, wit); contract releases TFUEL when σ is valid. Requester gets result off-chain via ProxExt + ReqExt. Payment and result are cryptographically atomic.

---

## 2. Atomicity mechanism

Yes. PAS guarantees: seller gets paid (σ on-chain) iff buyer can reconstruct witness. Contract accepts valid σ for escrow-release message; one on-chain step. Off-chain: ProxGen, Combine, Adapt, ProxExt, ReqExt.
- **Conclusion:** Cryptographic atomicity; contract verifies signature and releases; protocol off-chain.

---

## 3. EVM and Theta compatibility

Paper: compatible with Bitcoin, Cardano, Ethereum — "lightweight contracts" and signature verification (Secp256k1). No new opcodes. Theta is EVM-compatible.
- **Conclusion:** Yes. Theta-compatible.

---

## 4. Contract / circuit changes

| Question | Answer |
|----------|--------|
| New state variables? | Optional: proxy (relayer) threshold public key or per-bid payment message hash. |
| New function(s)? | e.g. `releaseEscrowWithSignature(bidId, σ)` or `settleBidFairExchange(bidId, σ)` — verify σ, release to provider. |
| New proof type? | No. PAS uses signature verification; keep existing proof-based settleBid for SP1/zkGPT. |

---

## 5. Delegation / custody and escrow

Buyer delegates to proxies (relayer); requester's agent can delegate to relayer. Same primitive can gate createEscrow/claimEscrow (release on σ).
- **Conclusion:** Fair Exchange in **settleBid** (primary) and optionally in **escrow** flows. New entrypoint for signature-based release; keep proof-based settleBid.

---

## 6. Design summary

- **Flow:** (1) Proxies (relayer) run ProxGen → τ. (2) Provider Adapt(τ, wit) → σ. (3) Contract verifies σ for "release bidId to provider", releases TFUEL. (4) Proxies ProxExt → requester ReqExt → result. Atomicity: payment on-chain iff result was bound into τ.
- **Backward compatibility:** Keep current `settleBid(proof, nullifier)`. Add `settleBidFairExchange(bidId, σ)` or `releaseEscrowWithSignature(bidId, σ)` as separate path.

---

*Source: Fairness Exchange Whitepaper (PAS). Gates FE-1 through FE-5 in [PHASE1_KICKOFF.md](../PHASE1_KICKOFF.md).*

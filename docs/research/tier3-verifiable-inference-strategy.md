# Tier-3 Verifiable Inference — Market, Moat & "Better zkGPT" Strategy

> **Status:** Strategy / decision doc (planning only — no code).
> **Date:** 2026-07-17
> **Companion to:** [`zkGPT-tier3-unblock-decision.md`](./zkGPT-tier3-unblock-decision.md)
> (feasibility + adopt-vs-build). This doc goes further: *given we will likely have to
> build our own, what does the market actually value, and how do we build something
> better that gives XFuel a defensible moat?*
> **Framing note:** the goal is **not** to build a faster full-LLM prover than
> DeepProve/Polyhedra (that's a treadmill against well-funded teams, and pure zkML
> loses the "verifiability trilemma" on latency/cost anyway). The goal is to build the
> **verifiable-inference product the agent economy is actually missing**, with a
> **self-owned, permissively-licensed prover** as one tier of it.

---

## 1. TL;DR

1. **Licensing confirms the build-our-own instinct.** DeepProve's core `zkml` crate is
   under a custom **Lagrange License** (GitHub reports the repo license as
   `Other (NOASSERTION)`). It is not OSI/permissive; a commercial settlement layer
   built on it is legally and strategically fragile, and it is squarely in Lagrange's
   interest to restrict competitors. **Assume we cannot safely build on their core.**
2. **But we don't need to "steal" or reinvent cryptography.** We can build **clean-room
   from the public papers** on the **same permissively-licensed primitives DeepProve
   itself reused** — `scroll-tech/ceno` (Apache-2.0), `scroll-tech/gkr-backend`,
   `arkworks-rs/sumcheck` (Apache+MIT), Plonky3, Jolt/Lasso. **Avoid** Polyhedra
   **Expander (AGPL-3.0 — viral copyleft)** and the Lagrange `zkml` crate. Result: a
   prover **XFuel owns outright** — itself a moat.
3. **The market's real pain is not "prove the whole 70B forward pass."** It's the
   **Model Downgrade Attack** (provider serves a cheaper/smaller model than paid for)
   and the **absence of verifiable interaction provenance** in the agent economy
   (98.7–100% of ERC-8004 feedback records have no payment proof or task linkage; the
   ERC-8004 **Validation Registry has no mainnet deployment yet**). That gap is
   *exactly* XFuel's shape: payment-bound receipts + settlement + pluggable proofs.
4. **The winning architecture is hybrid + tiered, not pure ZK.** The 2026 state of the
   art (OTR — Optimistic TEE-Rollups) combines **TEE attestation** (sub-500 ms,
   production-scale) + **optimistic fraud proofs** + **stochastic ZK spot-checks** +
   economic staking. Pure zkML for a 70B model is ~$45+/query and minutes–hours; OTR is
   ~$0.07/query. XFuel already *thinks in tiers* — this maps onto our Tier-1/2/3 model.
5. **XFuel's moat = a settlement-native, payment-bound, anti-downgrade verifiable-
   inference layer** that (a) is the ERC-8004 Validation Registry backend, (b) binds
   proof ↔ x402 payment atomically, (c) uses a self-owned ZK spot-check prover, and
   (d) is DePIN/Theta-native (routes + proves across EdgeCloud/Akash with
   accountability). "Better zkGPT" = better at what the market pays for, not a faster
   matrix-mult prover.

---

## 2. Licensing reality check — why we build, and what we may reuse

### 2.1 Why not just use the open-source stacks
| Stack | License | Usable as our core? |
|---|---|---|
| **DeepProve `zkml` crate** (Lagrange) | Custom **Lagrange License** (`Other/NOASSERTION`) | **No** — not permissive; likely restricts commercial/proprietary integration; strategic dependency on a competitor. Rest of repo is Apache+MIT but the *proving logic* is the encumbered part. |
| **Polyhedra Expander / ECC** | **AGPL-3.0** | **No for closed/commercial linking** — AGPL is viral; using it in a network service can force us to open-source our whole stack. Avoid in the prover path. |
| **JSTprove (Inference Labs)** | Uses Expander (AGPL) + "prod use discouraged" | No. |

> The user's read is correct: given market circumstances, expecting these teams to
> license their crown-jewel prover for a competing settlement layer is optimistic.
> Plan as if the answer is no.

### 2.2 What we *can* legitimately build on (permissive, clean-room)
These are Apache-2.0 / MIT and are the *same family of components* the incumbents used
— reusing them is standard practice, not theft:

| Component | Source | License | Role in our prover |
|---|---|---|---|
| Sumcheck + GKR round | `arkworks-rs/sumcheck` (ark-linear-sumcheck) | Apache-2.0 + MIT | Core GKR/sumcheck engine |
| GKR zkVM / non-uniform prover | `scroll-tech/ceno` | Apache-2.0 | Proving backbone (DeepProve reused this too) |
| Sumcheck, MPCS (BaseFold/WHIR), MLE, Poseidon2 transcript, curves (BN254/BLS12-381) | `scroll-tech/gkr-backend` | Apache-2.0 | Commitments, transcript, field/curve ops |
| Field arithmetic | Plonky3 | MIT/Apache | Goldilocks/BabyBear fields |
| Lookups (Lasso/logup) | a16z `jolt` (Lasso) | MIT/Apache | Non-linear layers (GeLU/softmax/range) |
| BN254 pairing lib | `mcl` (as zkGPT) | permissive | On-chain-compatible curve ops |

**Clean-room discipline:** implement from the *papers* (zkGPT 2025/1184, DeepProve
2026/1112, Libra, zkCNN, Lasso 2023/1216, NANOZK 2603.18046) + the permissive crates
above. Do **not** copy code from the Lagrange `zkml` crate or Expander. Keep a
provenance log (which paper/idea, which permissive dep) for auditor + IP hygiene.

### 2.3 Is greenfield cryptography required? No.
We assemble known-good primitives following public papers. Genuinely novel crypto is a
*last resort*, reserved only for a specific optimization we choose to differentiate on
(§6) — not the baseline.

---

## 3. What makes zkGPT / comparable valuable (the actual value primitives)

Strip the hype; the value is a small set of guarantees agents/enterprises will pay for:

1. **Anti-downgrade / model authenticity (the #1 driver).** Proof that *the model you
   paid for is the model that ran* — defeating the **Model Downgrade Attack** (serve an
   8B model, charge for 70B). This is literally zkGPT's motivating abstract ("providers
   may deploy smaller models … potentially deceiving users") and OTR's central threat.
   **This — not "prove every FLOP" — is the product.**
2. **Model-weight privacy.** Provider proves correctness **without revealing weights**
   (trade-secret models stay private). Enables MLaaS on proprietary fine-tunes.
3. **Public, cheap verifiability.** Anyone verifies in ms, on-chain or off, without the
   model or data. A portable "receipt."
4. **Settlement composability.** The proof can gate money: *pay iff correct*. Useless
   guarantees don't move markets; guarantees wired to escrow/settlement do.
5. **Input/output privacy (optional premium).** Hide the prompt/response while still
   proving correctness.

**Implication:** most of zkGPT's cost goes to (1)+(2) at full fidelity. But the market
mostly needs (1) *credibly* + (3) + (4). A system that delivers anti-downgrade +
verifiable receipt + settlement binding at low cost **beats** a system that proves
every FLOP slowly and expensively. That is the wedge.

---

## 4. What the agent space wants (2026)

### 4.1 The agent stack has crystallized — and there's a hole exactly our shape
```
Comms:        A2A / MCP
Identity:     ERC-8004  (Identity + Reputation + Validation registries)
Commerce:     ERC-8183  (the "Job": terms, escrow, delivery attestation, settlement)
Trust score:  ERC-8126  (0–100 agent security score)
Payments:     x402       (HTTP-native per-request stablecoin payments)
```
- **ERC-8004's Validation Registry** is *defined* as pluggable, tiered validation —
  "stake-secured re-execution, **zkML proofs**, or **TEE attestation**, matched to value
  at risk." **This is XFuel's exact positioning.**
- **The gap is glaring and empirical:** an ERC-8004 study found **98.7% (ETH) / 100%
  (BSC) / 99.3% (Base)** of reputation feedback records have **no payment proof and no
  task linkage**, and **no mainnet Validation Registry deployment** was observed. The
  agent economy today has *reputation theater with no verifiable provenance.*
- **x402 + ERC-8183** want **delivery attestation + deterministic settlement** — i.e. a
  cryptographic receipt bound to a payment. XFuel already has receipts + x402 payment
  binding + settlement on Base. **We are one of the few teams holding the exact pieces
  the standard assumes exist but nobody has shipped.**

### 4.2 The Verifiability Trilemma (integrity vs latency vs cost)
No single mechanism wins. What's actually deployed:

| Mechanism | Trust root | Latency | Cost | Model scale | Notes |
|---|---|---|---|---|---|
| **Pure zkML** (SNARK/STARK) | Mathematics | Minutes–hours | **~$45+/query** (70B) | **~100M param ceiling** | Strongest integrity; not on the latency path for big models |
| **TEE** (NVIDIA H100/Blackwell CC) | HW vendor PKI | ~ms (15–20% overhead) | Low | **100B+** | Real-time; trust = silicon vendor; ~4 KB quote |
| **opML** (fraud proofs) | 1 honest party | **7-day dispute window** | ~$0.06 | Any | Kills real-time/composability |
| **PoQ** (proof of quality) | none (semantic judge) | Low | ~0 | Any | **Fails integrity** — vulnerable to downgrade & reward-hacking |
| **OTR** (TEE + optimistic + stochastic ZK) | Layered | **<0.5 s** provisional | **~$0.07** | 100B+ | 2026 SOTA; ZK used as a **1% spot-check**, not the whole proof |

**Takeaways for XFuel:**
- Pure zkML is a **premium/high-assurance tier**, not the everyday path. Betting the
  whole product on beating DeepProve at raw zkML is the wrong race.
- **TEE (H100 confidential computing) is the fast path** for real-time agents. XFuel
  should treat TEE attestation as a first-class Tier-3 mechanism, not an afterthought.
- **Stochastic ZK spot-checks** (prove a random 1% of requests, or a random subset of
  layers/tokens) give cryptographic deterrence at ~1% of the cost. This is the key
  cost unlock and where our **self-owned ZK prover** earns its keep.
- **Model downgrade** is the attack everyone is racing to stop → our headline promise.

---

## 5. Where XFuel wins — the moat thesis

We do **not** win by out-proving Lagrange on matrix-mult throughput. We win by owning
the **settlement-native verifiable-inference layer** the agent economy is missing. Five
compounding moats:

1. **Settlement-native + payment-bound (unique to us).** XFuel already settles USDC via
   x402 on Base and has `X402_PROOF_BINDING`. Bind the inference proof/attestation to
   the **x402 `payment_ref`** so *payment releases iff the right model ran*. This is the
   atomic "pay-for-correct-inference" primitive ERC-8183/x402 assume but nobody ships.
2. **Be the ERC-8004 Validation Registry backend — first.** No mainnet deployment
   exists. XFuel can be the reference verifiable-provenance validator (receipt + proof
   + payment linkage) that plugs into the standard the whole ecosystem is adopting.
   First-mover on a standardized trust hole.
3. **Tiered trust that matches reality (our existing model, extended).**
   - **T1 signed receipt** (live) — free, every task.
   - **T2 SP1 settlement proof** (live) — correct fees/payment binding on Base.
   - **T3 proof-of-inference (new), itself tiered:** **T3a TEE attestation** (fast,
     production-scale) → **T3b stochastic ZK spot-check** (self-owned prover, random
     layers/tokens/requests) → **T3c full zkML proof** (premium, high-assurance,
     small/mid models). Economic staking/slashing underneath. This is OTR-shaped but
     **settlement-native on Base with x402** — which OTR papers don't have.
4. **Self-owned, permissive prover.** Because our ZK tier is clean-room on Apache/MIT
   primitives, XFuel owns it — no license overhang, can be audited, embedded, and
   licensed on our terms. Ownership is the durable moat vs renting DeepProve.
5. **DePIN/Theta-native + Interstellar-aligned.** XFuel routes across EdgeCloud/Akash.
   A verifiable layer that (a) proves across heterogeneous DePIN GPUs with
   **accountability** (identify/slash a faulty provider — Cirrus 2024/1873), and (b)
   can adopt **Interstellar** (Theta Labs' first-party GKR folding, collaborative
   proving) for swarm/distributed proving, is differentiated in a way neither Lagrange
   nor Polyhedra is positioned for.

---

## 6. "A better zkGPT" — concrete technical bets

If we build, these are the differentiators that make ours *better for the market* (not
just a re-implementation). Ranked by leverage:

1. **Model-authenticity commitment as the primary primitive (anti-downgrade).**
   Instead of always proving the entire forward pass, commit to the weight file
   (Merkle/polynomial commitment) at registration and prove that **the committed
   weights were the ones used** — plus a **spot-check** of a random subset of
   layers/tokens. Dramatically cheaper than full zkGPT, and it directly kills the
   downgrade attack, which is the actual thing customers pay to prevent. Full-pass
   proof becomes an opt-in premium, not the default.
2. **Stochastic / sampled proving.** Prove a tunable fraction (e.g. 1%) of
   requests, or a random layer window per request, with slashing on failure. Turns an
   unaffordable per-query cost into a statistical deterrent (the OTR insight), but
   **settled and slashed on-chain via XFuel**.
3. **Per-token / streaming (incremental) proofs.** Use dynamic/incremental SNARK ideas
   (proof updates ∝ change, not full recompute) so cost tracks generated tokens and
   suits agent streaming. Matches how agents actually consume inference.
4. **Payment-binding v2 (proof ⇄ x402).** Extend `SP1ProofHooks` public-values layout
   so the inference proof commits the payment reference and output hash — one artifact
   proving *correct model + correct payment + correct output*. This is the XFuel-native
   composition nobody else has.
5. **TEE + ZK hybrid receipt (own the fast path too).** Wrap NVIDIA H100 confidential-
   computing attestation as T3a, with our ZK spot-check as the cryptographic backstop
   and staking as the economic one. Sell the *hybrid receipt*, not a single mechanism.
6. **Interstellar folding + collaborative/DePIN proving (Theta-aligned moat).** Adopt
   GKR folding for prover speedup and collaborative folding for swarm proofs across
   DePIN nodes — a first-party Theta path that compounds with XFuel's routing.

> **Honest caveat:** items 1–2 (commitment + spot-check) are where we can plausibly be
> *better and cheaper than a full zkGPT* while shipping sooner. Items 3–6 are roadmap.
> Trying to beat DeepProve at full-LLM proving head-on (raw prover throughput) is the
> one path we should **not** take as the headline bet.

---

## 7. Clean-room build plan (component stack)

| Layer | Build from (permissive) | Following (papers) |
|---|---|---|
| Field / arithmetic | Plonky3, `gkr-backend/ff_ext` | — |
| Sumcheck + GKR | `arkworks-rs/sumcheck`, `ceno`, `gkr-backend/sumcheck` | Libra, zkCNN, GKR (Thaler) |
| Linear layers (matmul/attention) | above | zkGPT §linear, DeepProve (logup-GKR) |
| Non-linear (GeLU/softmax/LayerNorm) | Jolt/Lasso, lookups | zkGPT §non-linear + constraint fusion; NANOZK layerwise |
| Commitment | `gkr-backend/mpcs` (BaseFold/WHIR), Hyrax/mcl | Lasso 2023/1216, Hyrax 2017/1132 |
| Weight commitment / authenticity | Merkle / MLE commit | our design (§6.1) |
| Quantization | our impl | zkGPT Q=16, DeepProve 12-bit (accuracy-preserving) |
| On-chain verifier | Solidity/Yul + BN254 precompiles, or Groth16 wrapper → `ZKVerifierSP1` | `ZKG2_VERIFIER_SPEC.md`, Mira (aggregation) |
| TEE path (T3a) | NVIDIA H100 CC attestation SDK | OTR (2512.20176), inference-chain draft |
| Settlement/binding | existing `SP1ProofHooks`, x402 | XFuel `X402_PROOF_BINDING` |

**Sequencing (smallest → moat):** (0) license/IP + clean-room policy → (1) weight-
commitment + spot-check prover for a small model (GPT-2 / TinyLlama-class) → (2)
payment-bound receipt + off-chain verify (honest demo) → (3) TEE attestation tier
(fast path) → (4) on-chain verifier / ERC-8004 Validation Registry adapter → (5)
streaming proofs, Interstellar folding, DePIN accountability.

---

## 8. Risks & honest counterpoints

- **Racing pure zkML is a losing game.** DeepProve/Polyhedra are ahead and well-funded;
  the trilemma also caps pure-ZK's market. **Mitigation:** compete on
  product/settlement/anti-downgrade + hybrid tiers, not raw prover speed.
- **Crypto talent + time.** A correct, audited GKR+Lasso+verifier stack is a serious
  build even from primitives. **Mitigation:** scope to commitment+spot-check first;
  keep full-pass ZK as premium; consider TEE-first for the near-term demo.
- **TEE trust + supply.** H100 CC imports silicon-vendor trust and needs GPU access
  (our original constraint!). **Mitigation:** TEE is one tier; ZK spot-check is the
  trust backstop; source H100-CC via a cloud that offers it.
- **Standards flux.** ERC-8004/8183/8126 are new. **Mitigation:** the underlying need
  (payment-bound verifiable provenance) is durable regardless of which ERC wins;
  design to the need, adapt the adapter.
- **IP hygiene.** Must avoid contaminating clean-room work with AGPL/Lagrange code.
  **Mitigation:** provenance log, permissive-only dependency policy, legal sign-off.

## 9. Recommendation

1. **Build our own, clean-room, permissive.** Do not depend on Lagrange `zkml` or
   Polyhedra Expander in the product path. Adopt Apache/MIT primitives (ceno,
   gkr-backend, arkworks, Plonky3, Jolt/Lasso).
2. **Reframe "better zkGPT" → "the verifiable-inference layer agents need":** headline
   = **anti-downgrade + payment-bound verifiable receipt**, delivered via a **tiered
   hybrid** (TEE fast path + self-owned ZK spot-check + staking), settled on Base.
3. **Claim the ERC-8004 Validation Registry gap** — be the first mainnet verifiable-
   provenance validator, composing with x402/ERC-8183.
4. **First technical milestone:** weight-commitment + stochastic spot-check prover for
   a small model, payment-bound, off-chain verified — a genuinely novel, cheaper,
   market-aligned primitive we can ship and own.
5. **Keep** full-pass zkML as a premium tier and **Interstellar/DePIN collaborative
   proving** as the compounding Theta-aligned moat — not the day-one bet.

### Options summary
| Option | Moat | Time-to-demo | Risk | Recommendation |
|---|---|---|---|---|
| Rent DeepProve (service/OSS) | Low (theirs) | Fast | License/strategic | Stopgap only |
| Re-implement full zkGPT/DeepProve | Low (treadmill) | Slow | Loses trilemma | **Reject as headline** |
| **Own prover: commitment + ZK spot-check + payment-binding (hybrid, tiered)** | **High** | Med | Med | **Adopt** |
| TEE-first hybrid, ZK backstop | Med-High | Fast-Med | Vendor/GPU | **Adopt for fast path** |
| Invent new proof system | Potentially high | Slow | High | Only for a chosen differentiator |

---

## 10. References
- **Licensing:** DeepProve repo `Other (NOASSERTION)` / Lagrange License on `zkml`
  ([github.com/Lagrange-Labs/deep-prove](https://github.com/Lagrange-Labs/deep-prove));
  Polyhedra Expander **AGPL-3.0**; permissive primitives: `scroll-tech/ceno` (Apache-2.0),
  `scroll-tech/gkr-backend`, `arkworks-rs/sumcheck` (Apache+MIT), Plonky3, a16z `jolt`/Lasso.
- **Agent stack / provenance gap:** ERC-8004 empirical study
  [arXiv 2606.26028](https://arxiv.org/html/2606.26028v2) (98.7–100% feedback lacks
  payment proof/task linkage; no mainnet Validation Registry); ERC-8004 overview
  (eco.com); x402 + ERC-8183 + ERC-8126 (khala.io).
- **Trilemma / hybrid SOTA:** Optimistic TEE-Rollups
  [arXiv 2512.20176](https://arxiv.org/html/2512.20176v1) (H100 CC + optimistic +
  stochastic ZK; ~$0.07/query; model-downgrade & PoEA); IETF SPICE inference-chain
  draft (TEE vs zkML table); "Survey of verifiable AI inference (May 2026)".
- **Proof systems / papers to implement from:** zkGPT
  [2025/1184](https://eprint.iacr.org/2025/1184), DeepProve
  [2026/1112](https://eprint.iacr.org/2026/1112), Lasso
  [2023/1216](https://eprint.iacr.org/2023/1216), Hyrax
  [2017/1132](https://eprint.iacr.org/2017/1132), NANOZK (arXiv 2603.18046),
  Interstellar [2025/1294](https://eprint.iacr.org/2025/1294), Cirrus
  [2024/1873](https://eprint.iacr.org/2024/1873).
- **XFuel context:** [`zkGPT-tier3-unblock-decision.md`](./zkGPT-tier3-unblock-decision.md),
  [`../RUNTIME_STATE.md`](../RUNTIME_STATE.md), [`../ZK-RESEARCH-PIPELINE.md`](../ZK-RESEARCH-PIPELINE.md),
  [`../ZK-RESEARCH-UPGRADE-PACKAGE.md`](../ZK-RESEARCH-UPGRADE-PACKAGE.md).

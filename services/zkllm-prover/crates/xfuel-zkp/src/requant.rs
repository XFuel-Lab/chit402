//! Inter-op requantization — the sound bridge between quantized ops (M5.3).
//!
//! A matmul over code-valued tensors produces a **wide** integer accumulator; before it can feed
//! the next op (activation/norm/attention) it must be **requantized** back into that op's small code
//! domain: `q = ⌊acc / D⌋` for a public power-of-two divisor `D = 2^shift` (a right shift). This is
//! non-linear (it discards the low bits), so we prove it soundly as **division-with-remainder +
//! two range checks**:
//! ```text
//!   acc + bias = q·D + r   (exact — linear in the committed q, r; D, bias public ⇒ checked directly)
//!   0 ≤ r < D              (range check — bounds the discarded remainder)
//!   0 ≤ q < q_bound        (range check — bounds the output into the next op's code domain)
//! ```
//! With `r < D`, the pair `(q, r)` is the *unique* Euclidean division of `acc + bias` by `D`, and
//! `q < q_bound` both bounds the output and forces `acc + bias < q_bound·D` (no silent overflow).
//! This is the one missing piece for a fully-quantized, zero-obligation end-to-end block: a proven
//! requant sits between each op so every output re-enters the next op's [`crate::range`] domain.
//!
//! **Conventions.** Truncation (floor). For round-to-nearest, fold `D/2` into `bias`.
//! Signed accumulators are handled by the **public `bias`**: matmul over signed codes yields a
//! (possibly negative) `acc`; a caller passes `bias ≥ |min(acc)|` so `acc + bias ≥ 0` and small,
//! and `q` is the requantized code in the next op's `[0, q_bound)` domain. `bias` is public and
//! enters the directly-checked identity, so it binds the shift. Saturating clamp (when
//! `acc + bias ≥ q_bound·D`) is a follow-up (a min/compare gadget); here an out-of-range `q` is
//! simply rejected.

use crate::lookup::{CommittedLookupProof, LookupProof};
use crate::pcs;
use crate::range::RangeTable;
use crate::transcript::Transcript;
use crate::{log2_exact, Fr};
use ark_ff::{BigInteger, PrimeField};

/// A requantization proof: the remainder advice + the quotient/remainder range-check proofs.
/// The quotient `q` (the requantized output) is returned alongside by [`prove_requant`].
pub struct RequantProof {
    pub r: Vec<Fr>,
    pub p_r: LookupProof,
    pub p_q: LookupProof,
}

/// Decode a small non-negative field element to `u64` (panics if it is not a small non-negative
/// integer — the requant precondition; feed a bias-shifted `acc` for signed accumulators).
fn decode_small(f: &Fr) -> u64 {
    let big = f.into_bigint();
    let limbs = big.as_ref();
    for &l in &limbs[1..] {
        assert_eq!(l, 0, "requant input is not a small non-negative integer (bias-shift signed acc)");
    }
    limbs[0]
}

/// Prove `q = ⌊(acc + bias) / divisor⌋` for every element of `acc`, with the quotient bounded by
/// `q_table` (`[0, q_bound)` = next op's code domain) and the remainder by `r_table`
/// (`[0, divisor)`). `bias` is a public shift (use `Fr::zero()` for non-negative `acc`); `divisor`
/// must equal `r_table.bound` (a power of two). Returns `(proof, q)`.
pub fn prove_requant(
    acc: &[Fr],
    bias: Fr,
    divisor: usize,
    r_table: &RangeTable,
    q_table: &RangeTable,
    tr: &mut Transcript,
) -> (RequantProof, Vec<Fr>) {
    assert!(acc.len().is_power_of_two(), "requant column length must be a power of two");
    assert_eq!(divisor, r_table.bound, "divisor must match the remainder range table");
    let d = divisor as u64;

    let mut q = Vec::with_capacity(acc.len());
    let mut r = Vec::with_capacity(acc.len());
    for a in acc {
        let av = decode_small(&(*a + bias));
        q.push(Fr::from(av / d));
        r.push(Fr::from(av % d));
    }

    // Range-check remainder then quotient (order fixed; verify mirrors it).
    let p_r = r_table.prove(&r, tr);
    let p_q = q_table.prove(&q, tr);

    (RequantProof { r, p_r, p_q }, q)
}

/// Verify a requantization proof: the exact division identity `acc + bias = q·divisor + r` (direct)
/// plus the remainder and quotient range checks.
#[allow(clippy::too_many_arguments)]
pub fn verify_requant(
    acc: &[Fr],
    q: &[Fr],
    bias: Fr,
    divisor: usize,
    r_table: &RangeTable,
    q_table: &RangeTable,
    proof: &RequantProof,
    tr: &mut Transcript,
) -> bool {
    let n = acc.len();
    if !n.is_power_of_two()
        || q.len() != n
        || proof.r.len() != n
        || divisor != r_table.bound
    {
        return false;
    }

    // Exact Euclidean identity acc + bias = q·D + r (D, bias public ⇒ linear, checked directly).
    let d = Fr::from(divisor as u64);
    for i in 0..n {
        if acc[i] + bias != q[i] * d + proof.r[i] {
            return false;
        }
    }

    if !r_table.verify(&proof.r, &proof.p_r, tr) {
        return false;
    }
    q_table.verify(q, &proof.p_q, tr)
}

// ─── Committed (succinct) requant — M5.4b ─────────────────────────────────────
//
// The wide→code hop with the verifier holding no `acc`/`q`/`r` tensor. The Euclidean identity
// `acc + bias = q·D + r` is *affine* in the committed tensors (`D`, `bias` public; the MLE of the
// constant-`bias` tensor is the constant `bias`), so — like the residual add — it holds at a single
// random Fiat–Shamir point ρ iff it holds elementwise (Schwartz–Zippel). The two bounds become
// **committed** range checks. Ops thread by commitment reuse: `acc`'s commitment is the prior
// matmul's output, and the returned `q` commitment is the next op's operand.

/// A committed requant proof: two committed range checks (`0 ≤ r < D`, `0 ≤ q < q_bound`) plus the
/// affine division identity discharged by openings of `acc`, `q`, `r` at one point ρ. The `q` and `r`
/// commitments live in `p_q_range.comm_query[0]` / `p_r_range.comm_query[0]`.
pub struct CommittedRequantProof {
    pub p_r_range: CommittedLookupProof,
    pub p_q_range: CommittedLookupProof,
    pub acc: pcs::Opening,
    pub q: pcs::Opening,
    pub r: pcs::Opening,
}

/// Absorb the affine identity's public parts (`n`, `bias`, `divisor`) and the `acc`,`q`,`r`
/// commitments, then draw the random evaluation point ρ.
fn bind_div(
    tr: &mut Transcript,
    n: usize,
    bias: Fr,
    divisor: usize,
    comm_acc: &pcs::Comm,
    comm_q: &pcs::Comm,
    comm_r: &pcs::Comm,
) -> Vec<Fr> {
    tr.absorb_bytes(b"rq.n", &(n as u64).to_le_bytes());
    tr.absorb_bytes(b"rq.bias", &bias.into_bigint().to_bytes_le());
    tr.absorb_bytes(b"rq.d", &(divisor as u64).to_le_bytes());
    tr.absorb_bytes(b"rq.acc", &pcs::commitment_bytes(comm_acc));
    tr.absorb_bytes(b"rq.q", &pcs::commitment_bytes(comm_q));
    tr.absorb_bytes(b"rq.r", &pcs::commitment_bytes(comm_r));
    (0..log2_exact(n)).map(|_| tr.challenge(b"rq.rho")).collect()
}

/// Prove `q = ⌊(acc + bias) / divisor⌋` succinctly. `ck_n` sizes the `acc`/`q`/`r` columns
/// (`log2(acc.len())` vars); `ck_rt`/`ck_qt` the remainder/quotient table domains. Returns the proof,
/// the `acc` commitment (for the caller to tie to the prior op's output), the `q` commitment (the
/// next op's operand), and `q`.
#[allow(clippy::too_many_arguments)]
pub fn prove_committed_requant(
    acc: &[Fr],
    bias: Fr,
    divisor: usize,
    r_table: &RangeTable,
    q_table: &RangeTable,
    ck_n: &pcs::Ck,
    ck_rt: &pcs::Ck,
    ck_qt: &pcs::Ck,
    tr: &mut Transcript,
) -> (CommittedRequantProof, pcs::Comm, pcs::Comm, Vec<Fr>) {
    assert!(acc.len().is_power_of_two(), "requant column length must be a power of two");
    assert_eq!(divisor, r_table.bound, "divisor must match the remainder range table");
    let d = divisor as u64;

    let mut q = Vec::with_capacity(acc.len());
    let mut r = Vec::with_capacity(acc.len());
    for a in acc {
        let av = decode_small(&(*a + bias));
        q.push(Fr::from(av / d));
        r.push(Fr::from(av % d));
    }

    let comm_acc = pcs::commit(ck_n, acc);

    // Committed range checks (order fixed; verify mirrors it): remainder then quotient.
    let p_r_range = r_table.prove_committed(&r, ck_n, ck_rt, tr);
    let p_q_range = q_table.prove_committed(&q, ck_n, ck_qt, tr);
    let comm_r = p_r_range.comm_query[0].clone();
    let comm_q = p_q_range.comm_query[0].clone();

    // Affine division identity at one random point.
    let rho = bind_div(tr, acc.len(), bias, divisor, &comm_acc, &comm_q, &comm_r);
    let proof = CommittedRequantProof {
        p_r_range,
        p_q_range,
        acc: pcs::open_at(ck_n, acc, &rho),
        q: pcs::open_at(ck_n, &q, &rho),
        r: pcs::open_at(ck_n, &r, &rho),
    };
    (proof, comm_acc, comm_q, q)
}

/// Succinctly verify a requant proof from `comm_acc` (the prior op's output commitment) and the
/// canonical range tables. The verifier holds no tensors; the returned `q` commitment
/// (`proof.p_q_range.comm_query[0]`) is the next op's operand.
#[allow(clippy::too_many_arguments)]
pub fn verify_committed_requant(
    n: usize,
    bias: Fr,
    divisor: usize,
    r_table: &RangeTable,
    q_table: &RangeTable,
    comm_acc: &pcs::Comm,
    proof: &CommittedRequantProof,
    ck_rt: &pcs::Ck,
    ck_qt: &pcs::Ck,
    vk_n: &pcs::Vk,
    vk_rt: &pcs::Vk,
    vk_qt: &pcs::Vk,
    tr: &mut Transcript,
) -> bool {
    if !n.is_power_of_two() || divisor != r_table.bound {
        return false;
    }

    // 1. remainder range check 0 ≤ r < divisor (table tied to canonical [0,divisor)).
    if proof.p_r_range.comm_query.len() != 1
        || !r_table.verify_committed(n, &proof.p_r_range, ck_rt, vk_n, vk_rt, tr)
    {
        return false;
    }
    let comm_r = &proof.p_r_range.comm_query[0];

    // 2. quotient range check 0 ≤ q < q_bound.
    if proof.p_q_range.comm_query.len() != 1
        || !q_table.verify_committed(n, &proof.p_q_range, ck_qt, vk_n, vk_qt, tr)
    {
        return false;
    }
    let comm_q = &proof.p_q_range.comm_query[0];

    // 3. affine identity acc + bias = q·D + r at ρ (Schwartz–Zippel).
    let rho = bind_div(tr, n, bias, divisor, comm_acc, comm_q, comm_r);
    let d = Fr::from(divisor as u64);
    if proof.acc.value + bias != proof.q.value * d + proof.r.value {
        return false;
    }
    pcs::check_open(vk_n, comm_acc, &rho, &proof.acc)
        && pcs::check_open(vk_n, comm_q, &rho, &proof.q)
        && pcs::check_open(vk_n, comm_r, &rho, &proof.r)
}

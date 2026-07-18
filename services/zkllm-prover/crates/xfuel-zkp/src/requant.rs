//! Inter-op requantization — the sound bridge between quantized ops (M5.3).
//!
//! A matmul over code-valued tensors produces a **wide** integer accumulator; before it can feed
//! the next op (activation/norm/attention) it must be **requantized** back into that op's small code
//! domain: `q = ⌊acc / D⌋` for a public power-of-two divisor `D = 2^shift` (a right shift). This is
//! non-linear (it discards the low bits), so we prove it soundly as **division-with-remainder +
//! two range checks**:
//! ```text
//!   acc = q·D + r        (exact — linear in the committed q, r; D public ⇒ verifier checks directly)
//!   0 ≤ r < D            (range check — bounds the discarded remainder)
//!   0 ≤ q < q_bound      (range check — bounds the output into the next op's code domain)
//! ```
//! With `r < D`, the pair `(q, r)` is the *unique* Euclidean division of `acc` by `D`, and
//! `q < q_bound` both bounds the output and forces `acc < q_bound·D` (no silent overflow). This is
//! the one missing piece for a fully-quantized, zero-obligation end-to-end block: a proven requant
//! sits between each op so every output re-enters the next op's [`crate::range`] domain.
//!
//! **Conventions.** Truncation (floor). For round-to-nearest, the caller pre-adds `D/2` to `acc`.
//! `acc` and `q` are treated as **non-negative** codes; signed accumulators are shifted by a public
//! bias (`acc' = acc + bias`, `q' = q + offset`) before requant — the relation and ranges hold on
//! the shifted quantities. Saturating clamp (when `acc ≥ q_bound·D`) is a follow-up (a min/compare
//! gadget); here an out-of-range `q` is simply rejected.

use crate::range::RangeTable;
use crate::lookup::LookupProof;
use crate::transcript::Transcript;
use crate::Fr;
use ark_ff::PrimeField;

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

/// Prove `q = ⌊acc / divisor⌋` for every element of `acc`, with the quotient bounded by
/// `q_table` (`[0, q_bound)` = next op's code domain) and the remainder by `r_table`
/// (`[0, divisor)`). `divisor` must equal `r_table.bound` (a power of two). Returns `(proof, q)`.
pub fn prove_requant(
    acc: &[Fr],
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
        let av = decode_small(a);
        q.push(Fr::from(av / d));
        r.push(Fr::from(av % d));
    }

    // Range-check remainder then quotient (order fixed; verify mirrors it).
    let p_r = r_table.prove(&r, tr);
    let p_q = q_table.prove(&q, tr);

    (RequantProof { r, p_r, p_q }, q)
}

/// Verify a requantization proof: the exact division identity `acc = q·divisor + r` (direct) plus
/// the remainder and quotient range checks.
pub fn verify_requant(
    acc: &[Fr],
    q: &[Fr],
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

    // Exact Euclidean identity acc = q·D + r (D public ⇒ linear, checked directly).
    let d = Fr::from(divisor as u64);
    for i in 0..n {
        if acc[i] != q[i] * d + proof.r[i] {
            return false;
        }
    }

    if !r_table.verify(&proof.r, &proof.p_r, tr) {
        return false;
    }
    q_table.verify(q, &proof.p_q, tr)
}

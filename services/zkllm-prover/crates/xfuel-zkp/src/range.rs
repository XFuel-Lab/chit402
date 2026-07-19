//! Range-check gadget — prove a column of values all lie in `[0, bound)`.
//!
//! A range check is just a **membership lookup** into the identity table `[0, 1, …, bound-1]`: the
//! [`crate::lookup`] logup argument proves every queried value is one of those `bound` rows, i.e.
//! in range. This is the building block for [`crate::requant`] (bounding the quotient and the
//! remainder of an inter-op requantization) and for any future limb/decomposition range proof.
//!
//! `bound` is a power of two (the lookup requires power-of-two table + query lengths); larger
//! ranges decompose into base-`bound` limbs, each range-checked here (a follow-up as needed).

use crate::lookup::{
    prove_committed_lookup, prove_lookup, verify_committed_lookup, verify_lookup,
    CommittedLookupProof, LookupProof,
};
use crate::pcs;
use crate::transcript::Transcript;
use crate::Fr;

/// The identity table `[0, bound)` backing a range check.
pub struct RangeTable {
    pub bound: usize,
    pub codes: Vec<Fr>,
}

impl RangeTable {
    /// Build the range table for `[0, bound)` (`bound` a power of two ≥ 2).
    pub fn new(bound: usize) -> Self {
        assert!(bound.is_power_of_two() && bound >= 2, "range bound must be a power of two ≥ 2");
        let codes = (0..bound).map(|c| Fr::from(c as u64)).collect();
        Self { bound, codes }
    }

    /// Prove every value of `xs` is in `[0, bound)`. `xs.len()` must be a power of two; every value
    /// must actually be in range (lookup precondition — an out-of-range value cannot be proven).
    pub fn prove(&self, xs: &[Fr], tr: &mut Transcript) -> LookupProof {
        prove_lookup(&[xs], &[&self.codes], tr)
    }

    /// Verify a range-check proof for `xs` against `[0, bound)`.
    pub fn verify(&self, xs: &[Fr], proof: &LookupProof, tr: &mut Transcript) -> bool {
        verify_lookup(&[xs], &[&self.codes], proof, tr)
    }

    /// Prove every value of `xs` is in `[0, bound)` **succinctly** (committed): a single-column
    /// committed membership lookup. `ck_q` sizes the query column (`log2(xs.len())` vars), `ck_t` the
    /// identity table domain (`log2(bound)` vars). The query commitment is `comm_query[0]`, which the
    /// caller ties to the committed tensor being range-checked.
    pub fn prove_committed(
        &self,
        xs: &[Fr],
        ck_q: &pcs::Ck,
        ck_t: &pcs::Ck,
        tr: &mut Transcript,
    ) -> CommittedLookupProof {
        prove_committed_lookup(&[xs], &[&self.codes], ck_q, ck_t, tr)
    }

    /// Verify a committed range check, **tying the proof's committed table to the canonical identity
    /// table** `[0, bound)` (else a prover could range-check against a forged table). `n` is the query
    /// length (a power of two). `ck_t` re-derives the canonical table commitment (public infra).
    pub fn verify_committed(
        &self,
        n: usize,
        proof: &CommittedLookupProof,
        ck_t: &pcs::Ck,
        vk_q: &pcs::Vk,
        vk_t: &pcs::Vk,
        tr: &mut Transcript,
    ) -> bool {
        if proof.comm_table.len() != 1 {
            return false;
        }
        if pcs::commitment_bytes(&proof.comm_table[0]) != pcs::commitment_bytes(&pcs::commit(ck_t, &self.codes)) {
            return false;
        }
        verify_committed_lookup(n, self.bound, proof, vk_q, vk_t, tr)
    }
}

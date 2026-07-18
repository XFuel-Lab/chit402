//! Generic canonical scalar lookup table — the reusable backbone for proving any quantized
//! `code → code` non-linearity soundly via the [`crate::lookup`] logup argument.
//!
//! A table is a deterministic function `f: 0..domain → ℤ` encoded as two field columns
//! `(in_codes, out_codes)`. Prover and verifier build byte-identical tables from `(domain, f)`, so a
//! lookup proving `output = f(input)` needs no field-native circuit for `f`. This is the same
//! pattern as the SiLU/GeLU [`crate::activation`] and RMSNorm-rsqrt [`crate::norm`] tables; those
//! predate this type and can migrate onto it. Used for softmax's `exp` and the normalization
//! reciprocal in [`crate::attention`].

use crate::activation::encode_i64;
use crate::lookup::{prove_lookup, verify_lookup, LookupProof};
use crate::transcript::Transcript;
use crate::Fr;
use ark_ff::PrimeField;

/// A canonical `code → code` lookup table (columns: input code `0..domain`, output code `f(code)`).
pub struct ScalarTable {
    pub domain: usize,
    pub in_codes: Vec<Fr>,
    pub out_codes: Vec<Fr>,
}

impl ScalarTable {
    /// Build the table for `f` over `domain` codes (a power of two ≥ 2). `f(c)` may be signed.
    pub fn new(domain: usize, f: impl Fn(usize) -> i64) -> Self {
        assert!(domain.is_power_of_two() && domain >= 2, "domain must be a power of two ≥ 2");
        let mut in_codes = Vec::with_capacity(domain);
        let mut out_codes = Vec::with_capacity(domain);
        for c in 0..domain {
            in_codes.push(Fr::from(c as u64));
            out_codes.push(encode_i64(f(c)));
        }
        Self { domain, in_codes, out_codes }
    }

    /// Apply the table to a column of input codes (each must be a valid code `0..domain`).
    pub fn apply(&self, input_codes: &[Fr]) -> Vec<Fr> {
        input_codes.iter().map(|c| self.out_codes[code_to_index(c, self.domain)]).collect()
    }

    /// Prove `output = f(input)` for the given columns (both must be table rows).
    pub fn prove(&self, input_codes: &[Fr], output_codes: &[Fr], tr: &mut Transcript) -> LookupProof {
        prove_lookup(&[input_codes, output_codes], &[&self.in_codes, &self.out_codes], tr)
    }

    /// Verify a lookup proof against the given columns.
    pub fn verify(
        &self,
        input_codes: &[Fr],
        output_codes: &[Fr],
        proof: &LookupProof,
        tr: &mut Transcript,
    ) -> bool {
        verify_lookup(&[input_codes, output_codes], &[&self.in_codes, &self.out_codes], proof, tr)
    }
}

/// Decode a small non-negative field code to a `usize` index (panics if not a small in-domain code).
fn code_to_index(code: &Fr, domain: usize) -> usize {
    let big = code.into_bigint();
    let limbs = big.as_ref();
    for &l in &limbs[1..] {
        assert_eq!(l, 0, "lookup input is not a valid small code");
    }
    let idx = limbs[0] as usize;
    assert!(idx < domain, "lookup input code {idx} out of domain {domain}");
    idx
}

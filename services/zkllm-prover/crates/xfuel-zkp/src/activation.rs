//! Quantized activation as a lookup table — turns the FFN's `silu`/`gelu` **obligation** into a
//! **sound** proof via [`crate::lookup`].
//!
//! An activation over a quantized code domain is a finite function `code → out_code`. We precompute
//! the `(in_code, out_code)` table for the op, then prove every `(gate_i, act_i)` the model used is
//! a row of it. Because the table encodes the correct op, the lookup proves the activation was
//! applied correctly — with no field-native circuit for the transcendental itself.
//!
//! Codes are `0..domain` (power of two). Code `c` denotes the signed integer `c − domain/2`; the
//! real value is `signed·scale`. Outputs are requantized back to signed codes and field-encoded.

use crate::lookup::{prove_lookup, verify_lookup, LookupProof};
use crate::transcript::Transcript;
use crate::Fr;
use ark_ff::PrimeField;

/// Supported elementwise activations.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActKind {
    Silu,
    Gelu,
}

impl ActKind {
    pub fn eval_real(self, x: f64) -> f64 {
        match self {
            ActKind::Silu => x / (1.0 + (-x).exp()),
            ActKind::Gelu => {
                let c = (2.0 / std::f64::consts::PI).sqrt();
                0.5 * x * (1.0 + (c * (x + 0.044715 * x * x * x)).tanh())
            }
        }
    }

    pub fn tag(self) -> &'static str {
        match self {
            ActKind::Silu => "silu",
            ActKind::Gelu => "gelu",
        }
    }
}

/// Encode a signed integer into the BN254 scalar field.
pub fn encode_i64(v: i64) -> Fr {
    if v >= 0 {
        Fr::from(v as u64)
    } else {
        -Fr::from((-v) as u64)
    }
}

/// Decode a small non-negative field code to a `usize` index (panics if not a small integer).
fn code_to_index(code: &Fr, domain: usize) -> usize {
    let big = code.into_bigint();
    let limbs = big.as_ref();
    for &l in &limbs[1..] {
        assert_eq!(l, 0, "activation input is not a valid small code");
    }
    let idx = limbs[0] as usize;
    assert!(idx < domain, "activation input code {idx} out of domain {domain}");
    idx
}

/// A precomputed quantized activation lookup table (columns: input code, output code).
pub struct ActivationTable {
    pub kind: ActKind,
    pub domain: usize,
    pub scale: f64,
    pub in_codes: Vec<Fr>,
    pub out_codes: Vec<Fr>,
}

impl ActivationTable {
    /// Build the table for `kind` over `domain` codes (power of two) with fixed-point `scale`.
    pub fn new(kind: ActKind, domain: usize, scale: f64) -> Self {
        assert!(domain.is_power_of_two() && domain >= 2, "domain must be a power of two ≥ 2");
        let half = (domain / 2) as i64;
        let lo = -half;
        let hi = half - 1;
        let mut in_codes = Vec::with_capacity(domain);
        let mut out_codes = Vec::with_capacity(domain);
        for c in 0..domain {
            let signed = c as i64 - half;
            let real_out = kind.eval_real(signed as f64 * scale);
            let mut out_code = (real_out / scale).round() as i64;
            out_code = out_code.clamp(lo, hi);
            in_codes.push(Fr::from(c as u64));
            out_codes.push(encode_i64(out_code));
        }
        Self { kind, domain, scale, in_codes, out_codes }
    }

    /// Apply the activation to a column of input codes (each must be a valid code `0..domain`).
    pub fn apply(&self, input_codes: &[Fr]) -> Vec<Fr> {
        input_codes.iter().map(|c| self.out_codes[code_to_index(c, self.domain)]).collect()
    }

    /// Prove `output = act(input)` for the given columns (both must be table rows).
    pub fn prove(&self, input_codes: &[Fr], output_codes: &[Fr], tr: &mut Transcript) -> LookupProof {
        prove_lookup(
            &[input_codes, output_codes],
            &[&self.in_codes, &self.out_codes],
            tr,
        )
    }

    /// Verify an activation lookup proof against the given columns.
    pub fn verify(
        &self,
        input_codes: &[Fr],
        output_codes: &[Fr],
        proof: &LookupProof,
        tr: &mut Transcript,
    ) -> bool {
        verify_lookup(
            &[input_codes, output_codes],
            &[&self.in_codes, &self.out_codes],
            proof,
            tr,
        )
    }
}

//! Multilinear polynomial-commitment scheme (PCS) — the M5.4 succinctness binding.
//!
//! Wraps arkworks' multilinear KZG (`ark_poly_commit::multilinear_pc::MultilinearPC`), the Marlin
//! variant of the Papamanthou–Shi–Tamassia construction (TCC 2013) over BN254. A committer folds a
//! table of `2^n` field values (the multilinear extension of a tensor) into a single group element;
//! an opening proves the tensor's MLE evaluates to a claimed value at a query point with a constant
//! number of group elements. This is exactly what turns our matmul/lookup arguments from the
//! *verifiable-computation* model (verifier holds the full tensors and recomputes `mle_eval`) into a
//! *succinct* one: the verifier holds only a commitment and checks an opening.
//!
//! **Why this scheme.** It is pairing-based on BN254, so an opening verifies with the `ecPairing`
//! precompile (`0x08`) — the same field XFuel already settles on (ADR 0002/0004). That keeps the
//! future on-chain `IVerifiedInference` verifier a native-Solidity path rather than forcing a
//! non-native-pairing-in-circuit Groth16 wrap. It is Apache-2.0 / MIT (ADR 0003 clean-room).
//!
//! **Trust boundary.** Multilinear KZG needs a *trusted setup* (a per-`num_vars` structured
//! reference string, i.e. powers of a secret in the exponent). In production that SRS comes from a
//! powers-of-tau ceremony; anyone who knows the toxic waste can forge openings. This is the same
//! trust assumption Groth16 already carries, and it is why [`setup`] takes an explicit RNG and is
//! never called on the hot path — keys are generated once and pinned.
//!
//! **Index convention.** ark-poly indexes multilinear variable `0` as the *least*-significant bit of
//! the flat table index, whereas our [`crate::mle`] orders `point[0]` as the *most*-significant bit
//! (row bits high, column bits low). [`open`]/[`verify`] therefore reverse the query point so a PCS
//! opening reproduces exactly `mle::mle_eval(table, point)`. This is asserted directly in the tests.

use crate::{log2_exact, Fr};
use ark_bn254::Bn254;
use ark_poly::DenseMultilinearExtension;
use ark_poly_commit::multilinear_pc::data_structures::{
    Commitment, CommitterKey, Proof, UniversalParams, VerifierKey,
};
use ark_poly_commit::multilinear_pc::MultilinearPC;
use ark_std::rand::RngCore;

/// Universal parameters (the SRS) from the trusted setup; supports any `num_vars ≤ max_vars`.
pub type Params = UniversalParams<Bn254>;
/// Prover key specialized to a given `num_vars` (produced by [`keys`]).
pub type Ck = CommitterKey<Bn254>;
/// Verifier key specialized to a given `num_vars` (produced by [`keys`]).
pub type Vk = VerifierKey<Bn254>;
/// A binding commitment to a tensor's multilinear extension (a constant number of group elements).
pub type Comm = Commitment<Bn254>;
/// An evaluation-opening proof for a committed MLE at one point.
pub type OpeningProof = Proof<Bn254>;

/// Run the trusted setup for polynomials in up to `max_vars` variables.
///
/// This is the ceremony step: the returned [`Params`] embed a secret that MUST NOT be retained.
/// Call once, offline, with a real RNG (or ingest an existing powers-of-tau SRS); never on the
/// proving hot path.
pub fn setup<R: RngCore>(max_vars: usize, rng: &mut R) -> Params {
    MultilinearPC::<Bn254>::setup(max_vars, rng)
}

/// Specialize the SRS to exactly `num_vars` variables, yielding a committer key and verifier key.
///
/// `num_vars` must be a table's `log2(len)` and lie in `1..=max_vars` of the [`setup`] parameters.
pub fn keys(params: &Params, num_vars: usize) -> (Ck, Vk) {
    MultilinearPC::<Bn254>::trim(params, num_vars)
}

/// Build the multilinear extension of a `2^n`-length table under ark-poly's (LSB-first) convention.
fn to_mle(table: &[Fr]) -> DenseMultilinearExtension<Fr> {
    let num_vars = log2_exact(table.len());
    DenseMultilinearExtension::from_evaluations_slice(num_vars, table)
}

/// Bridge our MSB-first point (see [`crate::mle`]) to ark-poly's LSB-first evaluation order.
fn ark_point(point: &[Fr]) -> Vec<Fr> {
    point.iter().rev().copied().collect()
}

/// Commit to a tensor given as its `2^n`-length row-major MLE table.
pub fn commit(ck: &Ck, table: &[Fr]) -> Comm {
    MultilinearPC::commit(ck, &to_mle(table))
}

/// Produce an opening proof that `table`'s MLE evaluates to `mle_eval(table, point)` at `point`.
pub fn open(ck: &Ck, table: &[Fr], point: &[Fr]) -> OpeningProof {
    MultilinearPC::open(ck, &to_mle(table), &ark_point(point))
}

/// Verify that `value` is the MLE evaluation of the committed tensor at `point`.
///
/// Soundness here rests only on the commitment + the trusted setup — the full tensor is not needed.
pub fn verify(vk: &Vk, comm: &Comm, point: &[Fr], value: Fr, proof: &OpeningProof) -> bool {
    MultilinearPC::check(vk, comm, &ark_point(point), value, proof)
}

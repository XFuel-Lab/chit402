//! SP1-compat spike — the SP1-independent core.
//!
//! This crate holds the substantive logic the SP1 guest will run for the Tier-3 verifier: deserialize
//! a committed **multilinear-KZG opening** and check it with [`xfuel_zkp::pcs`], emitting a small
//! public-values [`SpikeBundle`]. It is deliberately free of any `sp1-*` dependency so it compiles +
//! unit-tests on any host (including Windows, where the SP1 SDK's `std::os::fd` usage does not build).
//! The guest (`../sp1/guest`) is a thin wrapper that reads a witness, calls [`verify_opening`], and
//! commits the bundle.
//!
//! **Why this is the make-or-break unit (ADR 0004 sequencing step 2):** [`verify_opening`] performs
//! exactly one `ark-poly-commit` multilinear-KZG check — a BN254 pairing check. Getting *this*
//! compiling + proving inside the zkVM (with SP1's patched BN254 crates) is what decides **C1**
//! (keep KZG, pairings in-guest) vs **C2** (drop KZG, keccak commitments + in-guest evaluation). The
//! logic is identical on host and guest, so the serialization round-trip and verify are proven here
//! on the host before we ever pay for a zkVM build.

use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use serde::{Deserialize, Serialize};
use xfuel_zkp::commitment::keccak256;
use xfuel_zkp::pcs::{self, Comm, OpeningProof, Vk};
use xfuel_zkp::Fr;

/// A serialized single-opening witness passed host → guest. Each field is arkworks
/// `CanonicalSerialize` (compressed) bytes; SP1 stdin ferries the whole struct via serde/bincode.
/// Keeping the arkworks types as opaque byte blobs avoids requiring serde impls on the group
/// elements while still round-tripping losslessly through the zkVM I/O.
#[derive(Clone, Serialize, Deserialize)]
pub struct OpeningWitness {
    /// `pcs::Vk` (verifier key specialized to the tensor's `num_vars`).
    pub vk: Vec<u8>,
    /// `pcs::Comm` (the tensor's multilinear-KZG commitment — the PoMA anchor in the real flow).
    pub comm: Vec<u8>,
    /// `Vec<Fr>` (the evaluation point; in the real flow this is re-derived from the transcript).
    pub point: Vec<u8>,
    /// `Fr` (the claimed MLE evaluation at `point`).
    pub value: Vec<u8>,
    /// `pcs::OpeningProof` (the constant-size KZG opening).
    pub proof: Vec<u8>,
}

/// The guest's committed public values for the spike: whether the opening verified, plus a digest
/// binding the checked commitment + point + value. In the real Tier-3 guest this expands to the full
/// commitment bundle (`model_commitment`, `input/output hash`, `payment_ref`, nullifier); here it is
/// a minimal stand-in so we can measure the pairing-check cost in isolation.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
pub struct SpikeBundle {
    pub verified: bool,
    pub digest: [u8; 32],
}

fn ser<T: CanonicalSerialize>(v: &T) -> Vec<u8> {
    let mut b = Vec::new();
    v.serialize_compressed(&mut b).expect("in-memory serialize is infallible");
    b
}

fn de<T: CanonicalDeserialize>(b: &[u8]) -> T {
    T::deserialize_compressed(b).expect("spike witness deserialization failed")
}

/// Encode a KZG opening into a transportable [`OpeningWitness`] (host side).
pub fn encode_opening(
    vk: &Vk,
    comm: &Comm,
    point: &[Fr],
    value: Fr,
    proof: &OpeningProof,
) -> OpeningWitness {
    OpeningWitness {
        vk: ser(vk),
        comm: ser(comm),
        point: ser(&point.to_vec()),
        value: ser(&value),
        proof: ser(proof),
    }
}

/// Deserialize + verify a single committed multilinear-KZG opening, returning the public-values
/// bundle. **This is exactly what the SP1 guest runs**; the `pcs::verify` pairing check inside is the
/// SP1-compat make-or-break.
pub fn verify_opening(w: &OpeningWitness) -> SpikeBundle {
    let vk: Vk = de(&w.vk);
    let comm: Comm = de(&w.comm);
    let point: Vec<Fr> = de(&w.point);
    let value: Fr = de(&w.value);
    let proof: OpeningProof = de(&w.proof);

    let verified = pcs::verify(&vk, &comm, &point, value, &proof);

    // Bind the checked statement into a digest (stand-in for the real Tier-3 commitment bundle).
    let mut pre = Vec::with_capacity(w.comm.len() + w.point.len() + w.value.len());
    pre.extend_from_slice(&w.comm);
    pre.extend_from_slice(&w.point);
    pre.extend_from_slice(&w.value);
    let digest = keccak256(&pre);

    SpikeBundle { verified, digest }
}

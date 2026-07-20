//! SP1 guest for the Tier-3 verifier compat spike.
//!
//! Reads one serialized KZG opening witness, verifies it with multilinear KZG (the `ark-poly-commit`
//! BN254 pairing check that must survive the zkVM — SP1's patched `bn254`/`ark-*` crates + the
//! `ecPairing` precompile do the heavy lifting), and commits the resulting [`SpikeBundle`] as public
//! values. All substantive logic lives in `xfuel-inference-spike-core` so it is host-testable; this
//! file is only the zkVM entrypoint. Build with the SP1 toolchain (`cargo prove build`) — see the
//! spike `README.md`.
#![no_main]
sp1_zkvm::entrypoint!(main);

use xfuel_inference_spike_core::{verify_opening, OpeningWitness, SpikeBundle};

pub fn main() {
    let witness: OpeningWitness = sp1_zkvm::io::read();
    let bundle: SpikeBundle = verify_opening(&witness);

    // The opening MUST verify inside the guest; a false constraint here means the committed statement
    // is unproven and the proof should not be accepted.
    assert!(bundle.verified, "spike: multilinear-KZG opening failed to verify in-guest");

    sp1_zkvm::io::commit(&bundle);
}

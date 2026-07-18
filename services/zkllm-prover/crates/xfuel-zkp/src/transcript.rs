//! Fiat–Shamir transcript over Keccak256 (Ethereum-compatible).
//!
//! Deterministically derives verifier challenges from the prover's messages so the interactive
//! sumcheck becomes non-interactive. Keccak256 is used (not SHA3-256) to stay byte-compatible with
//! the rest of the protocol's on-chain commitments.

use crate::Fr;
use ark_ff::{BigInteger, PrimeField};
use sha3::{Digest, Keccak256};

/// A rolling Keccak256 Fiat–Shamir transcript.
pub struct Transcript {
    state: [u8; 32],
}

impl Transcript {
    /// Start a transcript with a domain separator.
    pub fn new(domain: &[u8]) -> Self {
        let mut h = Keccak256::new();
        h.update(b"xfuel-zkllm-v1");
        h.update(domain);
        let mut state = [0u8; 32];
        state.copy_from_slice(&h.finalize());
        Self { state }
    }

    /// Absorb raw bytes under a label.
    pub fn absorb_bytes(&mut self, label: &[u8], data: &[u8]) {
        let mut h = Keccak256::new();
        h.update(self.state);
        h.update(label);
        h.update(data);
        self.state.copy_from_slice(&h.finalize());
    }

    /// Absorb a field element (little-endian canonical bytes) under a label.
    pub fn absorb_field(&mut self, label: &[u8], f: &Fr) {
        let bytes = f.into_bigint().to_bytes_le();
        self.absorb_bytes(label, &bytes);
    }

    /// Squeeze a field-element challenge under a label (advances the transcript state).
    pub fn challenge(&mut self, label: &[u8]) -> Fr {
        let mut h = Keccak256::new();
        h.update(self.state);
        h.update(label);
        h.update(b"challenge");
        let out = h.finalize();
        self.state.copy_from_slice(&out);
        Fr::from_le_bytes_mod_order(&out)
    }
}

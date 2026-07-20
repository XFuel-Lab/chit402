//! Tests for the PoMA model-commitment helpers — the keccak-Merkle shard root (`KECCAK_MERKLE`) and
//! the per-tensor commitment root (`MLE_POLY`) for the self-owned KZG prover (ADR 0004). The
//! `MLE_POLY` root collapses the many per-tensor commitments a ZK proof opens into the single
//! `bytes32` the on-chain `ModelRegistry` stores, arch-bound identically to the keccak scheme.

use ark_std::{test_rng, UniformRand};
use xfuel_zkp::commitment::{model_commitment, poly_weights_root, weights_root};
use xfuel_zkp::manifest::{ActType, ModelManifest, NormType, PosType};
use xfuel_zkp::{log2_exact, pcs, Fr};

fn tensor(len: usize, rng: &mut impl ark_std::rand::Rng) -> Vec<Fr> {
    (0..len).map(|_| Fr::rand(rng)).collect()
}

fn manifest() -> ModelManifest {
    ModelManifest {
        family: "llama-test".into(),
        n_layers: 1,
        d_model: 4,
        n_heads: 1,
        n_kv_heads: 1,
        d_ff: 8,
        vocab_size: 256,
        norm: NormType::RmsNorm,
        act: ActType::SwiGLU,
        pos: PosType::Rope,
        quant: "q8_0".into(),
    }
}

#[test]
fn poly_weights_root_is_deterministic_order_sensitive_and_zero_on_empty() {
    let leaves = [[1u8; 32], [2u8; 32], [3u8; 32]];
    assert_eq!(poly_weights_root(&leaves), poly_weights_root(&leaves), "deterministic");

    let swapped = [[2u8; 32], [1u8; 32], [3u8; 32]];
    assert_ne!(
        poly_weights_root(&leaves),
        poly_weights_root(&swapped),
        "tensor ordering is significant"
    );

    assert_eq!(poly_weights_root(&[]), [0u8; 32], "empty → zero hash");
}

#[test]
fn single_tensor_poly_root_is_its_own_leaf() {
    let leaf = [7u8; 32];
    assert_eq!(poly_weights_root(&[leaf]), leaf, "a single leaf is its own Merkle root");
}

#[test]
fn poly_root_differs_from_shard_root_for_the_same_count() {
    // The two schemes are distinct commitments even over the same number of items (domain intent:
    // a keccak-Merkle shard root and an MLE_POLY commitment root must never collide by construction).
    let shards = vec![vec![1u8, 2, 3], vec![4u8, 5, 6]];
    let leaves = [[1u8; 32], [2u8; 32]];
    assert_ne!(weights_root(&shards), poly_weights_root(&leaves));
}

#[test]
fn kzg_commitment_leaves_compose_into_a_stable_arch_bound_model_commitment() {
    let mut rng = test_rng();
    let params = pcs::setup(4, &mut rng);
    let (ck, _vk) = pcs::keys(&params, log2_exact(16));

    // Two weight tensors → two KZG commitments → an ordered MLE_POLY weights root.
    let w0 = tensor(16, &mut rng);
    let w1 = tensor(16, &mut rng);
    let root = pcs::model_weights_root(&[pcs::commit(&ck, &w0), pcs::commit(&ck, &w1)]);

    let m = manifest();
    let mc = model_commitment(&root, &m.arch_commitment());
    assert_ne!(mc, [0u8; 32]);

    // Commitments (and thus the root and the model commitment) are deterministic.
    let root_again = pcs::model_weights_root(&[pcs::commit(&ck, &w0), pcs::commit(&ck, &w1)]);
    assert_eq!(root, root_again, "KZG commitment leaves are deterministic");
    assert_eq!(mc, model_commitment(&root_again, &m.arch_commitment()));

    // A downgraded/swapped weight tensor changes the model commitment (the anti-downgrade wedge).
    let w1_alt = tensor(16, &mut rng);
    let root_alt = pcs::model_weights_root(&[pcs::commit(&ck, &w0), pcs::commit(&ck, &w1_alt)]);
    assert_ne!(root, root_alt, "different weights → different MLE_POLY root");
    assert_ne!(mc, model_commitment(&root_alt, &m.arch_commitment()));
}

#[test]
fn arch_binding_changes_the_model_commitment() {
    let mut rng = test_rng();
    let params = pcs::setup(4, &mut rng);
    let (ck, _vk) = pcs::keys(&params, log2_exact(16));
    let root = pcs::model_weights_root(&[pcs::commit(&ck, &tensor(16, &mut rng))]);

    let mut m2 = manifest();
    m2.d_ff = 16; // same weights root, different architecture
    assert_ne!(
        model_commitment(&root, &manifest().arch_commitment()),
        model_commitment(&root, &m2.arch_commitment()),
        "the arch binding must bind the architecture, not just the weights"
    );
}

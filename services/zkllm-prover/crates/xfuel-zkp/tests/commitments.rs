//! Commitment + manifest tests, incl. keccak known-answer anchors for cross-language parity.

use xfuel_zkp::commitment::{
    inference_binding_commitment, keccak256, model_commitment, rail, weights_root, PbrBinding,
};
use xfuel_zkp::manifest::{ActType, ModelManifest, NormType, PosType};

fn to_hex(b: &[u8; 32]) -> String {
    let mut s = String::with_capacity(64);
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}

fn llama() -> ModelManifest {
    ModelManifest {
        family: "llama".into(),
        n_layers: 32,
        d_model: 4096,
        n_heads: 32,
        n_kv_heads: 8,
        d_ff: 14336,
        vocab_size: 128256,
        norm: NormType::RmsNorm,
        act: ActType::SwiGLU,
        pos: PosType::Rope,
        quant: "q4_k_m".into(),
    }
}

#[test]
fn keccak_is_ethereum_keccak_not_sha3() {
    // keccak256("") — the canonical Ethereum keccak empty-string digest.
    assert_eq!(
        to_hex(&keccak256(b"")),
        "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    );
    // keccak256("abc")
    assert_eq!(
        to_hex(&keccak256(b"abc")),
        "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
    );
}

#[test]
fn single_shard_root_is_leaf_hash() {
    let root = weights_root(&[b"abc".to_vec()]);
    assert_eq!(root, keccak256(b"abc"));
}

#[test]
fn arch_commitment_is_deterministic_and_sensitive() {
    let m = llama();
    assert_eq!(m.arch_commitment(), llama().arch_commitment());

    let mut m2 = llama();
    m2.n_kv_heads = 32; // MHA instead of GQA
    assert_ne!(m.arch_commitment(), m2.arch_commitment());

    let mut m3 = llama();
    m3.act = ActType::GeLU;
    assert_ne!(m.arch_commitment(), m3.arch_commitment());
}

#[test]
fn model_commitment_binds_weights_and_arch() {
    let root = weights_root(&[vec![1, 2, 3], vec![4, 5, 6]]);
    let mc = model_commitment(&root, &llama().arch_commitment());

    // Different architecture over the same weights → different model commitment.
    let mut m2 = llama();
    m2.norm = NormType::LayerNorm;
    assert_ne!(mc, model_commitment(&root, &m2.arch_commitment()));

    // Different weights over the same architecture → different model commitment.
    let root2 = weights_root(&[vec![9, 9, 9]]);
    assert_ne!(mc, model_commitment(&root2, &llama().arch_commitment()));
}

#[test]
fn pbr_binding_is_deterministic_and_field_sensitive() {
    let base = PbrBinding {
        payment_ref_hash: keccak256(b"base:0xabc"),
        task_id_hash: keccak256(b"task-1"),
        rail: rail::USDC,
        amount_be: PbrBinding::amount_from_u128(1_000_000),
        model_commitment: model_commitment(&weights_root(&[b"w".to_vec()]), &llama().arch_commitment()),
        output_hash: keccak256(b"output"),
    };
    let c1 = inference_binding_commitment(&base);

    let same = PbrBinding {
        payment_ref_hash: keccak256(b"base:0xabc"),
        task_id_hash: keccak256(b"task-1"),
        rail: rail::USDC,
        amount_be: PbrBinding::amount_from_u128(1_000_000),
        model_commitment: base.model_commitment,
        output_hash: keccak256(b"output"),
    };
    assert_eq!(c1, inference_binding_commitment(&same), "deterministic");

    let diff_amount = PbrBinding { amount_be: PbrBinding::amount_from_u128(2_000_000), ..same_fields(&base) };
    assert_ne!(c1, inference_binding_commitment(&diff_amount), "amount changes commitment");
}

// Helper to clone a PbrBinding's fields (PbrBinding isn't Clone by design — it's a one-shot input).
fn same_fields(b: &PbrBinding) -> PbrBinding {
    PbrBinding {
        payment_ref_hash: b.payment_ref_hash,
        task_id_hash: b.task_id_hash,
        rail: b.rail,
        amount_be: b.amount_be,
        model_commitment: b.model_commitment,
        output_hash: b.output_hash,
    }
}

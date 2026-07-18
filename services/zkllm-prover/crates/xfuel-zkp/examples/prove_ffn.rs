//! Benchmark harness: prove + verify one SwiGLU FFN sub-block (3 matmuls + gating Hadamard)
//! and print timings + the pending lookup obligations.
//!
//! Usage:
//!   cargo run --release --example prove_ffn                 # defaults to seq=64 d_model=512 d_ff=1024
//!   cargo run --release --example prove_ffn 128 1024 4096
//!
//! Dimensions must be powers of two. Use this on a high-RAM host to fill docs/ZKG5_BENCHMARK.md.

use ark_std::{test_rng, UniformRand};
use std::time::Instant;
use xfuel_zkp::ffn::{prove_ffn, verify_ffn, FfnConfig};
use xfuel_zkp::manifest::{ActType, ModelManifest, NormType, PosType};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

fn arg(i: usize, default: usize) -> usize {
    std::env::args().nth(i).and_then(|s| s.parse().ok()).unwrap_or(default)
}

fn main() {
    let (seq, d_model, d_ff) = (arg(1, 64), arg(2, 512), arg(3, 1024));
    assert!(
        seq.is_power_of_two() && d_model.is_power_of_two() && d_ff.is_power_of_two(),
        "dimensions must be powers of two"
    );

    let manifest = ModelManifest {
        family: "llama-bench".into(),
        n_layers: 1,
        d_model: d_model as u32,
        n_heads: 8,
        n_kv_heads: 2,
        d_ff: d_ff as u32,
        vocab_size: 32000,
        norm: NormType::RmsNorm,
        act: ActType::SwiGLU,
        pos: PosType::Rope,
        quant: "q8_0".into(),
    };
    let cfg = FfnConfig::from_manifest(&manifest, seq);

    println!(
        "[xfuel-zkllm] proving  SwiGLU FFN   seq={seq} d_model={d_model} d_ff={d_ff}  (norm={}, act={})",
        cfg.norm_name, cfg.act_name
    );
    let mut rng = test_rng();

    let t = Instant::now();
    let x: Vec<Fr> = (0..seq * d_model).map(|_| Fr::rand(&mut rng)).collect();
    let wgate: Vec<Fr> = (0..d_model * d_ff).map(|_| Fr::rand(&mut rng)).collect();
    let wup: Vec<Fr> = (0..d_model * d_ff).map(|_| Fr::rand(&mut rng)).collect();
    let wdown: Vec<Fr> = (0..d_ff * d_model).map(|_| Fr::rand(&mut rng)).collect();
    let t_setup = t.elapsed();

    let t = Instant::now();
    let (proof, out) = prove_ffn(
        &cfg, &x, &wgate, &wup, &wdown, None, None, None, &mut Transcript::new(b"prove_ffn"),
    );
    let t_prove = t.elapsed();

    let t = Instant::now();
    let ok = verify_ffn(
        &cfg, &x, &wgate, &wup, &wdown, &out, &proof, None, None, None,
        &mut Transcript::new(b"prove_ffn"),
    );
    let t_verify = t.elapsed();

    let proof_elems = proof.p_gate.field_len()
        + proof.p_up.field_len()
        + proof.p_down.field_len()
        + proof.p_had.sumcheck.round_evals.iter().map(|e| e.len()).sum::<usize>()
        + proof.p_had.r.len()
        + 3;

    println!("  setup (weights):      {t_setup:?}");
    println!("  prove (3 matmul + gate hadamard): {t_prove:?}");
    println!("  verify:               {t_verify:?}");
    println!("  proof field elements: {proof_elems}");
    println!("  sound today:          3 matmul proofs + SwiGLU gating (hadamard)");
    print!("  pending obligations:  ");
    for (i, o) in proof.obligations.iter().enumerate() {
        if i > 0 {
            print!(", ");
        }
        print!("{} (len {})", o.op, o.len);
    }
    println!(" — discharged by the lookup argument in M5.2b");
    println!("  verified: {ok}");
    assert!(ok, "self-check failed");
}

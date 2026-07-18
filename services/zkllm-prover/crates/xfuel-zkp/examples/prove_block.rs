//! Benchmark harness: prove + verify one matmul "block" and print timings + proof size.
//!
//! Usage:
//!   cargo run --release --example prove_block           # defaults to 256x256 * 256x256
//!   cargo run --release --example prove_block 512 512 512
//!
//! Dimensions must be powers of two. Use this on a high-RAM host to fill docs/ZKG5_BENCHMARK.md.

use ark_std::{test_rng, UniformRand};
use std::time::Instant;
use xfuel_zkp::matmul::{prove, verify, MatMul};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

fn arg(i: usize, default: usize) -> usize {
    std::env::args().nth(i).and_then(|s| s.parse().ok()).unwrap_or(default)
}

fn main() {
    let (m, k, n) = (arg(1, 256), arg(2, 256), arg(3, 256));
    assert!(
        m.is_power_of_two() && k.is_power_of_two() && n.is_power_of_two(),
        "dimensions must be powers of two"
    );

    println!("[xfuel-zkllm] proving  C = A·B   for  {m}x{k} · {k}x{n}");
    let mut rng = test_rng();

    let t = Instant::now();
    let a: Vec<Fr> = (0..m * k).map(|_| Fr::rand(&mut rng)).collect();
    let b: Vec<Fr> = (0..k * n).map(|_| Fr::rand(&mut rng)).collect();
    let mm = MatMul::new(m, k, n, a.clone(), b.clone());
    let t_build = t.elapsed();

    let t = Instant::now();
    let proof = prove(&mm, &mut Transcript::new(b"prove_block"));
    let t_prove = t.elapsed();

    let t = Instant::now();
    let ok = verify(m, k, n, &a, &b, &mm.c, &proof, &mut Transcript::new(b"prove_block"));
    let t_verify = t.elapsed();

    println!("  build (incl. matmul): {t_build:?}");
    println!("  prove:                {t_prove:?}");
    println!("  verify:               {t_verify:?}");
    println!("  sumcheck rounds (log k): {}", proof.sumcheck.round_evals.len());
    println!("  proof field elements:    {}", proof.field_len());
    println!("  verified: {ok}");
    assert!(ok, "self-check failed");
}

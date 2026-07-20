//! SP1 host for the Tier-3 verifier compat spike.
//!
//! Builds a real single multilinear-KZG opening with the `xfuel-zkp` prover, ships it to the guest as
//! a serialized witness, then (1) **executes** to read the guest cycle count — the spike's headline
//! cost number — and (2) **proves + Groth16-wraps** so the proof is verifiable on Base by the existing
//! `SP1Verifier.sol`. A new guest ⇒ a new `programVKey` (printed here) to register on-chain.
//!
//! Build/run with the SP1 toolchain in Linux/Docker/WSL/AWS (see the spike `README.md`). This does not
//! compile on Windows (sp1-sdk → sp1-jit uses `std::os::fd`), which is why all reusable logic lives in
//! `xfuel-inference-spike-core` (host-testable) and this file is a thin driver.
//!
//! NOTE: the exact sp1-sdk 6.0.2 builder methods (`execute(..).await`, `prove(..).groth16().await`)
//! should be confirmed against the installed SDK when first building in Linux; adjust if the surface
//! differs (mirror `services/sp1-prover/host/src/main.rs`, which uses `.compressed().await`).

use ark_std::{test_rng, UniformRand};
use sp1_sdk::{include_elf, ProverClient, SP1Stdin};
use xfuel_inference_spike_core::{encode_opening, OpeningWitness, SpikeBundle};
use xfuel_zkp::{log2_exact, pcs, Fr};

/// Guest ELF, embedded at compile time by `build.rs` (`sp1_build::build_program`).
const ELF: &[u8] = include_elf!("xfuel-inference-spike-guest");

/// Build a real single KZG opening witness (tensor of `n` field elements, one query point).
fn build_witness(n: usize) -> OpeningWitness {
    let mut rng = test_rng();
    let nv = log2_exact(n);
    let params = pcs::setup(nv, &mut rng);
    let (ck, vk) = pcs::keys(&params, nv);
    let table: Vec<Fr> = (0..n).map(|_| Fr::rand(&mut rng)).collect();
    let comm = pcs::commit(&ck, &table);
    let point: Vec<Fr> = (0..nv).map(|_| Fr::rand(&mut rng)).collect();
    let opening = pcs::open_at(&ck, &table, &point);
    encode_opening(&vk, &comm, &point, opening.value, &opening.proof)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(16);

    let witness = build_witness(n);
    let mut stdin = SP1Stdin::new();
    stdin.write(&witness);

    let client = ProverClient::from_env().await;

    // ── (1) Execute: the headline cost number for C1 vs C2 ──────────────────────
    let (mut public_values, report) = client.execute(ELF, stdin.clone()).await?;
    println!("guest cycles (single KZG opening, n={n}): {}", report.total_instruction_count());
    let bundle: SpikeBundle = public_values.read();
    println!("in-guest verified: {}", bundle.verified);
    println!("bundle digest:     0x{}", hex::encode(bundle.digest));

    // ── (2) Prove + Groth16-wrap for on-chain verification by SP1Verifier.sol ────
    let pk = client.setup(ELF).await?;
    println!("programVKey (register on-chain): {:?}", pk.verifying_key());
    let proof = client.prove(&pk, stdin).groth16().await?;
    client.verify(&proof, pk.verifying_key(), None)?;
    println!("Groth16 proof verified locally — ready for Base SP1Verifier.sol");

    Ok(())
}

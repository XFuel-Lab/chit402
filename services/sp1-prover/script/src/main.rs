use anyhow::Result;
use sp1_sdk::{ProverClient, SP1Stdin};
use std::path::PathBuf;
use std::time::{Duration, Instant};

// ============================================================================
// SP1 DEPOSIT PROVER - LOCAL BENCHMARK SCRIPT
// ============================================================================
// Purpose: Benchmark proof generation with sample data
// Target: <1 second per proof (with optimizations)
// Runs: 5 iterations to measure average performance
// ============================================================================

/// Sample deposit data matching the zkVM program's expected inputs
#[derive(Debug, Clone)]
struct DepositSample {
    name: &'static str,
    description: &'static str,
    
    // Public inputs
    vault_address: [u8; 20],
    net_amount: [u8; 32],
    block_number: u64,
    merkle_root: [u8; 32],
    identity_commitment: [u8; 32],
    
    // Private inputs
    sender_address: [u8; 20],
    gross_amount: [u8; 32],
    fee_amount: [u8; 32],
    block_hash: [u8; 32],
    block_timestamp: u64,
    tx_hash: [u8; 32],
    tx_index: u16,
    merkle_proof: Vec<[u8; 32]>,
    merkle_path_indices: Vec<bool>,
    identity_secret: [u8; 32],
    identity_nullifier: [u8; 32],
    identity_trapdoor: [u8; 32],
}

/// Generate sample test cases
fn generate_samples() -> Vec<DepositSample> {
    vec![
        // Sample 1: Small deposit (0.01 TFUEL = minimum)
        DepositSample {
            name: "small_deposit",
            description: "Minimum deposit (0.01 TFUEL)",
            vault_address: hex_to_address("0000000000000000000000000000000000000001"),
            sender_address: hex_to_address("0000000000000000000000000000000000000002"),
            gross_amount: u128_to_u256(10_000_000_000_000_000), // 0.01 TFUEL
            fee_amount: u128_to_u256(50_000_000_000_000),       // 0.5%
            net_amount: u128_to_u256(9_950_000_000_000_000),    // After fee
            block_number: 12345678,
            block_timestamp: 1737331200,
            tx_index: 0,
            tx_hash: random_hash(1),
            block_hash: random_hash(2),
            merkle_root: random_hash(3),
            merkle_proof: vec![random_hash(4), random_hash(5), random_hash(6)], // 3 levels
            merkle_path_indices: vec![false, true, false],
            identity_secret: random_hash(10),
            identity_nullifier: random_hash(11),
            identity_trapdoor: random_hash(12),
            identity_commitment: random_hash(13),
        },
        
        // Sample 2: Medium deposit (1.0 TFUEL)
        DepositSample {
            name: "medium_deposit",
            description: "Standard deposit (1.0 TFUEL)",
            vault_address: hex_to_address("0000000000000000000000000000000000000001"),
            sender_address: hex_to_address("0000000000000000000000000000000000000003"),
            gross_amount: u128_to_u256(1_000_000_000_000_000_000), // 1.0 TFUEL
            fee_amount: u128_to_u256(5_000_000_000_000_000),       // 0.5%
            net_amount: u128_to_u256(995_000_000_000_000_000),     // After fee
            block_number: 12345679,
            block_timestamp: 1737331260,
            tx_index: 5,
            tx_hash: random_hash(20),
            block_hash: random_hash(21),
            merkle_root: random_hash(22),
            merkle_proof: vec![
                random_hash(23), random_hash(24), random_hash(25), 
                random_hash(26), random_hash(27), random_hash(28),
            ], // 6 levels
            merkle_path_indices: vec![false, true, false, true, false, true],
            identity_secret: random_hash(30),
            identity_nullifier: random_hash(31),
            identity_trapdoor: random_hash(32),
            identity_commitment: random_hash(33),
        },
        
        // Sample 3: Large deposit (100 TFUEL)
        DepositSample {
            name: "large_deposit",
            description: "Large deposit (100 TFUEL)",
            vault_address: hex_to_address("0000000000000000000000000000000000000001"),
            sender_address: hex_to_address("0000000000000000000000000000000000000004"),
            gross_amount: u128_to_u256(100_000_000_000_000_000_000), // 100 TFUEL
            fee_amount: u128_to_u256(500_000_000_000_000_000),       // 0.5%
            net_amount: u128_to_u256(99_500_000_000_000_000_000),    // After fee
            block_number: 12345680,
            block_timestamp: 1737331320,
            tx_index: 42,
            tx_hash: random_hash(40),
            block_hash: random_hash(41),
            merkle_root: random_hash(42),
            merkle_proof: vec![
                random_hash(43), random_hash(44), random_hash(45), random_hash(46),
                random_hash(47), random_hash(48), random_hash(49), random_hash(50),
                random_hash(51), random_hash(52),
            ], // 10 levels
            merkle_path_indices: vec![false, true, false, true, false, true, false, true, false, true],
            identity_secret: random_hash(60),
            identity_nullifier: random_hash(61),
            identity_trapdoor: random_hash(62),
            identity_commitment: random_hash(63),
        },
    ]
}

/// Prepare SP1 stdin from sample data
fn prepare_stdin(sample: &DepositSample) -> SP1Stdin {
    let mut stdin = SP1Stdin::new();
    
    // Write public inputs
    stdin.write(&sample.vault_address);
    stdin.write(&sample.net_amount);
    stdin.write(&sample.block_number);
    stdin.write(&sample.merkle_root);
    stdin.write(&sample.identity_commitment);
    
    // Write private inputs
    stdin.write(&sample.sender_address);
    stdin.write(&sample.gross_amount);
    stdin.write(&sample.fee_amount);
    stdin.write(&sample.block_hash);
    stdin.write(&sample.block_timestamp);
    stdin.write(&sample.tx_hash);
    stdin.write(&sample.tx_index);
    stdin.write(&sample.merkle_proof);
    stdin.write(&sample.merkle_path_indices);
    stdin.write(&sample.identity_secret);
    stdin.write(&sample.identity_nullifier);
    stdin.write(&sample.identity_trapdoor);
    
    stdin
}

/// Benchmark a single proof generation
fn benchmark_proof(
    client: &ProverClient,
    elf: &[u8],
    sample: &DepositSample,
) -> Result<Duration> {
    let stdin = prepare_stdin(sample);
    
    let start = Instant::now();
    let (pk, _vk) = client.setup(elf);
    let _proof = client.prove(&pk, stdin).run()?;
    let duration = start.elapsed();
    
    Ok(duration)
}

/// Run benchmark suite
fn run_benchmarks() -> Result<()> {
    println!("\n╔═══════════════════════════════════════════════════════════════╗");
    println!("║       SP1 DEPOSIT PROVER - PERFORMANCE BENCHMARK             ║");
    println!("╚═══════════════════════════════════════════════════════════════╝\n");
    
    // Load ELF
    println!("📦 Loading ELF binary...");
    let elf_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../program/target/riscv32im-succinct-zkvm-elf/release/deposit-proof-program");
    
    if !elf_path.exists() {
        eprintln!("❌ ERROR: ELF binary not found!");
        eprintln!("   Path: {}", elf_path.display());
        eprintln!("\n   Build the guest program first:");
        eprintln!("   cd program && cargo prove build\n");
        return Err(anyhow::anyhow!("ELF binary not found"));
    }
    
    let elf = std::fs::read(elf_path)?;
    println!("✅ ELF loaded ({} bytes)\n", elf.len());
    
    // Initialize prover client - use network mode if SP1_PRIVATE_KEY is set
    println!("🔧 Initializing SP1 prover client...");
    let client = match std::env::var("SP1_PRIVATE_KEY") {
        Ok(key) if !key.is_empty() => {
            println!("🌐 SP1_PRIVATE_KEY detected - using NETWORK proving mode");
            println!("   Connecting to SP1's distributed proving network...");
            ProverClient::network()
        }
        _ => {
            println!("⚠️  SP1_PRIVATE_KEY not set - using LOCAL/MOCK proving mode");
            println!("   Note: Network mode provides ~150x faster proving (<1s vs 150s)");
            println!("   Set SP1_PRIVATE_KEY to enable: https://app.succinct.xyz");
            ProverClient::new()
        }
    };
    println!("✅ Client ready\n");
    
    // Generate samples
    let samples = generate_samples();
    println!("📊 Generated {} test samples\n", samples.len());
    
    // Benchmark each sample
    let mut all_durations = Vec::new();
    
    for (idx, sample) in samples.iter().enumerate() {
        println!("┌─────────────────────────────────────────────────────────────┐");
        println!("│ Sample {}: {} - {}", idx + 1, sample.name, sample.description);
        println!("└─────────────────────────────────────────────────────────────┘");
        println!("  Merkle proof depth: {} levels", sample.merkle_proof.len());
        println!("  Transaction index: {}", sample.tx_index);
        println!();
        
        let mut sample_durations = Vec::new();
        
        // Run 5 iterations
        for run in 1..=5 {
            print!("  Run {}/5... ", run);
            std::io::Write::flush(&mut std::io::stdout())?;
            
            match benchmark_proof(&client, &elf, sample) {
                Ok(duration) => {
                    let secs = duration.as_secs_f64();
                    sample_durations.push(duration);
                    all_durations.push(duration);
                    
                    if secs < 1.0 {
                        println!("✅ {:.3}s", secs);
                    } else if secs < 2.0 {
                        println!("⚠️  {:.3}s (>1s target)", secs);
                    } else {
                        println!("❌ {:.3}s (SLOW!)", secs);
                    }
                }
                Err(e) => {
                    println!("❌ ERROR: {}", e);
                    return Err(e);
                }
            }
        }
        
        // Calculate statistics
        let avg = sample_durations.iter().sum::<Duration>() / sample_durations.len() as u32;
        let min = sample_durations.iter().min().unwrap();
        let max = sample_durations.iter().max().unwrap();
        
        println!("\n  📈 Statistics:");
        println!("     Average: {:.3}s", avg.as_secs_f64());
        println!("     Min:     {:.3}s", min.as_secs_f64());
        println!("     Max:     {:.3}s", max.as_secs_f64());
        println!();
    }
    
    // Overall statistics
    println!("╔═══════════════════════════════════════════════════════════════╗");
    println!("║                    OVERALL RESULTS                            ║");
    println!("╚═══════════════════════════════════════════════════════════════╝\n");
    
    let total_runs = all_durations.len();
    let avg_all = all_durations.iter().sum::<Duration>() / total_runs as u32;
    let min_all = all_durations.iter().min().unwrap();
    let max_all = all_durations.iter().max().unwrap();
    
    let under_1s = all_durations.iter().filter(|d| d.as_secs_f64() < 1.0).count();
    let under_2s = all_durations.iter().filter(|d| d.as_secs_f64() < 2.0).count();
    
    println!("  Total runs:      {}", total_runs);
    println!("  Average time:    {:.3}s", avg_all.as_secs_f64());
    println!("  Min time:        {:.3}s", min_all.as_secs_f64());
    println!("  Max time:        {:.3}s", max_all.as_secs_f64());
    println!();
    println!("  Runs < 1s:       {} / {} ({:.0}%)", 
        under_1s, total_runs, (under_1s as f64 / total_runs as f64) * 100.0);
    println!("  Runs < 2s:       {} / {} ({:.0}%)", 
        under_2s, total_runs, (under_2s as f64 / total_runs as f64) * 100.0);
    println!();
    
    // Performance verdict
    if avg_all.as_secs_f64() < 1.0 {
        println!("✅ VERDICT: Excellent performance! Meeting <1s target.");
    } else if avg_all.as_secs_f64() < 2.0 {
        println!("⚠️  VERDICT: Good, but could be optimized to meet <1s target.");
        println!("\n💡 OPTIMIZATION SUGGESTIONS:");
        println!("   1. Reduce Merkle proof depth (currently up to {} levels)", 
            samples.iter().map(|s| s.merkle_proof.len()).max().unwrap());
        println!("   2. Optimize field arithmetic in guest program");
        println!("   3. Use SP1 precompiles for Poseidon hash");
        println!("   4. Enable GPU acceleration (add CUDA support)");
    } else {
        println!("❌ VERDICT: Performance needs optimization!");
        println!("\n🔧 CRITICAL OPTIMIZATIONS NEEDED:");
        println!("   1. Replace XOR hash stub with SP1 Poseidon precompile");
        println!("   2. Reduce constraint count in guest program");
        println!("   3. Minimize Merkle proof depth");
        println!("   4. Enable GPU acceleration");
        println!("   5. Profile with 'cargo prove bench' for bottlenecks");
    }
    
    println!();
    Ok(())
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn hex_to_address(hex: &str) -> [u8; 20] {
    let mut addr = [0u8; 20];
    hex::decode_to_slice(hex, &mut addr).expect("Invalid hex");
    addr
}

fn u128_to_u256(value: u128) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(&value.to_le_bytes());
    bytes
}

fn random_hash(seed: u8) -> [u8; 32] {
    let mut hash = [0u8; 32];
    for i in 0..32 {
        hash[i] = seed.wrapping_add(i as u8).wrapping_mul(7);
    }
    hash
}

// ============================================================================
// MAIN
// ============================================================================

fn main() {
    match run_benchmarks() {
        Ok(_) => {
            println!("✅ Benchmark completed successfully!\n");
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("\n❌ Benchmark failed: {}\n", e);
            std::process::exit(1);
        }
    }
}

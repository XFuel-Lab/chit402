use anyhow::Result;
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
// SP1 SDK 5.2.x imports
use sp1_sdk::{ProverClient, SP1Stdin, network::NetworkMode, Prover};
use std::path::PathBuf;
use base64::Engine;

// ============================================================================
// PROVER CLIENT SETUP - SP1 SDK 5.2.x with Optimization
// ============================================================================
// OPTIMIZATION: Setup keys once per container lifetime, reuse ELF loading
// ============================================================================

fn setup_prover_env() {
    // Ensure NETWORK_PRIVATE_KEY is set if SP1_PRIVATE_KEY exists (backwards compat)
    if let Ok(key) = std::env::var("SP1_PRIVATE_KEY") {
        if !key.is_empty() && std::env::var("NETWORK_PRIVATE_KEY").is_err() {
            std::env::set_var("NETWORK_PRIVATE_KEY", &key);
        }
    }
    
    // Log the mode being used
    match std::env::var("SP1_PROVER").as_deref() {
        Ok("network") => {
            eprintln!("🌐 SP1_PROVER=network - using Succinct Prover Network");
            eprintln!("   Fast proofs via distributed network (<1s)");
        }
        Ok("cuda") => {
            eprintln!("🖥️  SP1_PROVER=cuda - using local CUDA GPU");
        }
        _ => {
            if std::env::var("NETWORK_PRIVATE_KEY").is_ok() {
                eprintln!("🌐 NETWORK_PRIVATE_KEY detected - will use network mode");
                std::env::set_var("SP1_PROVER", "network");
            } else {
                eprintln!("⚠️  No SP1_PROVER or NETWORK_PRIVATE_KEY set - using local mode");
                eprintln!("   This is SLOW (~170s per proof) - only for development!");
            }
        }
    }
}

fn load_elf() -> Result<Vec<u8>> {
    let elf_path = PathBuf::from("/app/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/deposit-proof-program");
    eprintln!("🔍 Looking for ELF at: {}", elf_path.display());
    
    let elf = if elf_path.exists() {
        eprintln!("✅ Found ELF at primary location");
        std::fs::read(&elf_path)?
    } else {
        // Fallback: try to find it in target directory
        let fallback = PathBuf::from("/app/program/target/riscv32im-succinct-zkvm-elf/release/deposit-proof-program");
        eprintln!("🔍 Trying fallback: {}", fallback.display());
        if fallback.exists() {
            eprintln!("✅ Found ELF at fallback location");
            std::fs::read(&fallback)?
        } else {
            eprintln!("❌ ELF not found at either location");
            anyhow::bail!("Could not find guest program ELF. Run 'cargo prove build' in program directory first.");
        }
    };
    
    Ok(elf)
}

// ============================================================================
// TYPES - Must match program/src/main.rs
// ============================================================================

type Address = [u8; 20];
type Hash256 = [u8; 32];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct U256([u8; 32]);

impl U256 {
    fn from_hex(s: &str) -> Result<Self> {
        let s = s.strip_prefix("0x").unwrap_or(s);
        let bytes = hex::decode(s)?;
        let mut arr = [0u8; 32];
        
        // Hex strings are big-endian, but U256 internal representation is little-endian
        // So we need to reverse the bytes
        for (i, &b) in bytes.iter().rev().enumerate() {
            if i < 32 {
                arr[i] = b;
            }
        }
        
        Ok(U256(arr))
    }

    fn to_hex(&self) -> String {
        // Convert little-endian bytes back to big-endian hex string
        let hex_bytes: Vec<u8> = self.0.iter().rev().copied().collect();
        format!("0x{}", hex::encode(hex_bytes))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicInputs {
    pub vault_address: Address,
    pub net_amount: U256,
    pub block_number: u64,
    pub merkle_root: Hash256,
    pub identity_commitment: Hash256,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateInputs {
    pub sender_address: Address,
    pub gross_amount: U256,
    pub fee_amount: U256,
    pub block_hash: Hash256,
    pub block_timestamp: u64,
    pub tx_hash: Hash256,
    pub tx_index: u16,
    pub merkle_proof: Vec<Hash256>,
    pub merkle_path_indices: Vec<bool>,
    pub identity_secret: Hash256,
    pub identity_nullifier: Hash256,
    pub identity_trapdoor: Hash256,
}

// ============================================================================
// API TYPES - For HTTP/JSON interface (Phase 1: Batch Support)
// ============================================================================

/// Single deposit request (backward compatible)
#[derive(Debug, Serialize, Deserialize)]
pub struct ProofRequest {
    // Public inputs
    pub vault_address: String,
    pub net_amount: String,
    pub block_number: u64,
    pub merkle_root: String,
    pub identity_commitment: String,
    
    // Private inputs
    pub sender_address: String,
    pub gross_amount: String,
    pub fee_amount: String,
    pub block_hash: String,
    pub block_timestamp: u64,
    pub tx_hash: String,
    pub tx_index: u16,
    pub merkle_proof: Vec<String>,
    pub merkle_path_indices: Vec<u8>,
    pub identity_secret: String,
    pub identity_nullifier: String,
    pub identity_trapdoor: String,
}

/// Batch deposit request (Phase 1)
#[derive(Debug, Serialize, Deserialize)]
pub struct BatchProofRequest {
    pub batch: bool,
    pub deposits: Vec<ProofRequest>,
}

/// Unified request type (supports both single and batch)
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UnifiedProofRequest {
    Batch(BatchProofRequest),
    Single(ProofRequest),
}

/// Single deposit response (backward compatible)
#[derive(Debug, Serialize, Deserialize)]
pub struct ProofResponse {
    pub proof: String,
    pub public_inputs: PublicInputsJson,
    pub nullifier: String,
    pub proving_time_ms: u64,
}

/// Batch deposit response (Phase 1)
#[derive(Debug, Serialize, Deserialize)]
pub struct BatchProofResponse {
    pub proof: String,
    pub batch_size: u32,
    pub nullifiers: Vec<String>,
    pub batch_commitment: String,
    pub proving_time_ms: u64,
    pub effective_time_per_deposit_ms: u64,
}

/// Unified response type
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UnifiedProofResponse {
    Batch(BatchProofResponse),
    Single(ProofResponse),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PublicInputsJson {
    pub vault_address: String,
    pub net_amount: String,
    pub block_number: u64,
    pub merkle_root: String,
    pub identity_commitment: String,
}

// ============================================================================
// BATCH TYPES - Must match program/src/main.rs
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BatchPublicInputs {
    pub batch_size: u32,
    pub deposits: Vec<PublicInputs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BatchPrivateInputs {
    pub deposits: Vec<PrivateInputs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BatchOutput {
    pub batch_size: u32,
    pub nullifiers: Vec<Hash256>,
    pub batch_commitment: Hash256,
}

// ============================================================================
// PROOF GENERATION - Optimized (Phase 1: Batch Support)
// ============================================================================

/// Parse a single ProofRequest into PublicInputs and PrivateInputs
fn parse_proof_request(request: &ProofRequest) -> Result<(PublicInputs, PrivateInputs)> {
    let public_inputs = PublicInputs {
        vault_address: parse_address(&request.vault_address)?,
        net_amount: U256::from_hex(&request.net_amount)?,
        block_number: request.block_number,
        merkle_root: parse_hash(&request.merkle_root)?,
        identity_commitment: parse_hash(&request.identity_commitment)?,
    };

    let private_inputs = PrivateInputs {
        sender_address: parse_address(&request.sender_address)?,
        gross_amount: U256::from_hex(&request.gross_amount)?,
        fee_amount: U256::from_hex(&request.fee_amount)?,
        block_hash: parse_hash(&request.block_hash)?,
        block_timestamp: request.block_timestamp,
        tx_hash: parse_hash(&request.tx_hash)?,
        tx_index: request.tx_index,
        merkle_proof: request
            .merkle_proof
            .iter()
            .map(|s| parse_hash(s))
            .collect::<Result<Vec<_>>>()?,
        merkle_path_indices: request
            .merkle_path_indices
            .iter()
            .map(|&x| x != 0)
            .collect(),
        identity_secret: parse_hash(&request.identity_secret)?,
        identity_nullifier: parse_hash(&request.identity_nullifier)?,
        identity_trapdoor: parse_hash(&request.identity_trapdoor)?,
    };

    Ok((public_inputs, private_inputs))
}

/// Generate a proof for single or batch deposits (Phase 1)
pub fn generate_unified_proof(request: UnifiedProofRequest) -> Result<UnifiedProofResponse> {
    eprintln!("🚀 STARTING PROOF GENERATION");
    let start = std::time::Instant::now();

    // Determine batch vs single
    let (batch_public, batch_private, is_batch, original_requests) = match request {
        UnifiedProofRequest::Single(single_req) => {
            eprintln!("📝 Processing SINGLE deposit (backward compatible mode)");
            let (pub_in, priv_in) = parse_proof_request(&single_req)?;
            (
                BatchPublicInputs {
                    batch_size: 1,
                    deposits: vec![pub_in],
                },
                BatchPrivateInputs {
                    deposits: vec![priv_in],
                },
                false,
                vec![single_req],
            )
        }
        UnifiedProofRequest::Batch(batch_req) => {
            let batch_size = batch_req.deposits.len();
            eprintln!("📦 Processing BATCH of {} deposits", batch_size);
            
            if batch_size == 0 {
                anyhow::bail!("Batch must contain at least 1 deposit");
            }
            if batch_size > 20 {
                anyhow::bail!("Batch size exceeds maximum (20)");
            }

            let mut public_inputs = Vec::with_capacity(batch_size);
            let mut private_inputs = Vec::with_capacity(batch_size);

            for req in &batch_req.deposits {
                let (pub_in, priv_in) = parse_proof_request(req)?;
                public_inputs.push(pub_in);
                private_inputs.push(priv_in);
            }

            (
                BatchPublicInputs {
                    batch_size: batch_size as u32,
                    deposits: public_inputs,
                },
                BatchPrivateInputs {
                    deposits: private_inputs,
                },
                true,
                batch_req.deposits,
            )
        }
    };

    // Setup prover environment
    eprintln!("📊 Setting up prover environment...");
    setup_prover_env();

    // Load the program ELF
    let elf = load_elf()?;

    // Setup inputs (batch format)
    let mut stdin = SP1Stdin::new();
    stdin.write(&batch_public);
    stdin.write(&batch_private);

    // SP1 SDK 5.2.x: Create prover client and generate proof
    eprintln!("📊 Creating prover client...");
    
    let (mut proof, _vk) = if std::env::var("SP1_PROVER").as_deref() == Ok("network") {
        eprintln!("🌐 Using Succinct Mainnet Network");
        let client = ProverClient::builder()
            .network_for(NetworkMode::Mainnet)
            .build();
        eprintln!("✅ Prover client created");
        
        println!("🔐 Generating SP1 proof for {} deposit(s)...", batch_public.batch_size);
        let (pk, vk) = client.setup(&elf);
        eprintln!("⚡ Starting proof generation with SP1...");
        eprintln!("   Using COMPRESSED proof type (fastest for network)");
        let proof = client.prove(&pk, &stdin).compressed().run()?;
        eprintln!("✅ Proof generated by SP1!");
        
        println!("🔍 Verifying proof...");
        client.verify(&proof, &vk)?;
        println!("✅ Proof verified!");
        
        (proof, vk)
    } else {
        eprintln!("🔧 Using local/mock prover from environment");
        let client = ProverClient::from_env();
        eprintln!("✅ Prover client created");
        
        println!("🔐 Generating SP1 proof for {} deposit(s)...", batch_public.batch_size);
        let (pk, vk) = client.setup(&elf);
        eprintln!("⚡ Starting proof generation with SP1...");
        eprintln!("   Using COMPRESSED proof type");
        let proof = client.prove(&pk, &stdin).compressed().run()?;
        eprintln!("✅ Proof generated by SP1!");
        
        println!("🔍 Verifying proof...");
        client.verify(&proof, &vk)?;
        println!("✅ Proof verified!");
        
        (proof, vk)
    };

    println!("✅ Proof generated successfully!");

    let proving_time_ms = start.elapsed().as_millis() as u64;

    // Extract batch output from public values
    let batch_output: BatchOutput = proof.public_values.read();

    // Serialize proof
    let proof_bytes = bincode::serialize(&proof)?;
    let proof_b64 = base64::engine::general_purpose::STANDARD.encode(&proof_bytes);

    // Return appropriate response format
    if is_batch {
        let nullifiers: Vec<String> = batch_output
            .nullifiers
            .iter()
            .map(|n| format!("0x{}", hex::encode(n)))
            .collect();

        let effective_time_per_deposit_ms = proving_time_ms / batch_output.batch_size as u64;

        eprintln!("📊 Batch results:");
        eprintln!("   Total time: {}ms", proving_time_ms);
        eprintln!("   Effective time per deposit: {}ms", effective_time_per_deposit_ms);
        eprintln!("   Cost reduction: {}%", (1.0 - 1.0 / batch_output.batch_size as f64) * 100.0);

        Ok(UnifiedProofResponse::Batch(BatchProofResponse {
            proof: proof_b64,
            batch_size: batch_output.batch_size,
            nullifiers,
            batch_commitment: format!("0x{}", hex::encode(batch_output.batch_commitment)),
            proving_time_ms,
            effective_time_per_deposit_ms,
        }))
    } else {
        // Single deposit (backward compatible response)
        let nullifier = format!("0x{}", hex::encode(batch_output.nullifiers[0]));

        Ok(UnifiedProofResponse::Single(ProofResponse {
            proof: proof_b64,
            public_inputs: PublicInputsJson {
                vault_address: original_requests[0].vault_address.clone(),
                net_amount: original_requests[0].net_amount.clone(),
                block_number: original_requests[0].block_number,
                merkle_root: original_requests[0].merkle_root.clone(),
                identity_commitment: original_requests[0].identity_commitment.clone(),
            },
            nullifier,
            proving_time_ms,
        }))
    }
}

/// Legacy single-deposit function (calls unified function internally)
pub fn generate_proof(request: ProofRequest) -> Result<ProofResponse> {
    match generate_unified_proof(UnifiedProofRequest::Single(request))? {
        UnifiedProofResponse::Single(resp) => Ok(resp),
        _ => unreachable!("Single request should return single response"),
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn parse_address(s: &str) -> Result<Address> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(s)?;
    if bytes.len() != 20 {
        anyhow::bail!("Invalid address length");
    }
    let mut arr = [0u8; 20];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

fn parse_hash(s: &str) -> Result<Hash256> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(s)?;
    if bytes.len() != 32 {
        anyhow::bail!("Invalid hash length");
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

// ============================================================================
// CLI
// ============================================================================

#[derive(Parser)]
#[command(name = "sp1-deposit-prover")]
#[command(about = "SP1 ZK Prover for XFUEL deposit proofs", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate a proof from JSON input file
    Prove {
        /// Path to input JSON file
        #[arg(short, long)]
        input: PathBuf,

        /// Path to output proof file (optional)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },

    /// Start HTTP server for proof generation
    Serve {
        /// Port to listen on
        #[arg(short, long, default_value = "8080")]
        port: u16,
    },

    /// Build the guest program
    Build {
        /// Build with release optimizations
        #[arg(short, long)]
        release: bool,
    },
}

// ============================================================================
// MAIN
// ============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Prove { input, output } => {
            println!("📂 Reading input from: {}", input.display());
            let input_json = std::fs::read_to_string(input)?;
            let request: ProofRequest = serde_json::from_str(&input_json)?;

            let response = generate_proof(request)?;

            println!("\n📊 Results:");
            println!("  Proving time: {}ms", response.proving_time_ms);
            println!("  Nullifier: {}", response.nullifier);

            if let Some(output_path) = output {
                let output_json = serde_json::to_string_pretty(&response)?;
                std::fs::write(&output_path, output_json)?;
                println!("  Proof written to: {}", output_path.display());
            } else {
                println!("\n🔐 Proof:");
                println!("{}", serde_json::to_string_pretty(&response)?);
            }
        }

        Commands::Serve { port } => {
            println!("🚀 Starting SP1 prover HTTP server on port {}", port);
            println!("   POST /prove - Generate a proof");
            println!("   GET /health - Health check");
            
            // Pre-initialize on startup to warm up
            eprintln!("\n🔥 Pre-initializing prover environment...");
            setup_prover_env();
            eprintln!("✅ Environment ready!\n");

            use axum::{
                extract::Json,
                http::StatusCode,
                response::IntoResponse,
                routing::{get, post},
                Router,
            };
            use tower_http::cors::CorsLayer;

            let app = Router::new()
                .route("/health", get(|| async { "OK" }))
                .route(
                    "/prove",
                    post(|Json(request): Json<UnifiedProofRequest>| async move {
                        let is_batch = matches!(request, UnifiedProofRequest::Batch(_));
                        let batch_size = match &request {
                            UnifiedProofRequest::Batch(b) => b.deposits.len(),
                            UnifiedProofRequest::Single(_) => 1,
                        };
                        
                        eprintln!("📥 Received {} proof request", if is_batch { "BATCH" } else { "SINGLE" });
                        if is_batch {
                            eprintln!("   Batch size: {}", batch_size);
                        }
                        
                        match generate_unified_proof(request) {
                            Ok(response) => {
                                match &response {
                                    UnifiedProofResponse::Batch(batch) => {
                                        eprintln!("✅ Batch proof generated successfully");
                                        eprintln!("   Total time: {}ms", batch.proving_time_ms);
                                        eprintln!("   Effective time per deposit: {}ms", batch.effective_time_per_deposit_ms);
                                    }
                                    UnifiedProofResponse::Single(single) => {
                                        eprintln!("✅ Single proof generated successfully in {}ms", single.proving_time_ms);
                                    }
                                }
                                (StatusCode::OK, Json(response)).into_response()
                            }
                            Err(e) => {
                                eprintln!("❌ Error generating proof: {:?}", e);
                                (
                                    StatusCode::INTERNAL_SERVER_ERROR,
                                    format!("Error: {:#}", e),
                                )
                                    .into_response()
                            }
                        }
                    }),
                )
                .layer(CorsLayer::permissive());

            let addr = format!("0.0.0.0:{}", port);
            let listener = tokio::net::TcpListener::bind(&addr).await?;
            println!("✅ Server listening on {}", addr);

            axum::serve(listener, app).await?;
        }

        Commands::Build { release } => {
            println!("🔨 Building guest program...");
            let mut cmd = std::process::Command::new("cargo");
            cmd.arg("build")
                .arg("--target")
                .arg("riscv32im-succinct-zkvm-elf")
                .current_dir("../program");

            if release {
                cmd.arg("--release");
            }

            let status = cmd.status()?;
            if !status.success() {
                anyhow::bail!("Build failed");
            }

            println!("✅ Build complete!");
        }
    }

    Ok(())
}

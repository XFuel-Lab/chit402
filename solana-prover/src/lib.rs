#[cfg(not(feature = "no-entrypoint"))]
mod entry;

#[cfg(test)]
mod tests;

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

// ────────────────────────────────────────────────────────────────
// Program ID
// ────────────────────────────────────────────────────────────────
// Generated at deploy time. Update after running:
//   solana-keygen pubkey solana-prover/deploy/program-keypair.json
// TODO(mainnet): Generate real keypair: solana-keygen grind --starts-with Xfue:1
//   Then: solana-keygen pubkey solana-prover/deploy/program-keypair.json
solana_program::declare_id!("Xfue111111111111111111111111111111111111111");

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

pub const MAX_LABEL_LEN: usize = 64;
pub const MAX_CIRCUITS: u32 = 256;
pub const MAX_BATCH_SIZE: u8 = 10;
pub const GROTH16_PROOF_LEN: usize = 256; // A(64) + B(128) + C(64)
pub const MAX_PUBLIC_INPUTS: usize = 16;
pub const VK_BASE_LEN: usize = 384; // alpha(64) + beta(128) + gamma(128) + delta(128)
pub const MAX_VK_LEN: usize = VK_BASE_LEN + (MAX_PUBLIC_INPUTS + 1) * 64;

pub const VERIFIER_STATE_SEED: &[u8] = b"xfuel_verifier";
pub const CIRCUIT_SEED: &[u8] = b"circuit";
pub const NULLIFIER_SEED: &[u8] = b"nullifier";

// Wormhole chain IDs for bridge events
pub const WORMHOLE_CHAIN_SOLANA: u16 = 1;
pub const WORMHOLE_CHAIN_ETHEREUM: u16 = 2;
pub const WORMHOLE_CHAIN_THETA: u16 = 25;

// ────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum XfuelError {
    InvalidInstructionData = 1000,
    Unauthorized = 1001,
    Paused = 1002,
    CircuitAlreadyRegistered = 1003,
    CircuitNotFound = 1004,
    CircuitRegistryFull = 1005,
    NullifierAlreadyUsed = 1006,
    ProofVerificationFailed = 1007,
    InvalidProofLength = 1008,
    InvalidPublicInputs = 1009,
    InvalidVerifyingKey = 1010,
    BatchTooLarge = 1011,
    InvalidPDA = 1012,
}

impl From<XfuelError> for ProgramError {
    fn from(e: XfuelError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

impl std::fmt::Display for XfuelError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl std::error::Error for XfuelError {}

// ────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────

/// Global verifier configuration (PDA: seeds = [b"xfuel_verifier"])
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct VerifierState {
    pub discriminator: u8,
    pub admin: Pubkey,
    pub mock_mode: bool,
    pub paused: bool,
    pub circuit_count: u32,
    pub total_verified: u64,
    pub total_failed: u64,
    pub total_relayed: u64,
    pub bump: u8,
}

impl VerifierState {
    pub const DISCRIMINATOR: u8 = 0x01;
    pub const LEN: usize = 1 + 32 + 1 + 1 + 4 + 8 + 8 + 8 + 1; // 64
}

/// Per-circuit configuration (PDA: seeds = [b"circuit", circuit_id])
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct CircuitConfig {
    pub discriminator: u8,
    pub circuit_id: [u8; 32],
    pub program_vkey: [u8; 32],
    pub label: String,
    pub vk_data: Vec<u8>,
    pub nr_public_inputs: u8,
    pub is_active: bool,
    pub verified_count: u64,
    pub bump: u8,
}

impl CircuitConfig {
    pub const DISCRIMINATOR: u8 = 0x02;

    pub fn space(label_len: usize, vk_len: usize) -> usize {
        // 1 + 32 + 32 + (4+label) + (4+vk) + 1 + 1 + 8 + 1
        84 + label_len + vk_len
    }
}

/// Nullifier record (PDA: seeds = [b"nullifier", nullifier_hash])
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct NullifierRecord {
    pub discriminator: u8,
    pub nullifier: [u8; 32],
    pub circuit_id: [u8; 32],
    pub verifier: Pubkey,
    pub timestamp: i64,
    pub bump: u8,
}

impl NullifierRecord {
    pub const DISCRIMINATOR: u8 = 0x03;
    pub const LEN: usize = 1 + 32 + 32 + 32 + 8 + 1; // 106
}

// ────────────────────────────────────────────────────────────────
// Instructions
// ────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum XfuelInstruction {
    /// Initialize the verifier state PDA.
    /// Accounts: [signer(admin), verifier_state(PDA,w), system_program]
    Initialize {
        mock_mode: bool,
    },

    /// Register a circuit with its SP1 program VKey and Groth16 verifying key.
    /// Accounts: [signer(admin), verifier_state(PDA,w), circuit(PDA,w), system_program]
    RegisterCircuit {
        circuit_id: [u8; 32],
        program_vkey: [u8; 32],
        label: String,
        vk_data: Vec<u8>,
        nr_public_inputs: u8,
    },

    /// Remove a circuit from the registry. Closes the account.
    /// Accounts: [signer(admin), verifier_state(PDA,w), circuit(PDA,w)]
    RemoveCircuit {
        circuit_id: [u8; 32],
    },

    /// Verify a single SP1 Groth16 proof. Creates a nullifier PDA for replay protection.
    /// Accounts: [signer(verifier), verifier_state(PDA,w), circuit(PDA,w),
    ///            nullifier(PDA,w), system_program, clock_sysvar]
    VerifyProof {
        circuit_id: [u8; 32],
        proof: Vec<u8>,
        public_values: Vec<u8>,
        nullifier: [u8; 32],
    },

    /// Emit a cross-chain bridge event for Wormhole relay.
    /// Accounts: [signer(relayer), verifier_state(PDA,w)]
    EmitBridgeEvent {
        circuit_id: [u8; 32],
        nullifier: [u8; 32],
        target_chain: u16,
        payload: Vec<u8>,
    },

    /// Pause or unpause the verifier.
    /// Accounts: [signer(admin), verifier_state(PDA,w)]
    SetPaused {
        paused: bool,
    },

    /// Toggle mock mode (admin only).
    /// Accounts: [signer(admin), verifier_state(PDA,w)]
    SetMockMode {
        mock_mode: bool,
    },
}

// ────────────────────────────────────────────────────────────────
// BN254 Groth16 Verification (alt_bn128 syscall)
// ────────────────────────────────────────────────────────────────

pub mod bn254 {
    use solana_program::program_error::ProgramError;

    const FIELD_MODULUS: [u8; 32] = [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
        0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
        0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
        0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
    ];

    const ALT_BN128_ADD: u64 = 0;
    const ALT_BN128_MUL: u64 = 1;
    const ALT_BN128_PAIRING: u64 = 2;

    #[cfg(target_os = "solana")]
    extern "C" {
        fn sol_alt_bn128_group_op(
            group_op: u64,
            input: *const u8,
            input_size: u64,
            result: *mut u8,
        ) -> u64;
    }

    #[cfg(target_os = "solana")]
    fn alt_bn128_op(op: u64, input: &[u8], output: &mut [u8]) -> Result<(), ProgramError> {
        let result = unsafe {
            sol_alt_bn128_group_op(op, input.as_ptr(), input.len() as u64, output.as_mut_ptr())
        };
        if result != 0 {
            return Err(ProgramError::InvalidArgument);
        }
        Ok(())
    }

    #[cfg(not(target_os = "solana"))]
    fn alt_bn128_op(op: u64, _input: &[u8], output: &mut [u8]) -> Result<(), ProgramError> {
        output.iter_mut().for_each(|b| *b = 0);
        if op == ALT_BN128_PAIRING && output.len() >= 32 {
            output[31] = 1; // mock: pairing always succeeds
        }
        Ok(())
    }

    /// Negate a G1 point on BN254: -P = (P.x, field_prime - P.y)
    pub fn negate_g1(point: &[u8; 64]) -> [u8; 64] {
        let mut result = [0u8; 64];
        result[..32].copy_from_slice(&point[..32]);

        if point[32..64].iter().all(|&b| b == 0) {
            return result; // point at infinity
        }

        let mut borrow: u16 = 0;
        for i in (0..32usize).rev() {
            let a = FIELD_MODULUS[i] as u16;
            let b = point[32 + i] as u16 + borrow;
            if a >= b {
                result[32 + i] = (a - b) as u8;
                borrow = 0;
            } else {
                result[32 + i] = (256 + a - b) as u8;
                borrow = 1;
            }
        }
        result
    }

    /// EC point addition on G1 (alt_bn128 precompile)
    pub fn ec_add(a: &[u8; 64], b: &[u8; 64]) -> Result<[u8; 64], ProgramError> {
        let mut input = [0u8; 128];
        input[..64].copy_from_slice(a);
        input[64..].copy_from_slice(b);
        let mut output = [0u8; 64];
        alt_bn128_op(ALT_BN128_ADD, &input, &mut output)?;
        Ok(output)
    }

    /// EC scalar multiplication on G1 (alt_bn128 precompile)
    pub fn ec_mul(point: &[u8; 64], scalar: &[u8; 32]) -> Result<[u8; 64], ProgramError> {
        let mut input = [0u8; 96];
        input[..64].copy_from_slice(point);
        input[64..].copy_from_slice(scalar);
        let mut output = [0u8; 64];
        alt_bn128_op(ALT_BN128_MUL, &input, &mut output)?;
        Ok(output)
    }

    /// Pairing check: returns true if product of pairings == 1
    pub fn ec_pairing(pairs: &[u8]) -> Result<bool, ProgramError> {
        if pairs.len() % 192 != 0 {
            return Err(ProgramError::InvalidArgument);
        }
        let mut output = [0u8; 32];
        alt_bn128_op(ALT_BN128_PAIRING, pairs, &mut output)?;
        Ok(output[31] == 1 && output[..31].iter().all(|&b| b == 0))
    }

    /// Full Groth16 verification on BN254.
    ///
    /// Verification equation (pairing check):
    ///   e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
    ///
    /// Where vk_x = IC[0] + sum(public_input[i] * IC[i+1])
    ///
    /// Proof layout (256 bytes):
    ///   [0..64]    proof_a  (G1, uncompressed)
    ///   [64..192]  proof_b  (G2, uncompressed)
    ///   [192..256] proof_c  (G1, uncompressed)
    ///
    /// VK layout:
    ///   [0..64]    alpha_g1  (G1)
    ///   [64..192]  beta_g2   (G2)
    ///   [192..320] gamma_g2  (G2)
    ///   [320..448] delta_g2  (G2)
    ///   [448..]    ic[]      (G1 points, nr_inputs+1 elements)
    ///
    /// Target: <200K CU via alt_bn128 syscall (DePIN TPS optimization)
    pub fn verify_groth16(
        proof: &[u8],
        public_inputs: &[[u8; 32]],
        vk_data: &[u8],
        nr_inputs: usize,
    ) -> Result<bool, ProgramError> {
        if proof.len() != 256 {
            return Err(ProgramError::InvalidArgument);
        }
        let expected_vk_len = 448 + (nr_inputs + 1) * 64;
        if vk_data.len() < expected_vk_len {
            return Err(ProgramError::InvalidArgument);
        }
        if public_inputs.len() != nr_inputs {
            return Err(ProgramError::InvalidArgument);
        }

        let proof_a: &[u8; 64] = proof[0..64].try_into().unwrap();
        let proof_b: &[u8; 128] = proof[64..192].try_into().unwrap();
        let proof_c: &[u8; 64] = proof[192..256].try_into().unwrap();

        let alpha_g1: &[u8; 64] = vk_data[0..64].try_into().unwrap();
        let beta_g2: &[u8; 128] = vk_data[64..192].try_into().unwrap();
        let gamma_g2: &[u8; 128] = vk_data[192..320].try_into().unwrap();
        let delta_g2: &[u8; 128] = vk_data[320..448].try_into().unwrap();

        // Compute vk_x = IC[0] + sum(input[i] * IC[i+1])
        let ic_offset = 448;
        let mut vk_x: [u8; 64] = vk_data[ic_offset..ic_offset + 64].try_into().unwrap();

        for i in 0..nr_inputs {
            let ic_start = ic_offset + (i + 1) * 64;
            let ic_i: &[u8; 64] = vk_data[ic_start..ic_start + 64].try_into().unwrap();
            let product = ec_mul(ic_i, &public_inputs[i])?;
            vk_x = ec_add(&vk_x, &product)?;
        }

        // Build pairing input: 4 pairs * 192 bytes = 768 bytes
        let mut pairing_input = vec![0u8; 768];

        // Pair 1: (-A, B)
        let neg_a = negate_g1(proof_a);
        pairing_input[0..64].copy_from_slice(&neg_a);
        pairing_input[64..192].copy_from_slice(proof_b);

        // Pair 2: (alpha, beta)
        pairing_input[192..256].copy_from_slice(alpha_g1);
        pairing_input[256..384].copy_from_slice(beta_g2);

        // Pair 3: (vk_x, gamma)
        pairing_input[384..448].copy_from_slice(&vk_x);
        pairing_input[448..576].copy_from_slice(gamma_g2);

        // Pair 4: (C, delta)
        pairing_input[576..640].copy_from_slice(proof_c);
        pairing_input[640..768].copy_from_slice(delta_g2);

        ec_pairing(&pairing_input)
    }
}

// ────────────────────────────────────────────────────────────────
// PDA Helpers
// ────────────────────────────────────────────────────────────────

pub fn find_verifier_state_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VERIFIER_STATE_SEED], &crate::id())
}

pub fn find_circuit_pda(circuit_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CIRCUIT_SEED, circuit_id], &crate::id())
}

pub fn find_nullifier_pda(nullifier: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[NULLIFIER_SEED, nullifier], &crate::id())
}

// ────────────────────────────────────────────────────────────────
// Processor — Instruction Dispatcher
// ────────────────────────────────────────────────────────────────

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = XfuelInstruction::try_from_slice(instruction_data)
        .map_err(|_| XfuelError::InvalidInstructionData)?;

    match instruction {
        XfuelInstruction::Initialize { mock_mode } => {
            process_initialize(program_id, accounts, mock_mode)
        }
        XfuelInstruction::RegisterCircuit {
            circuit_id,
            program_vkey,
            label,
            vk_data,
            nr_public_inputs,
        } => process_register_circuit(
            program_id,
            accounts,
            circuit_id,
            program_vkey,
            label,
            vk_data,
            nr_public_inputs,
        ),
        XfuelInstruction::RemoveCircuit { circuit_id } => {
            process_remove_circuit(accounts, circuit_id)
        }
        XfuelInstruction::VerifyProof {
            circuit_id,
            proof,
            public_values,
            nullifier,
        } => process_verify_proof(
            program_id,
            accounts,
            circuit_id,
            proof,
            public_values,
            nullifier,
        ),
        XfuelInstruction::EmitBridgeEvent {
            circuit_id,
            nullifier,
            target_chain,
            payload,
        } => process_emit_bridge_event(accounts, circuit_id, nullifier, target_chain, payload),
        XfuelInstruction::SetPaused { paused } => process_set_paused(accounts, paused),
        XfuelInstruction::SetMockMode { mock_mode } => process_set_mock_mode(accounts, mock_mode),
    }
}

// ────────────────────────────────────────────────────────────────
// Initialize
// ────────────────────────────────────────────────────────────────

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    mock_mode: bool,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let verifier_state_info = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (pda, bump) = find_verifier_state_pda();
    if pda != *verifier_state_info.key {
        return Err(XfuelError::InvalidPDA.into());
    }

    let rent = Rent::get()?;
    let space = VerifierState::LEN;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            admin.key,
            verifier_state_info.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            admin.clone(),
            verifier_state_info.clone(),
            system_program.clone(),
        ],
        &[&[VERIFIER_STATE_SEED, &[bump]]],
    )?;

    let state = VerifierState {
        discriminator: VerifierState::DISCRIMINATOR,
        admin: *admin.key,
        mock_mode,
        paused: false,
        circuit_count: 0,
        total_verified: 0,
        total_failed: 0,
        total_relayed: 0,
        bump,
    };

    state.serialize(&mut &mut verifier_state_info.data.borrow_mut()[..])?;
    msg!("XFuel Solana Verifier initialized (mock={})", mock_mode);
    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Register Circuit
// ────────────────────────────────────────────────────────────────

fn process_register_circuit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    circuit_id: [u8; 32],
    program_vkey: [u8; 32],
    label: String,
    vk_data: Vec<u8>,
    nr_public_inputs: u8,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let verifier_state_info = next_account_info(account_iter)?;
    let circuit_info = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut state = VerifierState::try_from_slice(&verifier_state_info.data.borrow())?;
    if state.admin != *admin.key {
        return Err(XfuelError::Unauthorized.into());
    }
    if state.circuit_count >= MAX_CIRCUITS {
        return Err(XfuelError::CircuitRegistryFull.into());
    }

    let (pda, bump) = find_circuit_pda(&circuit_id);
    if pda != *circuit_info.key {
        return Err(XfuelError::InvalidPDA.into());
    }
    if label.len() > MAX_LABEL_LEN {
        return Err(ProgramError::InvalidArgument);
    }

    let space = CircuitConfig::space(label.len(), vk_data.len());
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            admin.key,
            circuit_info.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            admin.clone(),
            circuit_info.clone(),
            system_program.clone(),
        ],
        &[&[CIRCUIT_SEED, &circuit_id, &[bump]]],
    )?;

    let circuit = CircuitConfig {
        discriminator: CircuitConfig::DISCRIMINATOR,
        circuit_id,
        program_vkey,
        label: label.clone(),
        vk_data,
        nr_public_inputs,
        is_active: true,
        verified_count: 0,
        bump,
    };

    circuit.serialize(&mut &mut circuit_info.data.borrow_mut()[..])?;

    state.circuit_count = state.circuit_count.saturating_add(1);
    state.serialize(&mut &mut verifier_state_info.data.borrow_mut()[..])?;

    msg!("Circuit registered: {}", label);
    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Remove Circuit
// ────────────────────────────────────────────────────────────────

fn process_remove_circuit(accounts: &[AccountInfo], circuit_id: [u8; 32]) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let verifier_state_info = next_account_info(account_iter)?;
    let circuit_info = next_account_info(account_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut state = VerifierState::try_from_slice(&verifier_state_info.data.borrow())?;
    if state.admin != *admin.key {
        return Err(XfuelError::Unauthorized.into());
    }

    let (pda, _) = find_circuit_pda(&circuit_id);
    if pda != *circuit_info.key {
        return Err(XfuelError::InvalidPDA.into());
    }

    let dest_lamports = admin.lamports();
    **admin.lamports.borrow_mut() = dest_lamports
        .checked_add(circuit_info.lamports())
        .ok_or(ProgramError::ArithmeticOverflow)?;
    **circuit_info.lamports.borrow_mut() = 0;
    circuit_info.data.borrow_mut().fill(0);

    state.circuit_count = state.circuit_count.saturating_sub(1);
    state.serialize(&mut &mut verifier_state_info.data.borrow_mut()[..])?;

    msg!("Circuit removed");
    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Verify Proof — SP1 Groth16
// ────────────────────────────────────────────────────────────────
//
// CU Budget: ~200K (alt_bn128 pairing) + ~20K (state reads/writes)
// Request 300K CU via ComputeBudgetProgram for safety margin.
// DePIN TPS: target <1s per verification at network level.

fn process_verify_proof(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    circuit_id: [u8; 32],
    proof: Vec<u8>,
    public_values: Vec<u8>,
    nullifier: [u8; 32],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let verifier_signer = next_account_info(account_iter)?;
    let verifier_state_info = next_account_info(account_iter)?;
    let circuit_info = next_account_info(account_iter)?;
    let nullifier_info = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !verifier_signer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut state = VerifierState::try_from_slice(&verifier_state_info.data.borrow())?;
    if state.paused {
        return Err(XfuelError::Paused.into());
    }

    // Load and validate circuit
    let mut circuit = CircuitConfig::try_from_slice(&circuit_info.data.borrow())
        .map_err(|_| XfuelError::CircuitNotFound)?;
    if circuit.circuit_id != circuit_id || !circuit.is_active {
        return Err(XfuelError::CircuitNotFound.into());
    }

    // Check nullifier freshness (PDA owned by our program = already used)
    let (nullifier_pda, nullifier_bump) = find_nullifier_pda(&nullifier);
    if nullifier_pda != *nullifier_info.key {
        return Err(XfuelError::InvalidPDA.into());
    }
    if *nullifier_info.owner == *program_id {
        return Err(XfuelError::NullifierAlreadyUsed.into());
    }

    // Groth16 verification (skipped in mock mode)
    if !state.mock_mode {
        if proof.len() != GROTH16_PROOF_LEN {
            return Err(XfuelError::InvalidProofLength.into());
        }
        if public_values.len() % 32 != 0 {
            return Err(XfuelError::InvalidPublicInputs.into());
        }
        let nr_inputs = public_values.len() / 32;
        if nr_inputs != circuit.nr_public_inputs as usize {
            return Err(XfuelError::InvalidPublicInputs.into());
        }

        let inputs: Vec<[u8; 32]> = (0..nr_inputs)
            .map(|i| {
                let mut chunk = [0u8; 32];
                chunk.copy_from_slice(&public_values[i * 32..(i + 1) * 32]);
                chunk
            })
            .collect();

        let verified = bn254::verify_groth16(&proof, &inputs, &circuit.vk_data, nr_inputs)?;

        if !verified {
            state.total_failed = state.total_failed.saturating_add(1);
            state.serialize(&mut &mut verifier_state_info.data.borrow_mut()[..])?;
            return Err(XfuelError::ProofVerificationFailed.into());
        }
    }

    // Create nullifier PDA (replay protection)
    let clock = Clock::get()?;
    let rent = Rent::get()?;
    let space = NullifierRecord::LEN;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            verifier_signer.key,
            nullifier_info.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            verifier_signer.clone(),
            nullifier_info.clone(),
            system_program.clone(),
        ],
        &[&[NULLIFIER_SEED, &nullifier, &[nullifier_bump]]],
    )?;

    let record = NullifierRecord {
        discriminator: NullifierRecord::DISCRIMINATOR,
        nullifier,
        circuit_id,
        verifier: *verifier_signer.key,
        timestamp: clock.unix_timestamp,
        bump: nullifier_bump,
    };
    record.serialize(&mut &mut nullifier_info.data.borrow_mut()[..])?;

    // Update metrics
    state.total_verified = state.total_verified.saturating_add(1);
    state.serialize(&mut &mut verifier_state_info.data.borrow_mut()[..])?;

    circuit.verified_count = circuit.verified_count.saturating_add(1);
    circuit.serialize(&mut &mut circuit_info.data.borrow_mut()[..])?;

    // Emit structured event for Wormhole relayer / indexer consumption
    // Event: [type(1) | circuit_id(32) | nullifier(32) | verifier(32) | timestamp(8)]
    let mut event_data = Vec::with_capacity(105);
    event_data.push(0x01); // ProofVerified
    event_data.extend_from_slice(&circuit_id);
    event_data.extend_from_slice(&nullifier);
    event_data.extend_from_slice(verifier_signer.key.as_ref());
    event_data.extend_from_slice(&clock.unix_timestamp.to_le_bytes());
    solana_program::log::sol_log_data(&[&event_data]);

    msg!(
        "SP1 proof verified (circuit={}, mock={})",
        circuit.label,
        state.mock_mode
    );
    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Emit Bridge Event (Wormhole relay)
// ────────────────────────────────────────────────────────────────
//
// Emits a structured log event that Wormhole guardians or custom
// relayers can observe and convert into a VAA for cross-chain delivery
// to Theta EVM (ZKVerifierSP1.sol) or CosmWasm (xfuel-zk-verifier).

fn process_emit_bridge_event(
    accounts: &[AccountInfo],
    circuit_id: [u8; 32],
    nullifier: [u8; 32],
    target_chain: u16,
    payload: Vec<u8>,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let relayer = next_account_info(account_iter)?;
    let verifier_state_info = next_account_info(account_iter)?;

    if !relayer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut state = VerifierState::try_from_slice(&verifier_state_info.data.borrow())?;
    if state.paused {
        return Err(XfuelError::Paused.into());
    }

    // Event: [type(1) | circuit_id(32) | nullifier(32) | chain(2) | len(4) | payload(...)]
    let mut event_data = Vec::with_capacity(71 + payload.len());
    event_data.push(0x02); // BridgeEvent
    event_data.extend_from_slice(&circuit_id);
    event_data.extend_from_slice(&nullifier);
    event_data.extend_from_slice(&target_chain.to_le_bytes());
    event_data.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    event_data.extend_from_slice(&payload);
    solana_program::log::sol_log_data(&[&event_data]);

    state.total_relayed = state.total_relayed.saturating_add(1);
    state.serialize(&mut &mut verifier_state_info.data.borrow_mut()[..])?;

    msg!("Bridge event emitted (target_chain={})", target_chain);
    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Admin Controls
// ────────────────────────────────────────────────────────────────

fn process_set_paused(accounts: &[AccountInfo], paused: bool) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let verifier_state_info = next_account_info(account_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut state = VerifierState::try_from_slice(&verifier_state_info.data.borrow())?;
    if state.admin != *admin.key {
        return Err(XfuelError::Unauthorized.into());
    }

    state.paused = paused;
    state.serialize(&mut &mut verifier_state_info.data.borrow_mut()[..])?;

    msg!("Verifier paused={}", paused);
    Ok(())
}

fn process_set_mock_mode(accounts: &[AccountInfo], mock_mode: bool) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let verifier_state_info = next_account_info(account_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut state = VerifierState::try_from_slice(&verifier_state_info.data.borrow())?;
    if state.admin != *admin.key {
        return Err(XfuelError::Unauthorized.into());
    }

    state.mock_mode = mock_mode;
    state.serialize(&mut &mut verifier_state_info.data.borrow_mut()[..])?;

    msg!("Mock mode={}", mock_mode);
    Ok(())
}

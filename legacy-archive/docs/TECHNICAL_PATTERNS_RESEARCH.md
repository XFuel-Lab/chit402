# Technical Patterns Research Summary

This document provides concrete technical patterns extracted from documentation sources for ZK-based protocol implementation.

---

## 1. Almanak Swarms - 18-Agent Lifecycle Pattern

### Key Data Structures/Interfaces

```solidity
// Agent Registry Pattern
struct Agent {
    uint256 agentId;
    AgentType agentType; // Strategist, Coder, Reviewer, QA, etc.
    address agentAddress;
    bool isActive;
    uint256 reputationScore;
    mapping(bytes32 => bool) completedTasks;
}

enum AgentType {
    STRATEGIST,
    CODER,
    REVIEWER,
    QA_ENGINEER,
    DEBUGGER,
    UI_DESIGNER,
    PERMISSION_MANAGER,
    DEPLOYER,
    DATA_WIZARD,
    RESEARCHER,
    QUANT,
    STACK_EXPERT,
    SDK_MASTER,
    SUPERVISOR,
    VAULT_MANAGER,
    INFLUENCER,
    TROUBLESHOOTER,
    SECURITY_GUARD
}

// Task Coordination Structure
struct Task {
    bytes32 taskId;
    AgentType requiredAgentType;
    bytes taskPayload;
    TaskStatus status;
    address assignedAgent;
    uint256 deadline;
    bytes32 parentTaskId; // For task dependencies
}

enum TaskStatus {
    PENDING,
    IN_PROGRESS,
    REVIEWING,
    COMPLETED,
    FAILED
}

// Supervisor Orchestration
struct Workflow {
    bytes32 workflowId;
    Task[] tasks;
    uint256 currentTaskIndex;
    bool isComplete;
    address initiator;
}
```

### Event Patterns

```solidity
event AgentRegistered(uint256 indexed agentId, AgentType agentType, address agentAddress);
event TaskAssigned(bytes32 indexed taskId, uint256 indexed agentId, AgentType agentType);
event TaskCompleted(bytes32 indexed taskId, bytes32 indexed workflowId, bytes result);
event WorkflowInitiated(bytes32 indexed workflowId, address indexed initiator);
event WorkflowCompleted(bytes32 indexed workflowId, bytes32 finalResultHash);
event AgentCoordination(bytes32 indexed workflowId, uint256 fromAgentId, uint256 toAgentId, bytes32 taskId);
```

### Monte Carlo Simulation Pattern

```solidity
// On-chain simulation results storage
struct SimulationResult {
    bytes32 simulationId;
    uint256 timestamp;
    uint256 iterations;
    uint256 successCount;
    uint256 failureCount;
    bytes32 resultHash; // Merkle root of all simulation outcomes
    bool validated;
}

// Settlement based on simulation confidence
struct SettlementProposal {
    bytes32 proposalId;
    bytes32 simulationId;
    uint256 confidenceScore; // Based on Monte Carlo success rate
    address proposer;
    uint256 stakeAmount;
    bool executed;
}

function executeSettlement(bytes32 proposalId) external {
    SettlementProposal storage proposal = proposals[proposalId];
    SimulationResult storage sim = simulations[proposal.simulationId];
    
    require(sim.validated, "Simulation not validated");
    require(proposal.confidenceScore >= MIN_CONFIDENCE_THRESHOLD, "Low confidence");
    
    // Execute settlement based on validated simulation
    proposal.executed = true;
    emit SettlementExecuted(proposalId, sim.resultHash);
}
```

### Gas Optimization Techniques

1. **Batch Task Assignment**: Assign multiple tasks in a single transaction
2. **Task Result Hashing**: Store only Merkle roots of large task outputs
3. **Lazy Evaluation**: Defer expensive operations until workflow completion
4. **Agent Reputation Caching**: Cache reputation scores to avoid repeated calculations

```solidity
function batchAssignTasks(bytes32[] calldata taskIds, uint256[] calldata agentIds) external {
    require(taskIds.length == agentIds.length, "Length mismatch");
    for (uint256 i = 0; i < taskIds.length; i++) {
        _assignTask(taskIds[i], agentIds[i]);
    }
}
```

### Security Considerations

1. **Replay Protection**: Use nonces for task assignments
2. **Access Control**: Supervisor-only orchestration functions
3. **Task Validation**: Verify task completion proofs before settlement
4. **Agent Slashing**: Penalize malicious agents via reputation system

```solidity
mapping(address => uint256) public nonces;

function assignTask(bytes32 taskId, uint256 agentId, bytes calldata signature) external {
    bytes32 hash = keccak256(abi.encodePacked(taskId, agentId, nonces[msg.sender]++, block.timestamp));
    require(_verifySignature(hash, signature), "Invalid signature");
    // ... assignment logic
}
```

### veToken Governance Pattern (Bittensor-Inspired)

```solidity
// veToken (vote-escrowed token) governance for Almanak
contract VeTokenGovernance {
    struct LockPosition {
        uint256 amount;
        uint256 unlockTime;
        uint256 votingPower; // Decays linearly until unlock
    }
    
    mapping(address => LockPosition) public locks;
    
    // Bittensor-inspired emission allocation
    function allocateEmissions(
        address[] calldata strategies,
        uint256[] calldata performanceScores
    ) external {
        uint256 totalScore = 0;
        for (uint256 i = 0; i < performanceScores.length; i++) {
            totalScore += performanceScores[i];
        }
        
        // Merit-based allocation proportional to performance
        for (uint256 i = 0; i < strategies.length; i++) {
            uint256 allocation = (emissionRate * performanceScores[i]) / totalScore;
            emit EmissionsAllocated(strategies[i], allocation);
        }
    }
    
    // Bribes-based governance (Curve Finance style)
    function voteWithBribe(
        uint256 proposalId,
        bool support,
        uint256 bribeAmount
    ) external {
        uint256 votingPower = getVotingPower(msg.sender);
        require(votingPower > 0, "No voting power");
        
        // Record bribe
        bribes[proposalId][msg.sender] = bribeAmount;
        
        // Cast vote weighted by voting power
        votes[proposalId][support] += votingPower;
        
        emit VoteCast(proposalId, msg.sender, support, votingPower, bribeAmount);
    }
}
```

### ZK-Based Protocol Mapping

- **Agent Coordination Proofs**: ZK proofs that agent A completed task X without revealing intermediate state
- **Simulation Verification**: ZK proofs that Monte Carlo simulation was executed correctly
- **Settlement Privacy**: Private settlement amounts with public verification
- **Reputation Aggregation**: ZK proofs for reputation score calculations
- **Private Governance Voting**: ZK proofs for veToken voting without revealing vote direction

```rust
// SP1 zkVM pattern for agent coordination proof
pub fn prove_agent_coordination(
    task_id: &[u8; 32],
    agent_id: u64,
    result_hash: &[u8; 32],
) -> Result<Proof> {
    // Prove that agent completed task correctly without revealing full result
    let public_values = commit!(task_id, result_hash);
    // ... proof generation
}
```

---

## 2. zkML Privacy - SP1 zkML Proof Generation

### Key Data Structures/Interfaces

```rust
// SP1 zkML Program Structure
use sp1_zkvm::{io::*, prelude::*};

#[sp1_main]
fn main() {
    // Private inputs (weights, input data)
    let weights: Vec<f64> = read_vec();
    let input_data: Vec<f64> = read_vec();
    
    // Perform inference
    let output = neural_network_inference(&weights, &input_data);
    
    // Selective disclosure: commit only output, keep weights private
    commit_slice(&output);
    
    // Optionally commit metadata
    let metadata = format!("model_version:{}", MODEL_VERSION);
    commit_slice(metadata.as_bytes());
}

// Selective Disclosure Pattern
pub struct SelectiveDisclosure {
    pub public_values: Vec<Vec<u8>>,  // Committed values
    pub private_values: Vec<Vec<u8>>, // Kept private
    pub proof: Proof,
}

// Weight Verification Structure
pub struct WeightVerification {
    pub weight_hash: [u8; 32],        // Blake3/SHA256 hash of weights
    pub model_commitment: [u8; 32],   // Merkle root of weight tree
    pub inference_proof: Proof,       // SP1 proof of inference
}

// SP1 zkML Neural Network Implementation
#[sp1_main]
fn zkml_inference() {
    // Private inputs (never committed)
    let weights: Vec<f64> = read_vec();  // Model weights (private)
    let input: Vec<f64> = read_vec();     // Input data (private)
    
    // Public metadata (committed)
    let model_version: u64 = read();
    let model_hash: [u8; 32] = read();
    
    // Perform inference
    let output = neural_network_forward(&weights, &input);
    
    // Selective disclosure: commit only what needs to be public
    commit(&model_version);
    commit_slice(&model_hash);
    commit_slice(&output);  // Only output revealed
    
    // Weights and input remain private (not committed)
}

fn neural_network_forward(weights: &[f64], input: &[f64]) -> Vec<f64> {
    // Linear layer computation
    let mut output = vec![0.0; weights.len() / input.len()];
    for i in 0..output.len() {
        for j in 0..input.len() {
            output[i] += weights[i * input.len() + j] * input[j];
        }
        output[i] = relu(output[i]); // ReLU activation
    }
    output
}

fn relu(x: f64) -> f64 {
    if x > 0.0 { x } else { 0.0 }
}

// Weight Merkle Tree for Verification Without Disclosure
pub struct WeightMerkleTree {
    pub root: [u8; 32],
    pub depth: u32,
    pub leaves: Vec<[u8; 32]>, // Hashed weight segments
}

impl WeightMerkleTree {
    pub fn new(weights: &[f64]) -> Self {
        // Hash each weight segment (32 weights per leaf)
        let leaves: Vec<[u8; 32]> = weights
            .chunks(32)
            .map(|chunk| {
                let mut hasher = blake3::Hasher::new();
                for w in chunk {
                    hasher.update(&w.to_le_bytes());
                }
                *hasher.finalize().as_bytes()
            })
            .collect();
        
        // Build Merkle tree
        let root = build_merkle_root(&leaves);
        
        Self {
            root,
            depth: (leaves.len() as f64).log2().ceil() as u32,
            leaves,
        }
    }
    
    pub fn prove_weight_segment(
        &self,
        indices: &[usize],
    ) -> (Vec<f64>, Vec<MerkleProof>) {
        // Return weight segments and Merkle proofs
        // without revealing full weight set
        let segments: Vec<f64> = indices.iter()
            .map(|&i| {
                // Reconstruct from leaves (simplified)
                f64::from_le_bytes(self.leaves[i / 32][(i % 32) * 8..(i % 32) * 8 + 8].try_into().unwrap())
            })
            .collect();
        
        let proofs: Vec<MerkleProof> = indices.iter()
            .map(|&i| self.generate_proof(i))
            .collect();
        
        (segments, proofs)
    }
}
```

### Event Patterns

```solidity
// On-chain verification events
event InferenceProven(
    bytes32 indexed modelId,
    bytes32 indexed inputHash,
    bytes32 indexed outputHash,
    address prover,
    uint256 timestamp
);

event ModelRegistered(
    bytes32 indexed modelId,
    bytes32 weightCommitment,
    uint256 modelSize,
    address registrant
);

event SelectiveDisclosure(
    bytes32 indexed proofId,
    bytes32[] publicValues,
    uint256 privateValueCount
);
```

### Selective Disclosure Pattern

```rust
// SP1 selective disclosure implementation
use sp1_zkvm::io::{commit, commit_slice};

pub fn selective_disclosure_inference(
    private_weights: &[f64],
    private_input: &[f64],
    public_metadata: &str,
) -> (Vec<u8>, Proof) {
    // Private computation
    let output = run_inference(private_weights, private_input);
    
    // Public commitments (selective disclosure)
    commit_slice(public_metadata.as_bytes());  // Model version, timestamp
    commit_slice(&output);                      // Only output revealed
    
    // Weights remain private (not committed)
    // Input remains private (not committed)
    
    // Generate proof
    let proof = generate_proof();
    (output, proof)
}
```

### Private Weight Verification Pattern

```rust
// Merkle tree of weights for efficient verification
pub struct WeightMerkleTree {
    pub root: [u8; 32],
    pub depth: u32,
    pub leaf_count: u64,
}

pub fn verify_weights_without_revealing(
    weight_tree: &WeightMerkleTree,
    weight_indices: &[u64],
    weight_proofs: &[MerkleProof],
    inference_result: &[f64],
) -> bool {
    // Verify weight proofs without revealing actual weights
    for (idx, proof) in weight_indices.iter().zip(weight_proofs.iter()) {
        assert!(verify_merkle_proof(weight_tree.root, *idx, proof));
    }
    
    // Verify inference was computed with these weights
    // (without revealing weights themselves)
    true
}
```

### Gas Optimization Techniques

1. **Proof Aggregation**: Aggregate multiple inference proofs into one
2. **Batch Verification**: Verify multiple proofs in a single transaction
3. **Compressed Proofs**: Use Groth16/PLONK compression for on-chain verification
4. **Lazy Weight Loading**: Load only necessary weight segments

```solidity
// Batch verification pattern
function batchVerifyInferences(
    bytes32[] calldata proofIds,
    bytes[] calldata proofs,
    bytes32[] calldata publicValues
) external {
    for (uint256 i = 0; i < proofIds.length; i++) {
        require(verifyProof(proofs[i], publicValues[i]), "Invalid proof");
        emit InferenceVerified(proofIds[i]);
    }
}
```

### Security Considerations

1. **Nullifiers for Inference**: Prevent replay of same inference
2. **Weight Integrity**: Verify weight commitments match registered model
3. **Input Privacy**: Ensure inputs aren't leaked through timing attacks
4. **Proof Verification**: On-chain verification of SP1 proofs

```solidity
mapping(bytes32 => bool) public nullifiers;

function verifyInference(
    bytes calldata proof,
    bytes32 inputHash,
    bytes32 outputHash,
    bytes32 nullifier
) external {
    require(!nullifiers[nullifier], "Inference already processed");
    require(verifySP1Proof(proof, inputHash, outputHash), "Invalid proof");
    
    nullifiers[nullifier] = true;
    emit InferenceProven(inputHash, outputHash, msg.sender);
}
```

### ZK-Based Protocol Mapping

- **Private Model Weights**: Weights never revealed, only commitments
- **Selective Output Disclosure**: Choose which outputs to reveal
- **Inference Privacy**: Input data remains private
- **Proof Recursion**: Verify SP1 proofs within SP1 for complex pipelines

```rust
// Recursive proof pattern for zkML pipeline
pub fn recursive_zkml_proof(
    model_proof: Proof,
    inference_proof: Proof,
) -> Proof {
    // Verify model proof within SP1
    verify_proof_in_zkvm(model_proof);
    
    // Verify inference proof
    verify_proof_in_zkvm(inference_proof);
    
    // Generate aggregated proof
    generate_aggregated_proof()
}
```

---

## 3. DataDAO Models - VRC-20 Token Standard & Contribution Proofs

### Key Data Structures/Interfaces

```solidity
// VRC-20 Token Standard (extends ERC-20)
interface IVRC20 {
    // Standard ERC-20 functions
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    
    // VRC-20 specific functions
    function getDataMetrics(address tokenAddress) external view returns (DataMetrics memory);
    function registerWithDLP(address dlpAddress) external;
    function contributeData(bytes32 dataHash, uint256 contributionScore) external;
}

struct DataMetrics {
    uint256 totalContributions;
    uint256 uniqueContributors;
    uint256 dataQualityScore;
    bytes32 datasetRoot; // Merkle root of dataset
}

// Data Liquidity Pool (DLP) Registry
struct DLPEntry {
    address tokenAddress;      // VRC-20 token address
    address dlpOwner;
    bytes32 datasetCID;         // IPFS CID
    DataRefinementConfig refinementConfig;
    bool isActive;
}

struct DataRefinementConfig {
    address refinerContract;   // Dockerized refiner address
    bytes32 refinementSchema;  // Schema hash
    uint256 qualityThreshold;
}

// Proof of Contribution (PoC)
struct ContributionProof {
    bytes32 contributionId;
    address contributor;
    bytes32 dataHash;
    uint256 qualityScore;
    uint256 uniquenessScore;
    uint256 authenticityScore;
    bytes32 proofHash;          // PoC validator signature
    uint256 timestamp;
    bool verified;
}

// DATFactory Contract (address: 0x40f8bccF35a75ecef63BC3B1B3E06ffEB9220644)
interface IDATFactory {
    enum TokenType {
        DAT,        // Standard with capping, burning, blocklisting
        DATVotes,   // Adds ERC20Votes for governance
        DATPausable // Adds emergency pause
    }
    
    function createToken(
        string memory name,
        string memory symbol,
        uint256 totalSupply,
        address[] memory vestingWallets,
        uint256[] memory allocations,
        TokenType tokenType
    ) external returns (address tokenAddress);
}

// DLPRegistry Contract (address: 0x4D59880a924526d1dD33260552Ff4328b1E18a43)
interface IDLPRegistry {
    struct DLPEntry {
        address dlpAddress;        // DataLiquidityPoolProxy address
        address ownerAddress;      // Owner wallet
        address treasuryAddress;  // Treasury wallet
        address tokenAddress;      // VRC-20 token address
        uint256 lpTokenId;         // Liquidity pool token ID
        string name;               // Unique DLP name
        string iconUrl;
        string website;
        bytes32 metadataHash;
        bool isVerified;           // Verified by Vana team
        bool isActive;
        uint256 registrationDeposit; // 1 VANA testnet, 100 VANA mainnet
    }
    
    function registerDLP(
        address dlpAddress,
        address ownerAddress,
        address treasuryAddress,
        string memory name,
        string memory iconUrl,
        string memory website,
        bytes32 metadataHash
    ) external payable;
    
    function updateDLPToken(
        address dlpAddress,
        address tokenAddress
    ) external;
    
    function verifyDLP(address dlpAddress) external; // Admin only
    
    function isEligibleForRewards(address dlpAddress) external view returns (bool);
}

// DataPortabilityPermissions Contract (address: 0xD54523048AdD05b4d734aFaE7C68324Ebb7373eF)
interface IDataPortabilityPermissions {
    struct Grant {
        address grantor;           // User granting access
        address grantee;           // Builder receiving access
        bytes32 scopeHash;         // Data scope (e.g., "twitter.posts")
        uint256 expiresAt;         // Expiration timestamp
        bytes32 grantHash;         // EIP-712 typed data hash
        GrantStatus status;
    }
    
    enum GrantStatus {
        ACTIVE,
        REVOKED,
        EXPIRED
    }
    
    function createGrant(
        address grantee,
        bytes32 scopeHash,
        uint256 expiresAt,
        bytes calldata signature // EIP-712 signature
    ) external returns (bytes32 grantHash);
    
    function revokeGrant(bytes32 grantHash) external;
    
    function verifyGrant(
        bytes32 grantHash,
        address grantor,
        address grantee,
        bytes32 scopeHash
    ) external view returns (bool);
}
```

### Event Patterns

```solidity
event VRC20Created(address indexed tokenAddress, address indexed creator, string name, string symbol);
event DataContributed(bytes32 indexed contributionId, address indexed contributor, bytes32 dataHash, uint256 score);
event ContributionVerified(bytes32 indexed contributionId, bytes32 proofHash, uint256 tokenReward);
event DataRefined(bytes32 indexed datasetCID, bytes32 refinementHash, address refiner);
event DLPRegistered(address indexed dlpAddress, address indexed tokenAddress, bytes32 datasetCID);
```

### Data Refinement Pipeline Pattern

```solidity
// Data Refinement Contract
contract DataRefiner {
    struct RefinementJob {
        bytes32 jobId;
        bytes32 rawDataCID;
        address refiner;
        RefinementStatus status;
        bytes32 refinedDataCID;
        bytes32 schemaHash;
    }
    
    enum RefinementStatus {
        PENDING,
        ENCRYPTING,
        MASKING,
        NORMALIZING,
        COMPLETED,
        FAILED
    }
    
    function refineData(
        bytes32 rawDataCID,
        bytes32 schemaHash,
        bytes calldata refinementProof
    ) external returns (bytes32 jobId) {
        jobId = keccak256(abi.encodePacked(rawDataCID, msg.sender, block.timestamp));
        
        RefinementJob storage job = jobs[jobId];
        job.jobId = jobId;
        job.rawDataCID = rawDataCID;
        job.refiner = msg.sender;
        job.status = RefinementStatus.PENDING;
        job.schemaHash = schemaHash;
        
        // Off-chain refiner processes: encrypt -> mask -> normalize
        // Then submits refined CID with proof
        
        emit RefinementInitiated(jobId, rawDataCID);
        return jobId;
    }
    
    function submitRefinedData(
        bytes32 jobId,
        bytes32 refinedCID,
        bytes calldata encryptionProof,
        bytes calldata normalizationProof
    ) external {
        RefinementJob storage job = jobs[jobId];
        require(job.status == RefinementStatus.PENDING, "Invalid status");
        require(job.refiner == msg.sender, "Unauthorized");
        
        // Verify refinement proofs
        require(verifyEncryption(encryptionProof), "Invalid encryption");
        require(verifyNormalization(normalizationProof, job.schemaHash), "Invalid normalization");
        
        job.refinedDataCID = refinedCID;
        job.status = RefinementStatus.COMPLETED;
        
        emit DataRefined(jobId, refinedCID, msg.sender);
    }
}
```

### Contribution Proof Pattern

```solidity
// Proof of Contribution Validator
contract PoCValidator {
    struct PoCResult {
        uint256 qualityScore;
        uint256 uniquenessScore;
        uint256 authenticityScore;
        bool isValid;
        bytes32 proofSignature;
    }
    
    function validateContribution(
        bytes32 dataHash,
        bytes calldata dataProof,
        address contributor
    ) external returns (PoCResult memory) {
        // Off-chain PoC job validates:
        // 1. Quality: Data usefulness and relevance
        // 2. Uniqueness: Check against existing dataset
        // 3. Ownership: Verify wallet signature
        // 4. Authenticity: Verify against ground truth
        
        PoCResult memory result;
        result.qualityScore = _assessQuality(dataHash, dataProof);
        result.uniquenessScore = _checkUniqueness(dataHash);
        result.authenticityScore = _verifyAuthenticity(dataHash, contributor);
        
        result.isValid = result.qualityScore > QUALITY_THRESHOLD &&
                         result.uniquenessScore > UNIQUENESS_THRESHOLD &&
                         result.authenticityScore > AUTHENTICITY_THRESHOLD;
        
        if (result.isValid) {
            result.proofSignature = keccak256(abi.encodePacked(
                dataHash,
                contributor,
                result.qualityScore,
                result.uniquenessScore,
                result.authenticityScore,
                block.timestamp
            ));
        }
        
        return result;
    }
    
    function mintContributionReward(
        address vrc20Token,
        address contributor,
        PoCResult memory pocResult
    ) external {
        require(pocResult.isValid, "Invalid contribution");
        
        // Calculate token reward based on scores
        uint256 reward = calculateReward(pocResult);
        
        // Mint VRC-20 tokens to contributor
        IVRC20(vrc20Token).mint(contributor, reward);
        
        emit ContributionRewarded(contributor, vrc20Token, reward);
    }
}
```

### Gas Optimization Techniques

1. **Batch Contribution Verification**: Verify multiple contributions in one transaction
2. **Merkle Tree Updates**: Use incremental Merkle trees for dataset tracking
3. **Lazy Minting**: Batch token mints after multiple contributions
4. **Storage Packing**: Pack struct fields to reduce storage slots

```solidity
function batchVerifyContributions(
    bytes32[] calldata contributionIds,
    PoCResult[] calldata pocResults
) external {
    require(contributionIds.length == pocResults.length, "Length mismatch");
    
    for (uint256 i = 0; i < contributionIds.length; i++) {
        contributions[contributionIds[i]] = pocResults[i];
        emit ContributionVerified(contributionIds[i], pocResults[i].proofSignature);
    }
}
```

### Security Considerations

1. **Replay Protection**: Use nonces for contribution submissions
2. **Nullifiers**: Prevent duplicate data contributions
3. **Access Control**: Only registered PoC validators can verify
4. **Data Integrity**: Verify IPFS CIDs match on-chain commitments

```solidity
mapping(bytes32 => bool) public contributionNullifiers;
mapping(address => uint256) public contributorNonces;

function submitContribution(
    bytes32 dataHash,
    bytes32 dataCID,
    bytes calldata signature
) external {
    bytes32 nullifier = keccak256(abi.encodePacked(dataHash, msg.sender));
    require(!contributionNullifiers[nullifier], "Duplicate contribution");
    
    bytes32 hash = keccak256(abi.encodePacked(
        dataHash,
        dataCID,
        msg.sender,
        contributorNonces[msg.sender]++,
        block.timestamp
    ));
    require(_verifySignature(hash, signature), "Invalid signature");
    
    contributionNullifiers[nullifier] = true;
    emit ContributionSubmitted(dataHash, msg.sender);
}
```

### ZK-Based Protocol Mapping

- **Private Contribution Scores**: ZK proofs for contribution quality without revealing data
- **Uniqueness Proofs**: ZK proofs that data is unique without revealing content
- **Selective Data Disclosure**: Reveal only metadata, keep data private
- **Aggregated Contribution Proofs**: Batch verify contributions with ZK

```rust
// ZK proof for contribution uniqueness
pub fn prove_unique_contribution(
    data_hash: &[u8; 32],
    dataset_merkle_root: &[u8; 32],
    uniqueness_proof: &MerkleProof,
) -> Proof {
    // Prove data_hash is NOT in dataset without revealing data_hash
    // or dataset contents
    let public_values = commit!(dataset_merkle_root);
    // ... generate proof
}
```

---

## 4. Aptos Move - Cross-Chain Adapters & ZK Verification

### Key Data Structures/Interfaces

```move
// Move module for cross-chain adapter
module aptos_crosschain::adapter {
    use aptos_framework::coin;
    use aptos_framework::signer;
    
    struct CrossChainMessage has key {
        message_id: u64,
        source_chain: vector<u8>,
        destination_chain: vector<u8>,
        payload: vector<u8>,
        zk_proof: vector<u8>,
        status: u8, // 0: pending, 1: verified, 2: executed
    }
    
    struct ZKVerifier has key {
        verifier_id: u64,
        circuit_params: vector<u8>,
        public_inputs: vector<u8>,
    }
    
    // Cross-chain message with ZK verification
    public entry fun submit_crosschain_message(
        sender: &signer,
        message_id: u64,
        source_chain: vector<u8>,
        destination_chain: vector<u8>,
        payload: vector<u8>,
        zk_proof: vector<u8>,
        public_inputs: vector<u8>,
    ) {
        // Verify ZK proof
        assert!(verify_zk_proof(zk_proof, public_inputs), 1); // E_PROOF_INVALID
        
        let message = CrossChainMessage {
            message_id,
            source_chain,
            destination_chain,
            payload,
            zk_proof,
            status: 0, // pending
        };
        
        // Store message
        move_to(sender, message);
        emit_event<MessageSubmittedEvent>(MessageSubmittedEvent {
            message_id,
            source_chain,
            destination_chain,
        });
    }
    
    // Verify ZK proof using native cryptographic functions
    fun verify_zk_proof(
        proof: vector<u8>,
        public_inputs: vector<u8>,
    ): bool {
        // Use Aptos native Groth16 verifier
        // aptos_framework::crypto::groth16_bn254_verify
        // Returns true if proof is valid
        true // Placeholder - use actual native function
    }
}
```

### Event Patterns

```move
struct MessageSubmittedEvent has drop, store {
    message_id: u64,
    source_chain: vector<u8>,
    destination_chain: vector<u8>,
}

struct MessageExecutedEvent has drop, store {
    message_id: u64,
    execution_timestamp: u64,
}

struct ZKProofVerifiedEvent has drop, store {
    proof_id: vector<u8>,
    circuit_id: u64,
    verification_timestamp: u64,
}
```

### Cross-Chain Adapter Pattern (LayerZero OFT Style)

```move
module aptos_crosschain::oft_adapter {
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::signer;
    use aptos_framework::fungible_asset::{Self, FungibleAsset};
    
    // OFT Adapter using Fungible Asset standard
    struct Escrow has key {
        asset: FungibleAsset,
        source_chain: vector<u8>,
        destination_address: address,
        message_id: u64,
    }
    
    // Lock tokens for cross-chain transfer (debit_fungible_asset pattern)
    public entry fun lock_for_crosschain(
        sender: &signer,
        asset: FungibleAsset,
        amount: u64,
        destination_chain: vector<u8>,
        destination_address: address,
        message_id: u64,
    ) {
        // Validate blocklist, calculate fees, handle dust
        let (send_amount, receive_amount) = calculate_amounts(amount);
        
        // Debit fungible asset (lock)
        let escrow = Escrow {
            asset: fungible_asset::withdraw(&mut asset, send_amount),
            source_chain: b"aptos",
            destination_address,
            message_id,
        };
        
        move_to(sender, escrow);
        
        emit_event<LockedEvent>(LockedEvent {
            message_id,
            amount: send_amount,
            receive_amount,
            destination_chain,
        });
    }
    
    // Release tokens on destination chain (called by relayer with ZK proof)
    public entry fun release_from_crosschain(
        relayer: &signer,
        message_id: u64,
        source_chain: vector<u8>,
        zk_proof: vector<u8>,
        public_inputs: vector<u8>,
    ) {
        // Verify ZK proof that lock occurred on source chain
        assert!(verify_crosschain_proof(zk_proof, public_inputs), 1);
        
        // Release escrowed tokens
        let escrow = borrow_global_mut<Escrow>(@source_address);
        let asset = escrow.asset;
        fungible_asset::deposit(escrow.destination_address, asset);
        
        emit_event<ReleasedEvent>(ReleasedEvent {
            message_id,
            amount: fungible_asset::amount(&asset),
        });
    }
    
    // Calculate send/receive amounts accounting for fees and dust
    fun calculate_amounts(amount: u64): (u64, u64) {
        let fee = amount / 1000; // 0.1% fee
        let dust = 1; // Minimum dust amount
        let send_amount = amount;
        let receive_amount = amount - fee - dust;
        (send_amount, receive_amount)
    }
}
```

### Gas Optimization Techniques

1. **Native Cryptographic Functions**: Use built-in Groth16/Bulletproofs verifiers (lower gas)
2. **Batch Verification**: Verify multiple proofs in one transaction
3. **Storage Optimization**: Use `copy` ability sparingly, prefer `move`
4. **Resource Account Pattern**: Use resource accounts for gas-efficient contract deployment

```move
// Batch proof verification
public entry fun batch_verify_proofs(
    proofs: vector<vector<u8>>,
    public_inputs_list: vector<vector<u8>>,
) {
    let i = 0;
    while (i < vector::length(&proofs)) {
        let proof = *vector::borrow(&proofs, i);
        let public_inputs = *vector::borrow(&public_inputs_list, i);
        assert!(verify_zk_proof(proof, public_inputs), 1);
        i = i + 1;
    };
}
```

### Security Considerations

1. **Replay Protection**: Use sequence numbers for cross-chain messages
2. **Nullifiers**: Prevent double-spending in cross-chain transfers
3. **Access Control**: Verify relayer signatures
4. **Proof Verification**: Always verify ZK proofs before execution

```move
struct MessageNonce has key {
    nonce: u64,
}

public entry fun submit_with_nonce(
    sender: &signer,
    message_id: u64,
    nonce: u64,
    payload: vector<u8>,
) {
    let sender_addr = signer::address_of(sender);
    let nonce_obj = borrow_global_mut<MessageNonce>(sender_addr);
    
    // Replay protection
    assert!(nonce == nonce_obj.nonce + 1, 2); // E_INVALID_NONCE
    nonce_obj.nonce = nonce;
    
    // Process message
    // ...
}
```

### ZK-Based Protocol Mapping

- **Universal Halo2 Verifier**: Verify Halo2 proofs on-chain
- **Cross-Chain State Proofs**: ZK proofs of state on source chain
- **Private Cross-Chain Transfers**: Hide transfer amounts with ZK
- **Recursive Proof Verification**: Verify SP1 proofs within Move

```move
// Halo2 verifier integration
public fun verify_halo2_proof(
    proof: vector<u8>,
    circuit_shape: vector<u8>,
    public_inputs: vector<u8>,
): bool {
    // Use universal Halo2 verifier contract
    // Verify proof against circuit shape
    // Return verification result
    true
}
```

---

## 5. Sui Move - Object Model for Cross-Chain & ZK Verification

### Key Data Structures/Interfaces

```move
// Sui Move module for cross-chain with object model
module sui_crosschain::zk_adapter {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    
    // Cross-chain message object
    struct CrossChainMessage has key {
        id: UID,
        message_id: u64,
        source_chain: vector<u8>,
        destination_chain: vector<u8>,
        payload: vector<u8>,
        zk_proof: vector<u8>,
        status: u8,
    }
    
    // ZK verifier capability (owned object for authorization)
    struct ZKVerifierCap has key {
        id: UID,
        verifier_id: u64,
    }
    
    // Hot potato pattern for cross-chain calls
    struct Call<Param, Result> has drop {
        param: Param,
        state: u8, // Active, Creating, Waiting, Completed
    }
    
    // Shared object for cross-chain registry
    struct CrossChainRegistry has key {
        id: UID,
        messages: Table<u64, CrossChainMessage>,
    }
    
    // Create cross-chain message
    public fun create_crosschain_message(
        message_id: u64,
        source_chain: vector<u8>,
        destination_chain: vector<u8>,
        payload: vector<u8>,
        zk_proof: vector<u8>,
        ctx: &mut TxContext,
    ): CrossChainMessage {
        CrossChainMessage {
            id: object::new(ctx),
            message_id,
            source_chain,
            destination_chain,
            payload,
            zk_proof,
            status: 0, // pending
        }
    }
    
    // Verify and execute (consumes hot potato)
    public fun verify_and_execute(
        call: Call<CrossChainMessage, bool>,
        verifier_cap: &ZKVerifierCap,
        ctx: &mut TxContext,
    ): bool {
        // Verify ZK proof
        assert!(verify_zk_proof(&call.param.zk_proof), 0);
        
        // Execute message
        let result = execute_message(call.param);
        
        // Hot potato consumed (cannot be stored or dropped)
        result
    }
}
```

### Event Patterns

```move
// Sui events
struct MessageCreatedEvent has copy, drop {
    message_id: u64,
    source_chain: vector<u8>,
    destination_chain: vector<u8>,
}

struct MessageVerifiedEvent has copy, drop {
    message_id: u64,
    proof_id: vector<u8>,
}

struct MessageExecutedEvent has copy, drop {
    message_id: u64,
    execution_result: bool,
}
```

### Object Ownership Pattern for Cross-Chain

```move
module sui_crosschain::object_bridge {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::table::{Self, Table};
    
    // Escrow object (owned by bridge)
    struct EscrowedToken has key {
        id: UID,
        coin: Coin<SUI>,
        source_chain: vector<u8>,
        destination_address: address,
        message_id: u64,
    }
    
    // Shared registry for cross-chain messages
    struct CrossChainRegistry has key {
        id: UID,
        escrows: Table<u64, EscrowedToken>,
    }
    
    // Lock tokens (creates owned object - fast path)
    public entry fun lock_tokens(
        token: Coin<SUI>,
        destination_chain: vector<u8>,
        destination_address: address,
        message_id: u64,
        ctx: &mut TxContext,
    ) {
        let escrow = EscrowedToken {
            id: object::new(ctx),
            coin: token,
            source_chain: b"sui",
            destination_address,
            message_id,
        };
        
        // Use shared object for multi-party coordination (consensus path)
        // Or owned object for single-party (fast path)
        let registry = borrow_global_mut<CrossChainRegistry>(@registry_address);
        table::add(&mut registry.escrows, message_id, escrow);
        
        emit_event<LockedEvent>(LockedEvent {
            message_id,
            amount: coin::value(&token),
            destination_chain,
        });
    }
    
    // Release tokens (requires shared object access)
    public entry fun release_tokens(
        registry: &mut CrossChainRegistry,
        message_id: u64,
        zk_proof: vector<u8>,
        public_inputs: vector<u8>,
        ctx: &mut TxContext,
    ) {
        // Verify ZK proof
        assert!(verify_crosschain_proof(zk_proof, public_inputs), 0);
        
        // Get escrow from registry
        let EscrowedToken { id, coin, destination_address, .. } = 
            table::remove(&mut registry.escrows, message_id);
        
        // Transfer to destination
        transfer::public_transfer(coin, destination_address);
        
        // Delete object ID to reclaim storage
        object::delete(id);
        
        emit_event<ReleasedEvent>(ReleasedEvent {
            message_id,
            destination_address,
        });
    }
}
```

### Hot Potato Pattern for Cross-Chain Calls

```move
module sui_crosschain::hot_potato {
    use sui::object::{Self, UID};
    
    // Call struct with no drop/store abilities (hot potato)
    struct Call<Param, Result> {
        param: Param,
        state: u8, // 0: Active, 1: Creating, 2: Waiting, 3: Completed
    }
    
    // Cross-chain call parameter
    struct CrossChainCallParam {
        message_id: u64,
        source_chain: vector<u8>,
        destination_chain: vector<u8>,
        payload: vector<u8>,
        zk_proof: vector<u8>,
    }
    
    // Create call (must be consumed)
    public fun create_call(
        param: CrossChainCallParam,
    ): Call<CrossChainCallParam, bool> {
        Call<CrossChainCallParam, bool> {
            param,
            state: 0, // Active
        }
    }
    
    // Verify and execute (consumes hot potato)
    public fun verify_and_execute(
        call: Call<CrossChainCallParam, bool>,
    ): bool {
        // Verify ZK proof
        assert!(verify_zk_proof(call.param.zk_proof), 0);
        
        // Execute call
        let result = execute_crosschain_call(call.param);
        
        // Hot potato consumed (cannot be stored or dropped)
        // Must return result or pass to next function
        result
    }
    
    // Lifecycle enforcement: Active -> Creating -> Waiting -> Active -> Completed -> Destroyed
    fun execute_crosschain_call(param: CrossChainCallParam): bool {
        // Process cross-chain message
        true
    }
}
```

### Gas Optimization Techniques

1. **Fast Path Execution**: Use owned objects for single-owner operations (bypasses consensus)
2. **Object Batching**: Batch multiple object operations in PTB
3. **Shared Object Minimization**: Minimize shared object access (requires consensus)
4. **Object Deletion**: Delete objects after use to reclaim storage

```move
// Programmable Transaction Block (PTB) pattern
// Execute multiple operations atomically
public fun batch_crosschain_operations(
    messages: vector<CrossChainMessage>,
    ctx: &mut TxContext,
) {
    let i = 0;
    while (i < vector::length(&messages)) {
        let message = *vector::borrow(&messages, i);
        process_message(message, ctx);
        i = i + 1;
    };
}
```

### Security Considerations

1. **Object Ownership Verification**: Always verify object ownership before operations
2. **Capability-Based Access**: Use capability objects instead of `msg.sender`
3. **Hot Potato Pattern**: Ensure call objects are consumed (cannot be stored)
4. **Shared Object Sequencing**: Handle contention in shared object access

```move
// Capability-based access control
struct AdminCap has key {
    id: UID,
}

public fun admin_only_function(
    admin_cap: &AdminCap,
    // ... params
) {
    // Function can only be called with AdminCap
    // No need to check msg.sender
}

// Ownership verification
public fun transfer_if_owner(
    obj: CrossChainMessage,
    owner: address,
    ctx: &mut TxContext,
) {
    assert!(object::id(&obj) == owner, 0); // E_NOT_OWNER
    transfer::transfer(obj, owner, ctx);
}
```

### ZK-Based Protocol Mapping

- **Object State Proofs**: ZK proofs of object state without revealing contents
- **Cross-Chain Object Transfers**: Prove object lock without revealing object data
- **Private Object Updates**: Update objects with ZK proofs
- **Recursive Object Verification**: Verify SP1 proofs for object operations

```move
// ZK proof for object state
public fun prove_object_state(
    obj_id: ID,
    state_hash: vector<u8>,
    zk_proof: vector<u8>,
): bool {
    // Verify ZK proof that object has specific state
    // without revealing object contents
    verify_zk_proof(zk_proof, state_hash)
}
```

---

## 6. x402 Micropayments - Deferred Payment Patterns & Agent Claims

### Key Data Structures/Interfaces

```solidity
// x402 Payment Contract
contract X402Payment {
    struct PaymentRequest {
        bytes32 requestId;
        address payee;
        address payer;
        uint256 amount;
        address token; // USDC, EGLD, etc.
        uint256 deadline;
        bytes32 resourceHash; // Hash of resource being paid for
        PaymentStatus status;
    }
    
    enum PaymentStatus {
        PENDING,
        PAID,
        CLAIMED,
        EXPIRED,
        REFUNDED
    }
    
    struct DeferredClaim {
        bytes32 claimId;
        bytes32 paymentId;
        address claimer; // Agent claiming the payment
        address originalPayer;
        uint256 claimAmount;
        uint256 claimDeadline;
        bytes32 claimProof; // ZK proof of service delivery
        bool executed;
    }
    
    // Agent-to-agent payment claim
    struct AgentClaim {
        bytes32 claimId;
        address fromAgent;
        address toAgent;
        uint256 amount;
        bytes32 serviceProof; // Proof agent delivered service
        uint256 timestamp;
    }
    
    mapping(bytes32 => PaymentRequest) public payments;
    mapping(bytes32 => DeferredClaim) public deferredClaims;
    mapping(bytes32 => bool) public paymentNullifiers;
    mapping(address => uint256) public agentNonces;
}
```

### Event Patterns

```solidity
event PaymentRequested(
    bytes32 indexed requestId,
    address indexed payee,
    address indexed payer,
    uint256 amount,
    bytes32 resourceHash
);

event PaymentSubmitted(
    bytes32 indexed requestId,
    bytes32 indexed transactionHash,
    address indexed payer
);

event PaymentClaimed(
    bytes32 indexed requestId,
    address indexed claimer,
    uint256 amount
);

event DeferredClaimCreated(
    bytes32 indexed claimId,
    bytes32 indexed paymentId,
    address indexed claimer,
    uint256 claimAmount
);

event AgentToAgentClaim(
    bytes32 indexed claimId,
    address indexed fromAgent,
    address indexed toAgent,
    uint256 amount,
    bytes32 serviceProof
);
```

### Deferred Payment Pattern

```solidity
// Deferred payment allows agent to claim payment after service delivery
function createDeferredPayment(
    address payee,
    uint256 amount,
    address token,
    uint256 claimDeadline,
    bytes32 resourceHash
) external returns (bytes32 requestId) {
    requestId = keccak256(abi.encodePacked(
        msg.sender,
        payee,
        amount,
        block.timestamp,
        agentNonces[msg.sender]++
    ));
    
    PaymentRequest storage request = payments[requestId];
    request.requestId = requestId;
    request.payee = payee;
    request.payer = msg.sender;
    request.amount = amount;
    request.token = token;
    request.deadline = claimDeadline;
    request.resourceHash = resourceHash;
    request.status = PaymentStatus.PENDING;
    
    // Lock funds in escrow
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    
    emit PaymentRequested(requestId, payee, msg.sender, amount, resourceHash);
    return requestId;
}

// Agent claims payment after delivering service
function claimDeferredPayment(
    bytes32 requestId,
    bytes32 serviceProof, // ZK proof of service delivery
    bytes calldata proofData
) external {
    PaymentRequest storage request = payments[requestId];
    require(request.status == PaymentStatus.PENDING, "Invalid status");
    require(block.timestamp <= request.deadline, "Claim expired");
    require(msg.sender == request.payee, "Unauthorized claimer");
    
    // Verify service proof (ZK proof that service was delivered)
    require(verifyServiceProof(serviceProof, request.resourceHash, proofData), "Invalid proof");
    
    // Execute payment
    request.status = PaymentStatus.CLAIMED;
    IERC20(request.token).transfer(request.payee, request.amount);
    
    emit PaymentClaimed(requestId, msg.sender, request.amount);
}
```

### Agent-to-Agent Claims Pattern

```solidity
// Agent A claims payment from Agent B for delivered service
function submitAgentClaim(
    address toAgent,
    uint256 amount,
    address token,
    bytes32 serviceProof,
    bytes calldata proofData
) external returns (bytes32 claimId) {
    claimId = keccak256(abi.encodePacked(
        msg.sender,
        toAgent,
        amount,
        block.timestamp,
        agentNonces[msg.sender]++
    ));
    
    // Verify service proof
    require(verifyServiceProof(serviceProof, keccak256(abi.encodePacked(toAgent, amount)), proofData), "Invalid proof");
    
    AgentClaim memory claim = AgentClaim({
        claimId: claimId,
        fromAgent: msg.sender,
        toAgent: toAgent,
        amount: amount,
        serviceProof: serviceProof,
        timestamp: block.timestamp
    });
    
    agentClaims[claimId] = claim;
    
    // If toAgent has sufficient balance/allowance, execute immediately
    // Otherwise, create deferred claim
    if (IERC20(token).balanceOf(toAgent) >= amount && 
        IERC20(token).allowance(toAgent, address(this)) >= amount) {
        IERC20(token).transferFrom(toAgent, msg.sender, amount);
        claim.executed = true;
    }
    
    emit AgentToAgentClaim(claimId, msg.sender, toAgent, amount, serviceProof);
    return claimId;
}

// Agent executes claim against them (pays the claimer)
function executeClaimAgainstMe(
    bytes32 claimId,
    bytes calldata authorizationSignature
) external {
    AgentClaim storage claim = agentClaims[claimId];
    require(claim.toAgent == msg.sender, "Not your claim");
    require(!claim.executed, "Already executed");
    
    // Verify authorization signature
    bytes32 hash = keccak256(abi.encodePacked(claimId, msg.sender));
    require(_verifySignature(hash, authorizationSignature), "Invalid signature");
    
    // Execute payment
    claim.executed = true;
    IERC20(token).transferFrom(msg.sender, claim.fromAgent, claim.amount);
    
    emit ClaimExecuted(claimId, msg.sender, claim.fromAgent);
}
```

### Gas Optimization Techniques

1. **Batch Claims**: Process multiple claims in one transaction
2. **Gasless Execution**: Use relayed transactions (MultiversX Relayed v3)
3. **Payment Aggregation**: Aggregate multiple micropayments into one
4. **Lazy Verification**: Verify proofs only when claims are disputed

```solidity
// Batch claim processing
function batchProcessClaims(
    bytes32[] calldata claimIds,
    bytes32[] calldata serviceProofs,
    bytes[] calldata proofData
) external {
    require(claimIds.length == serviceProofs.length, "Length mismatch");
    
    uint256 totalAmount = 0;
    for (uint256 i = 0; i < claimIds.length; i++) {
        PaymentRequest storage request = payments[claimIds[i]];
        require(verifyServiceProof(serviceProofs[i], request.resourceHash, proofData[i]), "Invalid proof");
        totalAmount += request.amount;
    }
    
    // Single transfer for all claims
    IERC20(token).transfer(msg.sender, totalAmount);
}
```

### Security Considerations

1. **Nullifiers**: Prevent double-claiming of payments
2. **Replay Protection**: Use nonces for agent claims
3. **Deadline Enforcement**: Expire unclaimed payments
4. **Proof Verification**: Always verify service proofs before payment

```solidity
mapping(bytes32 => bool) public claimNullifiers;

function claimPayment(
    bytes32 requestId,
    bytes32 serviceProof,
    bytes calldata proofData
) external {
    bytes32 nullifier = keccak256(abi.encodePacked(requestId, msg.sender));
    require(!claimNullifiers[nullifier], "Already claimed");
    
    PaymentRequest storage request = payments[requestId];
    require(block.timestamp <= request.deadline, "Expired");
    require(verifyServiceProof(serviceProof, request.resourceHash, proofData), "Invalid proof");
    
    claimNullifiers[nullifier] = true;
    request.status = PaymentStatus.CLAIMED;
    
    IERC20(request.token).transfer(msg.sender, request.amount);
    emit PaymentClaimed(requestId, msg.sender, request.amount);
}
```

### HTTP 402 Header Implementation Pattern

```solidity
// x402 HTTP 402 Payment Required Response Handler
contract X402PaymentHandler {
    struct PaymentInstruction {
        address token;           // USDC, EGLD, etc.
        uint256 amount;
        uint256 deadline;
        bytes32 resourceHash;
        string paymentAddress;   // On-chain address or payment endpoint
    }
    
    // Generate HTTP 402 response headers
    function generate402Headers(
        PaymentInstruction memory instruction
    ) external pure returns (string memory headers) {
        // X-PAYMENT header format:
        // X-PAYMENT: token=<address>,amount=<amount>,deadline=<timestamp>,resource=<hash>
        return string(abi.encodePacked(
            "HTTP/1.1 402 Payment Required\r\n",
            "X-PAYMENT: token=", _addressToString(instruction.token),
            ",amount=", _uintToString(instruction.amount),
            ",deadline=", _uintToString(instruction.deadline),
            ",resource=", _bytes32ToString(instruction.resourceHash),
            "\r\n"
        ));
    }
    
    // Process X-PAYMENT header from client request
    function processPaymentHeader(
        string calldata paymentHeader
    ) external returns (PaymentInstruction memory) {
        // Parse X-PAYMENT header
        // Extract token, amount, deadline, resource hash
        // Verify payment signature
        // Return payment instruction
    }
    
    // EIP-3009 TransferWithAuthorization for gasless payments
    function transferWithAuthorization(
        address from,
        address to,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        // Verify authorization signature
        bytes32 hash = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            keccak256(abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                amount,
                validAfter,
                validBefore,
                nonce
            ))
        ));
        
        address signer = ecrecover(hash, v, r, s);
        require(signer == from, "Invalid signature");
        require(block.timestamp >= validAfter, "Not yet valid");
        require(block.timestamp <= validBefore, "Expired");
        require(!authorizationStates[from][nonce], "Already used");
        
        authorizationStates[from][nonce] = true;
        IERC20(token).transferFrom(from, to, amount);
        
        emit AuthorizationUsed(from, nonce);
    }
}
```

### Relayer Pattern for Gasless Payments

```solidity
// Relayer covers gas fees for agent micropayments
contract PaymentRelayer {
    struct RelayedPayment {
        address payer;
        address payee;
        uint256 amount;
        bytes32 paymentHash;
        bool executed;
    }
    
    mapping(bytes32 => RelayedPayment) public relayedPayments;
    
    // Relayer submits payment and covers gas
    function relayPayment(
        address payer,
        address payee,
        uint256 amount,
        bytes calldata authorizationSignature
    ) external {
        bytes32 paymentHash = keccak256(abi.encodePacked(
            payer,
            payee,
            amount,
            block.timestamp
        ));
        
        // Verify payer's authorization signature
        require(_verifyAuthorization(payer, paymentHash, authorizationSignature), "Invalid auth");
        
        // Relayer pays gas, executes payment
        IERC20(token).transferFrom(payer, payee, amount);
        
        relayedPayments[paymentHash] = RelayedPayment({
            payer: payer,
            payee: payee,
            amount: amount,
            paymentHash: paymentHash,
            executed: true
        });
        
        emit PaymentRelayed(paymentHash, payer, payee, amount, msg.sender);
    }
}
```

### ZK-Based Protocol Mapping

- **Private Service Proofs**: Prove service delivery without revealing service details
- **Selective Payment Disclosure**: Reveal payment amount but hide service details
- **Aggregated Micropayments**: Batch verify multiple payment proofs with ZK
- **Agent Identity Privacy**: Prove agent eligibility without revealing identity
- **Private Payment Authorization**: ZK proofs for payment authorization without revealing payer identity

```rust
// ZK proof for service delivery
pub fn prove_service_delivery(
    service_hash: &[u8; 32],
    resource_hash: &[u8; 32],
    agent_secret: &[u8; 32],
) -> Proof {
    // Prove that agent delivered service matching resource_hash
    // without revealing service details or agent secret
    let public_values = commit!(resource_hash);
    // ... generate proof
}
```

---

## Summary: Common Patterns Across All Protocols

### Universal ZK Integration Patterns

1. **Nullifier Pattern**: Prevent double-spending/replay across all protocols
2. **Merkle Tree Commitments**: Efficient verification of large datasets
3. **Selective Disclosure**: Commit only necessary public values
4. **Proof Aggregation**: Batch verify multiple proofs efficiently
5. **Recursive Verification**: Verify proofs within proofs for complex pipelines

### Gas Optimization Strategies

1. **Batch Operations**: Process multiple items in single transaction
2. **Storage Optimization**: Use hashes instead of full data
3. **Lazy Evaluation**: Defer expensive operations
4. **Native Cryptographic Functions**: Use built-in verifiers when available

### Security Best Practices

1. **Replay Protection**: Nonces and nullifiers
2. **Access Control**: Capability-based or signature-based
3. **Deadline Enforcement**: Time-bound operations
4. **Proof Verification**: Always verify before state changes

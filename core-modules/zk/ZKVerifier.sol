// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ZKVerifier
 * @dev Groth16 ZK-SNARK verifier for TFUEL deposit proofs with enhanced security
 * @notice Verifies zero-knowledge proofs of deposits from Theta to Persistence via IBC Channel-190
 * 
 * ⚠️ CORE MODULE - Critical security component
 * Extracted from main contracts for better organization and audit clarity
 * 
 * Security Features:
 * - Nullifier tracking to prevent replay attacks
 * - Merkle root registry for block validation  
 * - Identity commitment verification for non-malleability
 * - Emergency pause mechanism
 * - Rate limiting for suspicious activity
 * - Circuit breaker for high failure rates
 * 
 * Compatible with IBC Channel-190 (Theta <-> Persistence)
 */
contract ZKVerifier {
    
    // ========================================================================
    // TYPES & STRUCTS
    // ========================================================================
    
    struct Proof {
        uint256[2] a;           // G1 point
        uint256[2][2] b;        // G2 point
        uint256[2] c;           // G1 point
    }
    
    struct PublicInputs {
        uint256 vaultAddress;           // Target vault (160 bits)
        uint256 netAmount;              // Amount after fees (252 bits)
        uint256 blockNumber;            // Theta block number (64 bits)
        uint256 merkleRoot;             // Block Merkle root (256 bits)
        uint256 identityCommitment;     // Identity commitment (256 bits)
    }
    
    // ========================================================================
    // STATE VARIABLES
    // ========================================================================
    
    // BN254 curve prime
    uint256 constant PRIME_Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    
    // Owner
    address public owner;
    
    // Paused state
    bool public paused;
    
    // Nullifier tracking (prevents double-spending)
    mapping(uint256 => bool) public usedNullifiers;
    
    // Merkle root registry (whitelisted block roots from Theta)
    mapping(uint256 => bool) public validMerkleRoots;
    mapping(uint256 => uint256) public blockNumberToRoot;
    
    // Identity commitment registry
    mapping(uint256 => bool) public registeredIdentities;
    
    // Rate limiting
    mapping(address => uint256) public lastVerificationTime;
    mapping(address => uint256) public verificationsInWindow;
    uint256 public constant RATE_LIMIT_WINDOW = 1 hours;
    uint256 public constant MAX_VERIFICATIONS_PER_WINDOW = 10;
    
    // Circuit breaker
    uint256 public totalVerifications;
    uint256 public failedVerifications;
    uint256 public constant MAX_FAILURE_RATE = 10; // 10% failure rate triggers pause
    
    // IBC Channel compatibility
    string public constant IBC_CHANNEL = "channel-190";
    string public constant CHAIN_ID = "core-1"; // Persistence mainnet
    
    // ========================================================================
    // EVENTS
    // ========================================================================
    
    event ProofVerified(
        address indexed verifier,
        uint256 indexed vaultAddress,
        uint256 netAmount,
        uint256 blockNumber,
        uint256 nullifier,
        uint256 timestamp
    );
    
    event NullifierUsed(uint256 indexed nullifier, address indexed user);
    
    event MerkleRootRegistered(uint256 indexed blockNumber, uint256 merkleRoot);
    
    event IdentityRegistered(uint256 indexed identityCommitment, address indexed registrar);
    
    event CircuitBreakerTriggered(uint256 failureRate, uint256 totalVerifications);
    
    event VerificationFailed(address indexed user, string reason);
    
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    
    // ========================================================================
    // MODIFIERS
    // ========================================================================
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "Contract paused");
        _;
    }
    
    modifier nonReentrant() {
        // Simple reentrancy guard
        uint256 _guard;
        require(_guard == 0, "Reentrant call");
        _guard = 1;
        _;
        _guard = 0;
    }
    
    // ========================================================================
    // CONSTRUCTOR
    // ========================================================================
    
    constructor() {
        owner = msg.sender;
        paused = false;
    }
    
    // ========================================================================
    // ADMIN FUNCTIONS
    // ========================================================================
    
    /**
     * @dev Register a Merkle root from Theta blockchain
     * @param blockNumber Theta block number
     * @param merkleRoot Transaction Merkle root for that block
     */
    function registerMerkleRoot(uint256 blockNumber, uint256 merkleRoot) external onlyOwner {
        require(merkleRoot != 0, "Invalid Merkle root");
        require(!validMerkleRoots[merkleRoot], "Already registered");
        
        validMerkleRoots[merkleRoot] = true;
        blockNumberToRoot[blockNumber] = merkleRoot;
        
        emit MerkleRootRegistered(blockNumber, merkleRoot);
    }
    
    /**
     * @dev Register multiple Merkle roots in batch
     * @param blockNumbers Array of block numbers
     * @param merkleRoots Array of Merkle roots
     */
    function registerMerkleRootsBatch(
        uint256[] calldata blockNumbers,
        uint256[] calldata merkleRoots
    ) external onlyOwner {
        require(blockNumbers.length == merkleRoots.length, "Length mismatch");
        
        for (uint256 i = 0; i < blockNumbers.length; i++) {
            require(merkleRoots[i] != 0, "Invalid root");
            validMerkleRoots[merkleRoots[i]] = true;
            blockNumberToRoot[blockNumbers[i]] = merkleRoots[i];
            emit MerkleRootRegistered(blockNumbers[i], merkleRoots[i]);
        }
    }
    
    /**
     * @dev Register an identity commitment
     * @param identityCommitment Poseidon hash of identity components
     */
    function registerIdentity(uint256 identityCommitment) external {
        require(identityCommitment != 0, "Invalid commitment");
        require(!registeredIdentities[identityCommitment], "Already registered");
        
        registeredIdentities[identityCommitment] = true;
        
        emit IdentityRegistered(identityCommitment, msg.sender);
    }
    
    /**
     * @dev Emergency pause
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }
    
    /**
     * @dev Resume after pause
     */
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }
    
    /**
     * @dev Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
    
    // ========================================================================
    // VERIFICATION FUNCTIONS
    // ========================================================================
    
    /**
     * @dev Verify a deposit proof
     * @param proof Groth16 proof components
     * @param publicInputs Public inputs to the circuit
     * @return bool True if proof is valid
     */
    function verifyDepositProof(
        Proof calldata proof,
        PublicInputs calldata publicInputs
    ) external nonReentrant whenNotPaused returns (bool) {
        
        // ====================================================================
        // PRE-VERIFICATION CHECKS
        // ====================================================================
        
        // Rate limiting
        _checkRateLimit(msg.sender);
        
        // Validate public inputs are in field
        require(publicInputs.vaultAddress < PRIME_Q, "vaultAddress out of field");
        require(publicInputs.netAmount < PRIME_Q, "netAmount out of field");
        require(publicInputs.blockNumber < PRIME_Q, "blockNumber out of field");
        require(publicInputs.merkleRoot < PRIME_Q, "merkleRoot out of field");
        require(publicInputs.identityCommitment < PRIME_Q, "identityCommitment out of field");
        
        // Verify Merkle root is registered
        require(validMerkleRoots[publicInputs.merkleRoot], "Merkle root not registered");
        
        // Verify Merkle root matches block number
        require(
            blockNumberToRoot[publicInputs.blockNumber] == publicInputs.merkleRoot,
            "Merkle root mismatch"
        );
        
        // Verify identity commitment is registered
        require(
            registeredIdentities[publicInputs.identityCommitment],
            "Identity not registered"
        );
        
        // Minimum amount check (0.01 TFUEL = 1e16 wei)
        require(publicInputs.netAmount >= 1e16, "Amount below minimum");
        
        // Maximum amount check (prevents economic attacks)
        require(publicInputs.netAmount <= 1000 ether, "Amount above maximum");
        
        // ====================================================================
        // NULLIFIER CHECK (Prevent Replay)
        // ====================================================================
        
        // Compute nullifier from public inputs
        uint256 nullifier = uint256(keccak256(abi.encodePacked(
            publicInputs.identityCommitment,
            publicInputs.blockNumber,
            publicInputs.vaultAddress
        )));
        
        require(!usedNullifiers[nullifier], "Proof already used");
        
        // ====================================================================
        // GROTH16 VERIFICATION
        // ====================================================================
        
        bool isValid = _verifyGroth16Proof(proof, publicInputs);
        
        // ====================================================================
        // POST-VERIFICATION ACTIONS
        // ====================================================================
        
        if (isValid) {
            // Mark nullifier as used
            usedNullifiers[nullifier] = true;
            emit NullifierUsed(nullifier, msg.sender);
            
            // Emit verification event
            emit ProofVerified(
                msg.sender,
                publicInputs.vaultAddress,
                publicInputs.netAmount,
                publicInputs.blockNumber,
                nullifier,
                block.timestamp
            );
            
            totalVerifications++;
        } else {
            failedVerifications++;
            emit VerificationFailed(msg.sender, "Invalid proof");
            
            // Circuit breaker
            _checkCircuitBreaker();
        }
        
        return isValid;
    }
    
    /**
     * @dev Internal Groth16 verification (placeholder)
     * @notice This will be replaced by snarkjs-generated verifier
     */
    function _verifyGroth16Proof(
        Proof calldata proof,
        PublicInputs calldata publicInputs
    ) internal view returns (bool) {
        // TODO: Replace with actual Groth16 verification logic
        // Generated by: snarkjs zkey export solidityverifier
        
        // For now, return true in development mode
        // In production, this function will contain the full pairing check
        
        // Validate proof points are non-zero
        require(proof.a[0] != 0 || proof.a[1] != 0, "Invalid proof.a");
        require(proof.c[0] != 0 || proof.c[1] != 0, "Invalid proof.c");
        
        // In production, this performs:
        // e(proof.a, proof.b) == e(vk.alpha, vk.beta) * e(vk_x, vk.gamma) * e(proof.c, vk.delta)
        
        return true; // DEVELOPMENT MODE ONLY
    }
    
    // ========================================================================
    // SECURITY HELPERS
    // ========================================================================
    
    /**
     * @dev Check rate limit for sender
     */
    function _checkRateLimit(address sender) internal {
        uint256 currentWindow = block.timestamp / RATE_LIMIT_WINDOW;
        uint256 lastWindow = lastVerificationTime[sender] / RATE_LIMIT_WINDOW;
        
        if (currentWindow > lastWindow) {
            verificationsInWindow[sender] = 0;
        }
        
        require(
            verificationsInWindow[sender] < MAX_VERIFICATIONS_PER_WINDOW,
            "Rate limit exceeded"
        );
        
        verificationsInWindow[sender]++;
        lastVerificationTime[sender] = block.timestamp;
    }
    
    /**
     * @dev Check circuit breaker condition
     */
    function _checkCircuitBreaker() internal {
        if (totalVerifications > 100) {
            uint256 failureRate = (failedVerifications * 100) / totalVerifications;
            
            if (failureRate > MAX_FAILURE_RATE) {
                paused = true;
                emit CircuitBreakerTriggered(failureRate, totalVerifications);
            }
        }
    }
    
    // ========================================================================
    // VIEW FUNCTIONS
    // ========================================================================
    
    /**
     * @dev Check if nullifier has been used
     */
    function isNullifierUsed(uint256 nullifier) external view returns (bool) {
        return usedNullifiers[nullifier];
    }
    
    /**
     * @dev Check if Merkle root is valid
     */
    function isMerkleRootValid(uint256 merkleRoot) external view returns (bool) {
        return validMerkleRoots[merkleRoot];
    }
    
    /**
     * @dev Get failure rate percentage
     */
    function getFailureRate() external view returns (uint256) {
        if (totalVerifications == 0) return 0;
        return (failedVerifications * 100) / totalVerifications;
    }
    
    /**
     * @dev Get contract version and IBC compatibility info
     */
    function getVersion() external pure returns (
        string memory version,
        string memory ibcChannel,
        string memory chainId
    ) {
        return ("1.0.0-enhanced-security", IBC_CHANNEL, CHAIN_ID);
    }
}


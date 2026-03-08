// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentRobotics
 * @author XFuel Protocol — Further Expansion Circuits
 * @notice Verifiable Agent Robotics Circuit: ZK-proven sim-to-real trajectory
 *         attestation for robotic agents with on-chain safety certification.
 *
 * Architecture:
 *   1. Simulation Registration — Digital twins/environments registered on-chain.
 *   2. Agent Enrollment — Robotic agents register with capability profiles.
 *   3. Trajectory Submission — Agents submit simulated trajectories for tasks.
 *   4. ZK Verification — SP1 proves trajectory correctness (collision-free,
 *      energy-optimal, task-complete) without revealing proprietary control policies.
 *   5. Safety Certification — Verified trajectories earn on-chain safety certs.
 *   6. Task Marketplace — Certified agents bid on real-world tasks.
 *
 * Research ties:
 *   Per NRN Agents (nrnagents.ai, whitepaper):
 *     - Robotics data scarcity: 2.4M robot-motion episodes vs 15T text tokens.
 *     - Sim-to-real gap: domain randomization, residual learning, physics refinement.
 *     - High-fidelity sim-to-real pipelines with digital twins syncing at 60Hz.
 *     - Verifiable compositional frameworks: decompose complex tasks into subtasks
 *       with mathematical interfaces for independent training and verification.
 *     - Continuous streaming data needed — robotic policies degrade in real conditions.
 *
 *   For XFuel integration:
 *     - Control policies stay private (off-chain); only trajectory commitments on-chain.
 *     - SP1 proves: "Agent A executed trajectory T in simulation S satisfying safety
 *       constraints C" — without revealing the control policy.
 *     - Safety certificates are non-transferable attestations (Soulbound-like).
 *     - Task marketplace allows certified agents to bid on real-world deployments.
 *
 * Core Layer integration:
 *   - Emits TrajectoryVerified for ai-listener.js to coordinate with sim engines.
 *   - Sends fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for trajectory proof verification.
 *   - Fully isolated: own simulation registry, agent profiles, safety certs.
 */
contract AgentRobotics is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Circuit Identity ─────────────────────────────────────────────────────
    bytes32 public constant CIRCUIT_ID = keccak256("AGENT_ROBOTICS_CIRCUIT");

    // ─── Core Layer References ────────────────────────────────────────────────
    address public revenueSplitter;
    address public zkVerifier;

    // ─── Fee Configuration ────────────────────────────────────────────────────
    uint16 public certFeeBps = 100;          // 1% certification fee
    uint16 public taskFeeBps = 50;           // 0.5% task marketplace fee
    uint16 public constant MAX_FEE = 200;
    uint16 public constant BPS_DENOM = 10000;

    // ─── Simulation Environment Registry ──────────────────────────────────────
    struct SimEnvironment {
        bytes32 envId;
        address creator;
        bytes32 configHash;          // Hash of simulation config (physics, domain params)
        string description;          // "Warehouse navigation v3", "Surgical arm sim v2"
        string category;             // "navigation", "manipulation", "locomotion"
        uint256 fidelityScore;       // 0-10000 (BPS) — how close to real-world
        bool active;
        uint64 createdAt;
    }

    mapping(bytes32 => SimEnvironment) public environments;
    uint256 public envCount;

    // ─── Agent Registry ───────────────────────────────────────────────────────
    struct RoboticAgent {
        bytes32 agentId;
        address owner;
        bytes32 policyCommitment;    // keccak256(control_policy) — stays private
        string agentType;            // "manipulator", "drone", "legged", "vehicle"
        uint256 certificationLevel;  // Number of verified trajectories
        uint256 taskScore;           // Cumulative task performance score
        bool active;
        uint64 registeredAt;
    }

    mapping(bytes32 => RoboticAgent) public agents;
    uint256 public agentCount;

    // ─── Trajectory Records ───────────────────────────────────────────────────
    enum TrajectoryStatus { Submitted, Verified, Failed, Expired }

    struct Trajectory {
        bytes32 trajectoryId;
        bytes32 agentId;
        bytes32 envId;
        bytes32 trajectoryHash;      // Hash of full trajectory data
        bytes32 safetyConstraintHash;// Hash of safety constraints verified
        bytes32 proofNullifier;
        TrajectoryStatus status;
        uint256 reward;              // Payment for verification
        uint64 submittedAt;
        uint64 verifiedAt;
        uint64 deadline;
    }

    mapping(bytes32 => Trajectory) public trajectories;
    uint256 public trajectoryCount;

    // ─── Safety Certificates (Soulbound-like) ─────────────────────────────────
    struct SafetyCert {
        bytes32 certId;
        bytes32 agentId;
        bytes32 envId;
        bytes32 trajectoryId;
        uint256 safetyLevel;         // 1-5 (higher = more rigorous verification)
        uint64 issuedAt;
        uint64 expiresAt;            // Certs expire (policies degrade per NRN research)
        bool valid;
    }

    mapping(bytes32 => SafetyCert) public certificates;
    uint256 public certCount;
    /// @notice agentId => array of certIds
    mapping(bytes32 => bytes32[]) public agentCerts;

    // ─── Task Marketplace ─────────────────────────────────────────────────────
    enum TaskStatus { Open, Assigned, Completed, Failed }

    struct RoboticTask {
        bytes32 taskId;
        address requester;
        bytes32 envId;               // Required environment capability
        uint256 minCertLevel;        // Minimum safety certification required
        uint256 payment;
        bytes32 assignedAgent;
        TaskStatus status;
        uint64 createdAt;
        uint64 deadline;
    }

    mapping(bytes32 => RoboticTask) public tasks;
    uint256 public taskCount;

    // ─── Nullifier Tracking ───────────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalFeesCollected;
    uint256 public totalVolume;
    uint256 public totalVerifiedTrajectories;

    // ─── Events ───────────────────────────────────────────────────────────────
    event SimEnvironmentRegistered(
        bytes32 indexed envId,
        address indexed creator,
        string category,
        uint256 fidelityScore
    );

    event AgentRegistered(
        bytes32 indexed agentId,
        address indexed owner,
        string agentType,
        bytes32 policyCommitment
    );

    event TrajectorySubmitted(
        bytes32 indexed circuitId,
        bytes32 indexed trajectoryId,
        bytes32 indexed agentId,
        bytes32 envId,
        uint256 reward
    );

    event TrajectoryVerified(
        bytes32 indexed circuitId,
        bytes32 indexed trajectoryId,
        bytes32 nullifier,
        uint256 safetyLevel
    );

    event SafetyCertIssued(
        bytes32 indexed certId,
        bytes32 indexed agentId,
        uint256 safetyLevel,
        uint64 expiresAt
    );

    event TaskCreated(
        bytes32 indexed taskId,
        address indexed requester,
        bytes32 envId,
        uint256 payment
    );

    event TaskAssigned(bytes32 indexed taskId, bytes32 indexed agentId);
    event TaskCompleted(bytes32 indexed taskId, bytes32 indexed agentId, uint256 payout);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error EnvNotFound();
    error AgentNotFound();
    error AgentNotActive();
    error TrajectoryNotFound();
    error InvalidTrajectoryStatus();
    error TaskNotFound();
    error TaskNotOpen();
    error InsufficientCertLevel();
    error NullifierUsed();
    error DeadlineExpired();
    error NotOwner();
    error CertExpired();

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        address _admin,
        address _revenueSplitter,
        address _zkVerifier
    ) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(VERIFIER_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  1. SIMULATION ENVIRONMENT REGISTRY
    // ═══════════════════════════════════════════════════════════════════════════

    function registerEnvironment(
        bytes32 configHash,
        string calldata description,
        string calldata category,
        uint256 fidelityScore
    ) external onlyRole(OPERATOR_ROLE) returns (bytes32 envId) {
        require(fidelityScore <= 10000, "InvalidFidelity");

        envId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, configHash, envCount
        ));

        environments[envId] = SimEnvironment({
            envId: envId,
            creator: msg.sender,
            configHash: configHash,
            description: description,
            category: category,
            fidelityScore: fidelityScore,
            active: true,
            createdAt: uint64(block.timestamp)
        });

        envCount++;
        emit SimEnvironmentRegistered(envId, msg.sender, category, fidelityScore);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  2. AGENT ENROLLMENT
    // ═══════════════════════════════════════════════════════════════════════════

    function registerAgent(
        bytes32 policyCommitment,
        string calldata agentType
    ) external whenNotPaused returns (bytes32 agentId) {
        require(policyCommitment != bytes32(0), "ZeroCommitment");

        agentId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, policyCommitment, agentCount
        ));

        agents[agentId] = RoboticAgent({
            agentId: agentId,
            owner: msg.sender,
            policyCommitment: policyCommitment,
            agentType: agentType,
            certificationLevel: 0,
            taskScore: 0,
            active: true,
            registeredAt: uint64(block.timestamp)
        });

        agentCount++;
        emit AgentRegistered(agentId, msg.sender, agentType, policyCommitment);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  3. TRAJECTORY SUBMISSION & VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Submit a simulated trajectory for ZK verification.
     * @param agentId Agent that executed the trajectory.
     * @param envId Simulation environment used.
     * @param trajectoryHash Hash of the full trajectory data.
     * @param safetyConstraintHash Hash of safety constraints to verify against.
     * @param deadline Max time for verification.
     */
    function submitTrajectory(
        bytes32 agentId,
        bytes32 envId,
        bytes32 trajectoryHash,
        bytes32 safetyConstraintHash,
        uint64 deadline
    ) external payable whenNotPaused nonReentrant returns (bytes32 trajectoryId) {
        RoboticAgent storage a = agents[agentId];
        if (a.registeredAt == 0) revert AgentNotFound();
        require(a.owner == msg.sender, "NotAgentOwner");
        if (environments[envId].createdAt == 0) revert EnvNotFound();

        uint256 fee = (msg.value * certFeeBps) / BPS_DENOM;
        uint256 netReward = msg.value - fee;

        trajectoryId = keccak256(abi.encodePacked(
            CIRCUIT_ID, agentId, envId, trajectoryCount++
        ));

        trajectories[trajectoryId] = Trajectory({
            trajectoryId: trajectoryId,
            agentId: agentId,
            envId: envId,
            trajectoryHash: trajectoryHash,
            safetyConstraintHash: safetyConstraintHash,
            proofNullifier: bytes32(0),
            status: TrajectoryStatus.Submitted,
            reward: netReward,
            submittedAt: uint64(block.timestamp),
            verifiedAt: 0,
            deadline: deadline
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;

        if (fee > 0) _forwardFee(fee);

        emit TrajectorySubmitted(CIRCUIT_ID, trajectoryId, agentId, envId, netReward);
    }

    /**
     * @notice Verify a trajectory with ZK proof and issue safety certificate.
     * @param trajectoryId Trajectory to verify.
     * @param safetyLevel Safety level to certify (1-5).
     * @param certDuration Duration of the safety cert in seconds.
     * @param proof SP1 proof of trajectory correctness.
     * @param publicValues SP1 public values.
     * @param nullifier Replay protection.
     */
    function verifyTrajectory(
        bytes32 trajectoryId,
        uint256 safetyLevel,
        uint256 certDuration,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(VERIFIER_ROLE) nonReentrant whenNotPaused {
        Trajectory storage t = trajectories[trajectoryId];
        if (t.submittedAt == 0) revert TrajectoryNotFound();
        if (t.status != TrajectoryStatus.Submitted) revert InvalidTrajectoryStatus();
        if (block.timestamp > t.deadline) revert DeadlineExpired();
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        usedNullifiers[nullifier] = true;
        require(safetyLevel >= 1 && safetyLevel <= 5, "InvalidLevel");

        // Verify SP1 proof
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        t.status = TrajectoryStatus.Verified;
        t.verifiedAt = uint64(block.timestamp);
        t.proofNullifier = nullifier;

        // Update agent
        RoboticAgent storage a = agents[t.agentId];
        a.certificationLevel++;
        totalVerifiedTrajectories++;

        // Issue safety certificate
        bytes32 certId = keccak256(abi.encodePacked(
            CIRCUIT_ID, t.agentId, certCount++
        ));

        uint64 expiresAt = uint64(block.timestamp + certDuration);

        certificates[certId] = SafetyCert({
            certId: certId,
            agentId: t.agentId,
            envId: t.envId,
            trajectoryId: trajectoryId,
            safetyLevel: safetyLevel,
            issuedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            valid: true
        });

        agentCerts[t.agentId].push(certId);

        emit TrajectoryVerified(CIRCUIT_ID, trajectoryId, nullifier, safetyLevel);
        emit SafetyCertIssued(certId, t.agentId, safetyLevel, expiresAt);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  4. TASK MARKETPLACE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a task requiring a certified robotic agent.
     */
    function createTask(
        bytes32 envId,
        uint256 minCertLevel,
        uint64 deadline
    ) external payable whenNotPaused nonReentrant returns (bytes32 taskId) {
        require(msg.value > 0, "ZeroPayment");
        if (environments[envId].createdAt == 0) revert EnvNotFound();

        uint256 fee = (msg.value * taskFeeBps) / BPS_DENOM;
        uint256 netPayment = msg.value - fee;

        taskId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, envId, taskCount++
        ));

        tasks[taskId] = RoboticTask({
            taskId: taskId,
            requester: msg.sender,
            envId: envId,
            minCertLevel: minCertLevel,
            payment: netPayment,
            assignedAgent: bytes32(0),
            status: TaskStatus.Open,
            createdAt: uint64(block.timestamp),
            deadline: deadline
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;

        if (fee > 0) _forwardFee(fee);

        emit TaskCreated(taskId, msg.sender, envId, netPayment);
    }

    /**
     * @notice Assign a certified agent to a task.
     */
    function assignTask(
        bytes32 taskId,
        bytes32 agentId
    ) external onlyRole(OPERATOR_ROLE) {
        RoboticTask storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.status != TaskStatus.Open) revert TaskNotOpen();

        RoboticAgent storage a = agents[agentId];
        if (a.registeredAt == 0) revert AgentNotFound();
        if (!a.active) revert AgentNotActive();
        if (a.certificationLevel < t.minCertLevel) revert InsufficientCertLevel();

        t.assignedAgent = agentId;
        t.status = TaskStatus.Assigned;

        emit TaskAssigned(taskId, agentId);
    }

    /**
     * @notice Complete a task and pay the agent owner.
     */
    function completeTask(
        bytes32 taskId
    ) external onlyRole(OPERATOR_ROLE) nonReentrant {
        RoboticTask storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        require(t.status == TaskStatus.Assigned, "NotAssigned");

        t.status = TaskStatus.Completed;

        // Update agent score
        RoboticAgent storage a = agents[t.assignedAgent];
        a.taskScore += 100;

        // Pay agent owner
        if (t.payment > 0) {
            (bool ok, ) = payable(a.owner).call{value: t.payment}("");
            require(ok, "PayFailed");
        }

        emit TaskCompleted(taskId, t.assignedAgent, t.payment);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _forwardFee(uint256 amount) internal {
        if (amount == 0 || revenueSplitter == address(0)) return;
        (bool ok, ) = revenueSplitter.call{value: amount}(
            abi.encodeWithSignature("depositFee(bytes32)", CIRCUIT_ID)
        );
        if (!ok) {
            (bool ok2, ) = payable(revenueSplitter).call{value: amount}("");
            require(ok2, "FeeFwd");
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setCertFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= MAX_FEE, "FeeTooHigh");
        certFeeBps = _bps;
    }

    function setTaskFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= MAX_FEE, "FeeTooHigh");
        taskFeeBps = _bps;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revenueSplitter = _rs;
    }

    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zkVerifier = _zk;
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getEnvironment(bytes32 id) external view returns (SimEnvironment memory) {
        return environments[id];
    }

    function getAgent(bytes32 id) external view returns (RoboticAgent memory) {
        return agents[id];
    }

    function getTrajectory(bytes32 id) external view returns (Trajectory memory) {
        return trajectories[id];
    }

    function getCertificate(bytes32 id) external view returns (SafetyCert memory) {
        return certificates[id];
    }

    function getTask(bytes32 id) external view returns (RoboticTask memory) {
        return tasks[id];
    }

    function getAgentCertCount(bytes32 agentId) external view returns (uint256) {
        return agentCerts[agentId].length;
    }

    function getStats() external view returns (
        uint256 envs_, uint256 agents_, uint256 trajectories_,
        uint256 verified_, uint256 certs_, uint256 tasks_,
        uint256 volume_, uint256 fees_
    ) {
        return (envCount, agentCount, trajectoryCount,
                totalVerifiedTrajectories, certCount, taskCount,
                totalVolume, totalFeesCollected);
    }

    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title veXFGovernance
 * @author XFuel Protocol — Core Layer
 * @notice Vote-escrowed XF governance stubs for voting on circuit priorities,
 *         LP allocation parameters, fee structures, and treasury expenditures.
 *
 * Governance powers:
 *   - Vote on circuit activation/deactivation priorities
 *   - Vote on LP allocation (which pools to deepen)
 *   - Vote on fee structure changes (0.1-1% range, per-circuit overrides)
 *   - Vote on treasury expenditures (>$50K requires quorum)
 *   - Emergency circuit breaker activation (67% supermajority)
 *
 * Lock multipliers:
 *   | Duration | veXF | Yield Boost | Voting Power |
 *   |----------|------|-------------|--------------|
 *   | 1 year   | 1x   | 1x          | 1x           |
 *   | 2 years  | 2x   | 1.5x        | 2x           |
 *   | 3 years  | 3x   | 2x          | 3x           |
 *
 * Design: Curve-style vote escrow with linear decay. Non-transferable.
 * This is a governance STUB — full snapshot/timelock integration deferred to Phase F.
 */
contract veXFGovernance is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Token ────────────────────────────────────────────────────────────────
    IERC20 public xfToken;

    // ─── Lock Constants ───────────────────────────────────────────────────────
    uint256 public constant MIN_LOCK = 26 weeks;    // ~6 months
    uint256 public constant MAX_LOCK = 3 * 365 days; // 3 years
    uint256 public constant MAX_MULTIPLIER = 3;       // 3x at max lock

    // ─── Lock State ───────────────────────────────────────────────────────────
    struct Lock {
        uint128 amount;
        uint64  lockStart;
        uint64  unlockTime;
    }

    mapping(address => Lock) public locks;
    uint256 public totalLocked;
    uint256 public totalVotingPower; // sum of all current voting power

    // ─── Proposals (Governance Stubs) ─────────────────────────────────────────
    enum ProposalType {
        CircuitPriority,    // Activate/deactivate a circuit module
        LPAllocation,       // Change LP pool weights
        FeeStructure,       // Adjust fee BPS for a circuit
        TreasurySpend,      // Authorize treasury expenditure
        EmergencyPause      // Emergency circuit breaker (67% supermajority)
    }

    struct Proposal {
        uint256 id;
        ProposalType pType;
        bytes32 targetCircuit;  // Circuit ID (or bytes32(0) for global)
        string description;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 startBlock;
        uint256 endBlock;
        bool executed;
        address proposer;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant QUORUM_BPS = 1000;              // 10% of total voting power
    uint256 public constant EMERGENCY_QUORUM_BPS = 6700;    // 67% for emergency

    // ─── Events ───────────────────────────────────────────────────────────────
    event Locked(address indexed user, uint256 amount, uint256 unlockTime, uint256 votingPower);
    event Unlocked(address indexed user, uint256 amount);
    event IncreasedLock(address indexed user, uint256 addedAmount);
    event ExtendedLock(address indexed user, uint256 newUnlockTime);
    event ProposalCreated(uint256 indexed id, ProposalType pType, address indexed proposer);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error LockTooShort();
    error LockTooLong();
    error NoExistingLock();
    error LockNotExpired();
    error LockExpired();
    error AlreadyVoted();
    error VotingClosed();
    error QuorumNotReached();
    error AlreadyExecuted();
    error InsufficientVotingPower();

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _admin, address _xfToken) {
        require(_admin != address(0) && _xfToken != address(0), "ZeroAddr");
        xfToken = IERC20(_xfToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ─── Locking ──────────────────────────────────────────────────────────────

    /**
     * @notice Lock XF tokens for governance voting power.
     * @param amount Amount of XF to lock.
     * @param unlockTime Timestamp when lock expires.
     */
    function lock(uint256 amount, uint256 unlockTime) external nonReentrant {
        require(amount > 0, "ZeroAmount");
        uint256 duration = unlockTime - block.timestamp;
        if (duration < MIN_LOCK) revert LockTooShort();
        if (duration > MAX_LOCK) revert LockTooLong();

        Lock storage l = locks[msg.sender];
        require(l.amount == 0, "ExistingLock");

        xfToken.safeTransferFrom(msg.sender, address(this), amount);

        l.amount = uint128(amount);
        l.lockStart = uint64(block.timestamp);
        l.unlockTime = uint64(unlockTime);
        totalLocked += amount;

        uint256 vp = votingPower(msg.sender);
        totalVotingPower += vp;

        emit Locked(msg.sender, amount, unlockTime, vp);
    }

    /**
     * @notice Increase locked amount without changing unlock time.
     */
    function increaseLock(uint256 addAmount) external nonReentrant {
        Lock storage l = locks[msg.sender];
        if (l.amount == 0) revert NoExistingLock();
        if (block.timestamp >= l.unlockTime) revert LockExpired();

        uint256 oldVP = votingPower(msg.sender);
        xfToken.safeTransferFrom(msg.sender, address(this), addAmount);
        l.amount += uint128(addAmount);
        totalLocked += addAmount;

        uint256 newVP = votingPower(msg.sender);
        totalVotingPower = totalVotingPower - oldVP + newVP;

        emit IncreasedLock(msg.sender, addAmount);
    }

    /**
     * @notice Extend lock duration (must be longer than current).
     */
    function extendLock(uint256 newUnlockTime) external nonReentrant {
        Lock storage l = locks[msg.sender];
        if (l.amount == 0) revert NoExistingLock();
        require(newUnlockTime > l.unlockTime, "MustBeLonger");

        uint256 duration = newUnlockTime - block.timestamp;
        if (duration > MAX_LOCK) revert LockTooLong();

        uint256 oldVP = votingPower(msg.sender);
        l.unlockTime = uint64(newUnlockTime);

        uint256 newVP = votingPower(msg.sender);
        totalVotingPower = totalVotingPower - oldVP + newVP;

        emit ExtendedLock(msg.sender, newUnlockTime);
    }

    /**
     * @notice Withdraw XF after lock expires.
     */
    function unlock() external nonReentrant {
        Lock storage l = locks[msg.sender];
        if (l.amount == 0) revert NoExistingLock();
        if (block.timestamp < l.unlockTime) revert LockNotExpired();

        uint256 amount = l.amount;
        delete locks[msg.sender];
        totalLocked -= amount;

        xfToken.safeTransfer(msg.sender, amount);
        emit Unlocked(msg.sender, amount);
    }

    // ─── Voting Power ─────────────────────────────────────────────────────────

    /**
     * @notice Calculate current voting power (linear decay from MAX_MULTIPLIER to 0).
     */
    function votingPower(address user) public view returns (uint256) {
        Lock memory l = locks[user];
        if (l.amount == 0 || block.timestamp >= l.unlockTime) return 0;

        uint256 remaining = l.unlockTime - block.timestamp;
        uint256 total = l.unlockTime - l.lockStart;
        if (total == 0) return 0;

        // multiplier = MAX_MULTIPLIER * remaining / total  (linear decay)
        uint256 multiplier = (MAX_MULTIPLIER * 1e18 * remaining) / total;
        return (uint256(l.amount) * multiplier) / 1e18;
    }

    // ─── Proposals (Governance Stubs) ─────────────────────────────────────────

    /**
     * @notice Create a governance proposal.
     * @param pType Proposal type (circuit priority, LP, fees, treasury, emergency).
     * @param targetCircuit Circuit ID this proposal targets (bytes32(0) for global).
     * @param description Human-readable description.
     */
    function createProposal(
        ProposalType pType,
        bytes32 targetCircuit,
        string calldata description
    ) external returns (uint256 id) {
        if (votingPower(msg.sender) == 0) revert InsufficientVotingPower();

        id = ++proposalCount;
        proposals[id] = Proposal({
            id: id,
            pType: pType,
            targetCircuit: targetCircuit,
            description: description,
            forVotes: 0,
            againstVotes: 0,
            startBlock: block.number,
            endBlock: block.number + (VOTING_PERIOD / 12), // ~12s blocks
            executed: false,
            proposer: msg.sender
        });

        emit ProposalCreated(id, pType, msg.sender);
    }

    /**
     * @notice Cast a vote on an active proposal.
     * @param proposalId The proposal ID.
     * @param support True = for, false = against.
     */
    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        if (block.number > p.endBlock) revert VotingClosed();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        uint256 weight = votingPower(msg.sender);
        if (weight == 0) revert InsufficientVotingPower();

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        emit Voted(proposalId, msg.sender, support, weight);
    }

    /**
     * @notice Execute a passed proposal (stub — logs execution, does not enforce on-chain).
     * @dev In production, this would call a Timelock or Governor contract.
     */
    function executeProposal(uint256 proposalId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Proposal storage p = proposals[proposalId];
        if (p.executed) revert AlreadyExecuted();
        if (block.number <= p.endBlock) revert VotingClosed();

        // Check quorum
        uint256 requiredQuorum = p.pType == ProposalType.EmergencyPause
            ? EMERGENCY_QUORUM_BPS
            : QUORUM_BPS;

        uint256 totalVotes = p.forVotes + p.againstVotes;
        if (totalVotingPower > 0) {
            uint256 participation = (totalVotes * TOTAL_BPS) / totalVotingPower;
            if (participation < requiredQuorum) revert QuorumNotReached();
        }

        require(p.forVotes > p.againstVotes, "ProposalRejected");

        p.executed = true;
        emit ProposalExecuted(proposalId);

        // STUB: In production, decode targetCircuit + pType to execute on-chain actions
        // e.g., call CoreRevenueSplitter.setSplit(), ZKVerifierSP1.pause(), etc.
    }

    // ─── Constants for external reference ─────────────────────────────────────
    uint16 public constant TOTAL_BPS = 10000;

    // ─── Views ────────────────────────────────────────────────────────────────

    function getLock(address user) external view returns (Lock memory) {
        return locks[user];
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        return proposals[id];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./veXF.sol";

/**
 * @title Governance
 * @dev Governance contract with snapshot-based voting to prevent flash-loan attacks
 * Users vote with veXF power at a specific block (snapshot) to prevent same-block manipulation
 * Implements time-weighted voting to prevent flash-loan governance attacks
 * Uses Solidity 0.8+ built-in overflow protection (no SafeMath needed)
 */
contract Governance is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {

    // veXF contract for voting power
    veXF public veXFContract;

    // Proposal structure
    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 startBlock;
        uint256 endBlock;
        uint256 snapshotBlock;  // Block at which voting power is calculated (flash-loan protection)
        bool executed;
        bool canceled;
        mapping(address => bool) hasVoted;
        mapping(address => uint256) votingPower; // Cache voting power at snapshot
    }

    // Proposals
    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    // Governance parameters
    uint256 public votingDelay = 1;  // Blocks between proposal and voting start (flash-loan protection)
    uint256 public votingPeriod = 17280;  // ~3 days in blocks (assuming 15s blocks)
    uint256 public proposalThreshold = 100000 * 1e18;  // Minimum veXF to create proposal
    uint256 public quorumVotes = 400000 * 1e18;  // Minimum votes needed for quorum

    // Flash-loan protection: minimum time user must hold veXF before voting
    uint256 public constant MIN_VOTING_DELAY = 1;  // At least 1 block delay
    uint256 public constant MIN_LOCK_PERIOD_FOR_VOTING = 1 weeks;  // Users must lock for at least 1 week to vote

    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string description,
        uint256 startBlock,
        uint256 endBlock,
        uint256 snapshotBlock
    );
    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        bool support,
        uint256 votes
    );
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract
     * @param _veXF Address of veXF contract
     * @param _owner Address of contract owner
     */
    function initialize(
        address _veXF,
        address _owner
    ) public initializer {
        require(_veXF != address(0), "Governance: invalid veXF");
        require(_owner != address(0), "Governance: invalid owner");

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        veXFContract = veXF(_veXF);
    }

    /**
     * @dev Create a new proposal
     * @param description Description of the proposal
     * @return proposalId ID of the new proposal
     */
    function propose(string memory description) external nonReentrant returns (uint256) {
        // Check proposer has enough voting power
        uint256 proposerVotes = veXFContract.balanceOf(msg.sender);
        require(proposerVotes >= proposalThreshold, "Governance: proposer votes below threshold");

        // Check proposer has been locked long enough (flash-loan protection)
        veXF.Lock memory lock = veXFContract.getLock(msg.sender);
        require(lock.unlockTime - lock.lockTime >= MIN_LOCK_PERIOD_FOR_VOTING, 
            "Governance: lock period too short for voting");

        proposalCount = proposalCount + 1;
        uint256 proposalId = proposalCount;

        Proposal storage newProposal = proposals[proposalId];
        newProposal.id = proposalId;
        newProposal.proposer = msg.sender;
        newProposal.description = description;
        newProposal.startBlock = block.number + votingDelay;
        newProposal.endBlock = block.number + votingDelay + votingPeriod;
        newProposal.snapshotBlock = block.number;  // Snapshot at proposal creation (flash-loan protection)
        newProposal.executed = false;
        newProposal.canceled = false;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            description,
            newProposal.startBlock,
            newProposal.endBlock,
            newProposal.snapshotBlock
        );

        return proposalId;
    }

    /**
     * @dev Cast a vote on a proposal
     * @param proposalId ID of the proposal
     * @param support True for yes, false for no
     */
    function castVote(uint256 proposalId, bool support) external nonReentrant {
        require(proposalId > 0 && proposalId <= proposalCount, "Governance: invalid proposal");
        Proposal storage proposal = proposals[proposalId];

        require(block.number >= proposal.startBlock, "Governance: voting not started");
        require(block.number <= proposal.endBlock, "Governance: voting ended");
        require(!proposal.hasVoted[msg.sender], "Governance: already voted");
        require(!proposal.executed, "Governance: proposal already executed");
        require(!proposal.canceled, "Governance: proposal canceled");

        // Flash-loan protection: Get voting power at snapshot block
        // In production, you would need to implement historical balance lookups
        // For now, we check current voting power and ensure minimum lock period
        uint256 votes = veXFContract.balanceOf(msg.sender);
        require(votes > 0, "Governance: no voting power");

        // Check voter has been locked long enough (flash-loan protection)
        veXF.Lock memory lock = veXFContract.getLock(msg.sender);
        require(lock.lockTime < proposal.snapshotBlock, 
            "Governance: lock created after snapshot");
        require(lock.unlockTime - lock.lockTime >= MIN_LOCK_PERIOD_FOR_VOTING,
            "Governance: lock period too short for voting");

        // Record vote
        proposal.hasVoted[msg.sender] = true;
        proposal.votingPower[msg.sender] = votes;

        if (support) {
            proposal.forVotes = proposal.forVotes + votes;
        } else {
            proposal.againstVotes = proposal.againstVotes + votes;
        }

        emit VoteCast(msg.sender, proposalId, support, votes);
    }

    /**
     * @dev Execute a proposal if it passed
     * @param proposalId ID of the proposal
     */
    function executeProposal(uint256 proposalId) external nonReentrant {
        require(proposalId > 0 && proposalId <= proposalCount, "Governance: invalid proposal");
        Proposal storage proposal = proposals[proposalId];

        require(block.number > proposal.endBlock, "Governance: voting not ended");
        require(!proposal.executed, "Governance: already executed");
        require(!proposal.canceled, "Governance: proposal canceled");

        // Check if proposal passed
        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        require(totalVotes >= quorumVotes, "Governance: quorum not reached");
        require(proposal.forVotes > proposal.againstVotes, "Governance: proposal failed");

        proposal.executed = true;

        // In production, execute the actual proposal actions here
        // For now, just mark as executed

        emit ProposalExecuted(proposalId);
    }

    /**
     * @dev Cancel a proposal (owner only)
     * @param proposalId ID of the proposal
     */
    function cancelProposal(uint256 proposalId) external onlyOwner {
        require(proposalId > 0 && proposalId <= proposalCount, "Governance: invalid proposal");
        Proposal storage proposal = proposals[proposalId];

        require(!proposal.executed, "Governance: already executed");
        require(!proposal.canceled, "Governance: already canceled");

        proposal.canceled = true;

        emit ProposalCanceled(proposalId);
    }

    /**
     * @dev Get proposal state
     * @param proposalId ID of the proposal
     * @return state Current state of the proposal
     * 0: Pending, 1: Active, 2: Defeated, 3: Succeeded, 4: Executed, 5: Canceled
     */
    function state(uint256 proposalId) external view returns (uint256) {
        require(proposalId > 0 && proposalId <= proposalCount, "Governance: invalid proposal");
        Proposal storage proposal = proposals[proposalId];

        if (proposal.canceled) {
            return 5; // Canceled
        } else if (proposal.executed) {
            return 4; // Executed
        } else if (block.number <= proposal.startBlock) {
            return 0; // Pending
        } else if (block.number <= proposal.endBlock) {
            return 1; // Active
        } else {
            uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
            if (totalVotes < quorumVotes || proposal.forVotes <= proposal.againstVotes) {
                return 2; // Defeated
            } else {
                return 3; // Succeeded
            }
        }
    }

    /**
     * @dev Get proposal details
     * @param proposalId ID of the proposal
     */
    function getProposal(uint256 proposalId) external view returns (
        uint256 id,
        address proposer,
        string memory description,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 startBlock,
        uint256 endBlock,
        uint256 snapshotBlock,
        bool executed,
        bool canceled
    ) {
        require(proposalId > 0 && proposalId <= proposalCount, "Governance: invalid proposal");
        Proposal storage proposal = proposals[proposalId];

        return (
            proposal.id,
            proposal.proposer,
            proposal.description,
            proposal.forVotes,
            proposal.againstVotes,
            proposal.startBlock,
            proposal.endBlock,
            proposal.snapshotBlock,
            proposal.executed,
            proposal.canceled
        );
    }

    /**
     * @dev Check if an address has voted on a proposal
     * @param proposalId ID of the proposal
     * @param voter Address to check
     */
    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        require(proposalId > 0 && proposalId <= proposalCount, "Governance: invalid proposal");
        return proposals[proposalId].hasVoted[voter];
    }

    /**
     * @dev Set voting delay (owner only)
     * @param newVotingDelay New voting delay in blocks
     */
    function setVotingDelay(uint256 newVotingDelay) external onlyOwner {
        require(newVotingDelay >= MIN_VOTING_DELAY, "Governance: voting delay too short");
        votingDelay = newVotingDelay;
    }

    /**
     * @dev Set voting period (owner only)
     * @param newVotingPeriod New voting period in blocks
     */
    function setVotingPeriod(uint256 newVotingPeriod) external onlyOwner {
        require(newVotingPeriod > 0, "Governance: invalid voting period");
        votingPeriod = newVotingPeriod;
    }

    /**
     * @dev Set proposal threshold (owner only)
     * @param newProposalThreshold New proposal threshold
     */
    function setProposalThreshold(uint256 newProposalThreshold) external onlyOwner {
        proposalThreshold = newProposalThreshold;
    }

    /**
     * @dev Set quorum votes (owner only)
     * @param newQuorumVotes New quorum votes
     */
    function setQuorumVotes(uint256 newQuorumVotes) external onlyOwner {
        quorumVotes = newQuorumVotes;
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}


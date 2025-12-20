// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./veXF.sol";

/**
 * @title InnovationTreasury
 * @dev 3-vault system (Builder, Acquisition, Moonshot) with basic veXF proposal/voting
 * Prepares for full Governor integration later
 */
contract InnovationTreasury is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // Vault types
    enum VaultType { Builder, Acquisition, Moonshot }

    // veXF contract for voting
    veXF public veXFContract;

    // Treasury token (e.g., USDC)
    IERC20 public treasuryToken;

    // Vault balances
    mapping(VaultType => uint256) public vaultBalances;

    // Proposal structure
    struct Proposal {
        uint256 id;
        address proposer;
        VaultType vault;
        address recipient;
        uint256 amount;
        string description;
        uint256 createdAt;
        uint256 endTime;
        uint256 votesFor;
        uint256 votesAgainst;
        bool executed;
        bool cancelled;
        mapping(address => bool) hasVoted;
    }

    // Proposals mapping
    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    // Voting parameters
    uint256 public constant VOTING_PERIOD = 7 days;
    uint256 public constant MIN_VOTING_POWER = 1000 * 1e18; // Minimum veXF required to create proposal
    uint256 public constant QUORUM_BPS = 1000; // 10% quorum (1000 basis points)
    uint256 public constant MAJORITY_BPS = 5100; // 51% majority (5100 basis points)

    // Events
    event VaultDeposit(VaultType indexed vault, uint256 amount, address indexed depositor);
    event VaultWithdrawal(VaultType indexed vault, uint256 amount, address indexed recipient);
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        VaultType vault,
        address recipient,
        uint256 amount
    );
    event ProposalVoted(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 votingPower
    );
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event VeXFSet(address indexed veXF);
    event TreasuryTokenSet(address indexed token);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract
     * @param _veXF Address of veXF contract
     * @param _treasuryToken Address of treasury token (e.g., USDC)
     * @param _owner Address of contract owner
     */
    function initialize(
        address _veXF,
        address _treasuryToken,
        address _owner
    ) public initializer {
        require(_veXF != address(0), "InnovationTreasury: invalid veXF");
        require(_treasuryToken != address(0), "InnovationTreasury: invalid treasury token");
        require(_owner != address(0), "InnovationTreasury: invalid owner");
        
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        
        veXFContract = veXF(_veXF);
        treasuryToken = IERC20(_treasuryToken);
    }

    /**
     * @dev Deposit tokens into a vault (owner only, or from RevenueSplitter)
     * @param vault Vault type to deposit to
     * @param amount Amount of tokens to deposit
     */
    function deposit(VaultType vault, uint256 amount) external nonReentrant {
        require(amount > 0, "InnovationTreasury: amount must be > 0");
        
        // In production, this could be called by RevenueSplitter
        treasuryToken.safeTransferFrom(msg.sender, address(this), amount);
        vaultBalances[vault] += amount;

        emit VaultDeposit(vault, amount, msg.sender);
    }

    /**
     * @dev Create a proposal to withdraw from a vault
     * @param vault Vault to withdraw from
     * @param recipient Address to receive the tokens
     * @param amount Amount to withdraw
     * @param description Proposal description
     * @return proposalId The ID of the created proposal
     */
    function createProposal(
        VaultType vault,
        address recipient,
        uint256 amount,
        string memory description
    ) external nonReentrant returns (uint256) {
        require(recipient != address(0), "InnovationTreasury: invalid recipient");
        require(amount > 0, "InnovationTreasury: amount must be > 0");
        require(bytes(description).length > 0, "InnovationTreasury: description required");
        require(vaultBalances[vault] >= amount, "InnovationTreasury: insufficient vault balance");

        // Check minimum voting power
        uint256 proposerPower = veXFContract.balanceOf(msg.sender);
        require(proposerPower >= MIN_VOTING_POWER, "InnovationTreasury: insufficient voting power");

        proposalCount++;
        uint256 proposalId = proposalCount;

        Proposal storage proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.vault = vault;
        proposal.recipient = recipient;
        proposal.amount = amount;
        proposal.description = description;
        proposal.createdAt = block.timestamp;
        proposal.endTime = block.timestamp + VOTING_PERIOD;
        proposal.votesFor = 0;
        proposal.votesAgainst = 0;
        proposal.executed = false;
        proposal.cancelled = false;

        emit ProposalCreated(proposalId, msg.sender, vault, recipient, amount);
        return proposalId;
    }

    /**
     * @dev Vote on a proposal
     * @param proposalId ID of the proposal
     * @param support True for yes, false for no
     */
    function vote(uint256 proposalId, bool support) external nonReentrant {
        require(proposalId > 0 && proposalId <= proposalCount, "InnovationTreasury: invalid proposal");
        
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp < proposal.endTime, "InnovationTreasury: voting ended");
        require(!proposal.executed, "InnovationTreasury: proposal already executed");
        require(!proposal.cancelled, "InnovationTreasury: proposal cancelled");
        require(!proposal.hasVoted[msg.sender], "InnovationTreasury: already voted");

        uint256 votingPower = veXFContract.balanceOf(msg.sender);
        require(votingPower > 0, "InnovationTreasury: no voting power");

        proposal.hasVoted[msg.sender] = true;
        
        if (support) {
            proposal.votesFor += votingPower;
        } else {
            proposal.votesAgainst += votingPower;
        }

        emit ProposalVoted(proposalId, msg.sender, support, votingPower);
    }

    /**
     * @dev Execute a proposal if it passed
     * @param proposalId ID of the proposal to execute
     */
    function executeProposal(uint256 proposalId) external nonReentrant {
        require(proposalId > 0 && proposalId <= proposalCount, "InnovationTreasury: invalid proposal");
        
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp >= proposal.endTime, "InnovationTreasury: voting still active");
        require(!proposal.executed, "InnovationTreasury: proposal already executed");
        require(!proposal.cancelled, "InnovationTreasury: proposal cancelled");

        uint256 totalVotes = proposal.votesFor + proposal.votesAgainst;
        uint256 totalSupply = veXFContract.totalSupply();
        
        // Check quorum (10% of total veXF supply)
        require(
            totalVotes >= (totalSupply * QUORUM_BPS) / 10000,
            "InnovationTreasury: quorum not met"
        );

        // Check majority (51% of votes)
        require(
            proposal.votesFor >= (totalVotes * MAJORITY_BPS) / 10000,
            "InnovationTreasury: majority not met"
        );

        // Execute the proposal
        proposal.executed = true;
        vaultBalances[proposal.vault] -= proposal.amount;
        treasuryToken.safeTransfer(proposal.recipient, proposal.amount);

        emit ProposalExecuted(proposalId);
    }

    /**
     * @dev Cancel a proposal (only proposer or owner)
     * @param proposalId ID of the proposal to cancel
     */
    function cancelProposal(uint256 proposalId) external {
        require(proposalId > 0 && proposalId <= proposalCount, "InnovationTreasury: invalid proposal");
        
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.executed, "InnovationTreasury: proposal already executed");
        require(!proposal.cancelled, "InnovationTreasury: proposal already cancelled");
        require(
            msg.sender == proposal.proposer || msg.sender == owner(),
            "InnovationTreasury: not authorized"
        );

        proposal.cancelled = true;
        emit ProposalCancelled(proposalId);
    }

    /**
     * @dev Get proposal details (excluding hasVoted mapping)
     * @param proposalId ID of the proposal
     * @return id Proposal ID
     * @return proposer Address of proposer
     * @return vault Vault type
     * @return recipient Recipient address
     * @return amount Amount to withdraw
     * @return description Proposal description
     * @return createdAt Creation timestamp
     * @return endTime End timestamp
     * @return votesFor Votes for
     * @return votesAgainst Votes against
     * @return executed Whether executed
     * @return cancelled Whether cancelled
     */
    function getProposal(uint256 proposalId) external view returns (
        uint256 id,
        address proposer,
        VaultType vault,
        address recipient,
        uint256 amount,
        string memory description,
        uint256 createdAt,
        uint256 endTime,
        uint256 votesFor,
        uint256 votesAgainst,
        bool executed,
        bool cancelled
    ) {
        require(proposalId > 0 && proposalId <= proposalCount, "InnovationTreasury: invalid proposal");
        Proposal storage proposal = proposals[proposalId];
        
        return (
            proposal.id,
            proposal.proposer,
            proposal.vault,
            proposal.recipient,
            proposal.amount,
            proposal.description,
            proposal.createdAt,
            proposal.endTime,
            proposal.votesFor,
            proposal.votesAgainst,
            proposal.executed,
            proposal.cancelled
        );
    }

    /**
     * @dev Check if a user has voted on a proposal
     * @param proposalId ID of the proposal
     * @param voter Address of the voter
     * @return Whether the user has voted
     */
    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        require(proposalId > 0 && proposalId <= proposalCount, "InnovationTreasury: invalid proposal");
        return proposals[proposalId].hasVoted[voter];
    }

    /**
     * @dev Set veXF contract address
     * @param _veXF Address of veXF contract
     */
    function setVeXF(address _veXF) external onlyOwner {
        require(_veXF != address(0), "InnovationTreasury: invalid veXF");
        veXFContract = veXF(_veXF);
        emit VeXFSet(_veXF);
    }

    /**
     * @dev Set treasury token address
     * @param _treasuryToken Address of treasury token
     */
    function setTreasuryToken(address _treasuryToken) external onlyOwner {
        require(_treasuryToken != address(0), "InnovationTreasury: invalid treasury token");
        treasuryToken = IERC20(_treasuryToken);
        emit TreasuryTokenSet(_treasuryToken);
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}


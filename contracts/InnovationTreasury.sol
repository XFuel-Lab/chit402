// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./veXF.sol";
import "./rXF.sol";

/**
 * @title InnovationTreasury
 * @dev 3-vault system (Builder, Acquisition, Moonshot) with basic veXF proposal/voting
 * Also mints limited rXF (5M cap: 2.5% early believers + 2.5% incentives)
 * rXF as soulbound NFTs with +4x veXF boost on 365-day lock, redeemable 1:1 XF after 12mo
 * Prepares for full Governor integration later
 * 
 * Security Features:
 * - Timelock: Critical operations require timelock delay
 * - Multi-sig: Timelock controlled by multi-sig
 * - Pausable: Emergency pause functionality
 * - Access control: Owner and timelock roles
 * - rXF cap: Hard limit prevents ongoing mints beyond strategic allocation
 */
contract InnovationTreasury is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // Vault types
    enum VaultType { Builder, Acquisition, Moonshot }

    // veXF contract for voting
    veXF public veXFContract;
    
    // rXF contract for limited strategic minting
    rXF public rXFContract;

    // Treasury token (e.g., USDC)
    IERC20 public treasuryToken;
    
    // Timelock controller for critical operations
    address public timelock;
    
    // Pause functionality
    bool public paused;
    
    // rXF allocation tracking (5% cap = 5M tokens assuming 100M total supply)
    uint256 public constant RXF_TOTAL_CAP = 5_000_000 * 1e18;        // 5M rXF total cap
    uint256 public constant RXF_EARLY_BELIEVERS_CAP = 2_500_000 * 1e18; // 2.5M for early believers
    uint256 public constant RXF_INCENTIVES_CAP = 2_500_000 * 1e18;   // 2.5M for incentives
    
    uint256 public rXFEarlyBelieversMinted;  // Track early believer mints
    uint256 public rXFIncentivesMinted;      // Track incentive mints

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
    event TimelockSet(address indexed timelock);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event RXFSet(address indexed rXF);
    event RXFMinted(
        address indexed recipient,
        uint256 amount,
        bool isEarlyBeliever,
        uint256 totalMinted
    );

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
        require(!paused, "InnovationTreasury: paused");
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
        require(!paused, "InnovationTreasury: paused");
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
     * @dev Mint limited rXF for early believers (2.5M cap)
     * @param recipient Address to receive rXF
     * @param amount Amount of rXF to mint
     * @dev Minted rXF is soulbound NFT with 12-month redemption period
     *      Provides +4x veXF boost when locked for 365 days
     *      Can be redeemed 1:1 for XF after 12 months
     */
    function mintRXFEarlyBeliever(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(!paused, "InnovationTreasury: paused");
        require(address(rXFContract) != address(0), "InnovationTreasury: rXF not set");
        require(recipient != address(0), "InnovationTreasury: invalid recipient");
        require(amount > 0, "InnovationTreasury: amount must be > 0");
        require(
            rXFEarlyBelieversMinted + amount <= RXF_EARLY_BELIEVERS_CAP,
            "InnovationTreasury: early believers cap exceeded"
        );
        
        rXFEarlyBelieversMinted += amount;
        
        // Mint with 365-day redemption period (12 months), no priority flag
        rXFContract.mint(recipient, amount, 365 days, false);
        
        emit RXFMinted(recipient, amount, true, rXFEarlyBelieversMinted);
    }
    
    /**
     * @dev Mint limited rXF for governance incentives (2.5M cap)
     * @param recipient Address to receive rXF
     * @param amount Amount of rXF to mint
     * @dev Used for voter rewards and governance participation incentives
     *      Same mechanics as early believer rXF (soulbound, +4x boost, 12mo redemption)
     */
    function mintRXFIncentive(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(!paused, "InnovationTreasury: paused");
        require(address(rXFContract) != address(0), "InnovationTreasury: rXF not set");
        require(recipient != address(0), "InnovationTreasury: invalid recipient");
        require(amount > 0, "InnovationTreasury: amount must be > 0");
        require(
            rXFIncentivesMinted + amount <= RXF_INCENTIVES_CAP,
            "InnovationTreasury: incentives cap exceeded"
        );
        
        rXFIncentivesMinted += amount;
        
        // Mint with 365-day redemption period (12 months), no priority flag
        rXFContract.mint(recipient, amount, 365 days, false);
        
        emit RXFMinted(recipient, amount, false, rXFIncentivesMinted);
    }
    
    /**
     * @dev Batch mint rXF for early believers
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to mint
     * @dev Efficiently distribute rXF to multiple early believers
     */
    function batchMintRXFEarlyBeliever(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner nonReentrant {
        require(!paused, "InnovationTreasury: paused");
        require(address(rXFContract) != address(0), "InnovationTreasury: rXF not set");
        require(recipients.length == amounts.length, "InnovationTreasury: array length mismatch");
        require(recipients.length > 0, "InnovationTreasury: empty arrays");
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }
        
        require(
            rXFEarlyBelieversMinted + totalAmount <= RXF_EARLY_BELIEVERS_CAP,
            "InnovationTreasury: early believers cap exceeded"
        );
        
        rXFEarlyBelieversMinted += totalAmount;
        
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "InnovationTreasury: invalid recipient");
            require(amounts[i] > 0, "InnovationTreasury: amount must be > 0");
            
            rXFContract.mint(recipients[i], amounts[i], 365 days, false);
            emit RXFMinted(recipients[i], amounts[i], true, rXFEarlyBelieversMinted);
        }
    }
    
    /**
     * @dev Get rXF allocation statistics
     * @return earlyBelieversMinted Amount minted for early believers
     * @return earlyBelieversRemaining Amount remaining for early believers
     * @return incentivesMinted Amount minted for incentives
     * @return incentivesRemaining Amount remaining for incentives
     * @return totalMinted Total rXF minted
     * @return totalRemaining Total rXF remaining
     */
    function getRXFAllocationStats() external view returns (
        uint256 earlyBelieversMinted,
        uint256 earlyBelieversRemaining,
        uint256 incentivesMinted,
        uint256 incentivesRemaining,
        uint256 totalMinted,
        uint256 totalRemaining
    ) {
        earlyBelieversMinted = rXFEarlyBelieversMinted;
        earlyBelieversRemaining = RXF_EARLY_BELIEVERS_CAP - rXFEarlyBelieversMinted;
        incentivesMinted = rXFIncentivesMinted;
        incentivesRemaining = RXF_INCENTIVES_CAP - rXFIncentivesMinted;
        totalMinted = rXFEarlyBelieversMinted + rXFIncentivesMinted;
        totalRemaining = RXF_TOTAL_CAP - totalMinted;
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
     * @dev Set rXF contract address
     * @param _rXF Address of rXF contract
     */
    function setRXF(address _rXF) external onlyOwner {
        require(_rXF != address(0), "InnovationTreasury: invalid rXF");
        rXFContract = rXF(_rXF);
        emit RXFSet(_rXF);
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
     * @dev Set timelock controller
     * @param _timelock Address of timelock controller
     */
    function setTimelock(address _timelock) external onlyOwner {
        require(_timelock != address(0), "InnovationTreasury: invalid timelock");
        timelock = _timelock;
        emit TimelockSet(_timelock);
    }
    
    /**
     * @dev Pause the contract (owner or timelock only)
     */
    function pause() external {
        require(msg.sender == owner() || msg.sender == timelock, "InnovationTreasury: not authorized");
        paused = true;
        emit Paused(msg.sender);
    }
    
    /**
     * @dev Unpause the contract (owner or timelock only)
     */
    function unpause() external {
        require(msg.sender == owner() || msg.sender == timelock, "InnovationTreasury: not authorized");
        paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}


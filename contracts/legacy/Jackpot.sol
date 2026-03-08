// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVeXFGovernance {
    function getVotingPower(address account) external view returns (uint256);
    function totalVotingPower() external view returns (uint256);
}

interface IChainlinkVRF {
    function requestRandomWords(bytes32 keyHash, uint64 subId, uint16 minConf,
        uint32 gasLimit, uint32 numWords) external returns (uint256 requestId);
}

/**
 * @title Jackpot — veXF Staker Jackpot (2% of all protocol fees)
 * @author XFuel Protocol
 * @notice Accumulates 2% of every fee from CoreRevenueSplitter and pays out
 *         the entire USDC pool to one veXF staker on a randomized 24–72 hour
 *         cycle. Winner selected via Chainlink VRF weighted by veXF voting power.
 *         Minimum 1 veXF to participate. 30-day auto-reroll if draw fails.
 *
 * Gas targets:
 *   - receive():              <60K  (accumulate funds)
 *   - draw():                 <80K  (VRF request + state)
 *   - fulfillRandomWords():   <200K (weighted pick + payout)
 *   - emergencyReroll():      <30K  (state reset)
 */
contract Jackpot is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IVeXFGovernance public veXF;
    IERC20 public usdc;
    IChainlinkVRF public vrf;

    bytes32 public vrfKeyHash;
    uint64  public vrfSubId;

    uint256 public nextDrawAfter;
    uint256 public drawFailedAt;
    uint256 public drawCount;
    uint256 public totalPaidOut;

    uint256 public constant MIN_VEXF = 1e18;
    uint256 public constant REROLL_DELAY = 30 days;
    uint256 public constant BOUNTY_BPS = 50;
    uint256 public constant BOUNTY_CAP = 50e6;

    address[] public stakers;
    mapping(uint256 => address) public drawWinner;
    mapping(uint256 => uint256) public drawPayout;

    event JackpotReceived(uint256 amount, uint256 timestamp);
    event DrawRequested(uint256 indexed drawId, uint256 requestId);
    event JackpotAwarded(uint256 indexed drawId, address indexed winner, uint256 amount, uint256 timestamp);
    event DrawFailed(uint256 indexed drawId, uint256 timestamp);
    event EmergencyReroll(uint256 timestamp);

    error WindowNotOpen();
    error EmptyPool();
    error NoFailure();
    error RerollTooEarly();

    constructor(
        address _admin,
        address _veXF,
        address _usdc,
        address _vrf,
        bytes32 _keyHash,
        uint64 _subId
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        veXF = IVeXFGovernance(_veXF);
        usdc = IERC20(_usdc);
        vrf  = IChainlinkVRF(_vrf);
        vrfKeyHash = _keyHash;
        vrfSubId   = _subId;
        nextDrawAfter = block.timestamp + 24 hours;
    }

    receive() external payable {
        emit JackpotReceived(msg.value, block.timestamp);
    }

    function draw() external nonReentrant whenNotPaused {
        if (block.timestamp < nextDrawAfter) revert WindowNotOpen();
        uint256 pool = usdc.balanceOf(address(this));
        if (pool == 0) revert EmptyPool();

        drawCount++;
        uint256 reqId = vrf.requestRandomWords(vrfKeyHash, vrfSubId, 3, 300_000, 1);
        emit DrawRequested(drawCount, reqId);
    }

    function fulfillRandomWords(uint256, uint256[] memory randomWords) internal {
        uint256 rand = randomWords[0];
        uint256 total = veXF.totalVotingPower();
        if (total == 0) { _resetWindow(rand); return; }

        uint256 target = rand % total;
        uint256 cumulative;
        address winner;

        for (uint256 i = 0; i < stakers.length; i++) {
            uint256 vp = veXF.getVotingPower(stakers[i]);
            if (vp < MIN_VEXF) continue;
            cumulative += vp;
            if (cumulative > target) { winner = stakers[i]; break; }
        }

        if (winner == address(0)) {
            drawFailedAt = block.timestamp;
            emit DrawFailed(drawCount, block.timestamp);
            return;
        }

        uint256 pool = usdc.balanceOf(address(this));
        uint256 bounty = (pool * BOUNTY_BPS) / 10_000;
        if (bounty > BOUNTY_CAP) bounty = BOUNTY_CAP;
        uint256 payout = pool - bounty;

        usdc.transfer(winner, payout);
        usdc.transfer(tx.origin, bounty);

        drawWinner[drawCount] = winner;
        drawPayout[drawCount] = payout;
        totalPaidOut += payout;
        _resetWindow(rand);

        emit JackpotAwarded(drawCount, winner, payout, block.timestamp);
    }

    function emergencyReroll() external {
        if (drawFailedAt == 0) revert NoFailure();
        if (block.timestamp < drawFailedAt + REROLL_DELAY) revert RerollTooEarly();
        drawFailedAt = 0;
        nextDrawAfter = block.timestamp;
        emit EmergencyReroll(block.timestamp);
    }

    function registerStaker(address s) external onlyRole(OPERATOR_ROLE) { stakers.push(s); }
    function getStakerCount() external view returns (uint256) { return stakers.length; }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _resetWindow(uint256 rand) internal {
        nextDrawAfter = block.timestamp + 24 hours + (rand % 48 hours);
    }
}

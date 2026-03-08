// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title TokenDistribution
 * @dev Manages token distribution with vesting schedules for team, advisors, and early investors
 * Implements linear vesting with cliff periods to ensure long-term alignment
 * Uses Solidity 0.8+ built-in overflow protection (no SafeMath needed)
 */
contract TokenDistribution is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // XF token
    IERC20 public xfToken;

    // Vesting schedule structure
    struct VestingSchedule {
        address beneficiary;
        uint256 totalAmount;       // Total tokens to be vested
        uint256 startTime;         // Vesting start timestamp
        uint256 cliffDuration;     // Cliff period in seconds
        uint256 duration;          // Total vesting duration in seconds (after cliff)
        uint256 released;          // Amount already released
        bool revocable;            // Can the vesting be revoked?
        bool revoked;              // Has the vesting been revoked?
    }

    // Vesting schedules by beneficiary
    mapping(address => VestingSchedule[]) public vestingSchedules;
    
    // Track total vested and released amounts
    uint256 public totalVested;
    uint256 public totalReleased;

    // Allocation categories
    uint256 public constant TEAM_ALLOCATION = 15_000_000 * 1e18;      // 15% of 100M total supply
    uint256 public constant ADVISOR_ALLOCATION = 5_000_000 * 1e18;    // 5% of 100M total supply
    uint256 public constant INVESTOR_ALLOCATION = 10_000_000 * 1e18;  // 10% of 100M total supply

    // Standard vesting parameters
    uint256 public constant TEAM_CLIFF = 365 days;          // 1 year cliff for team
    uint256 public constant TEAM_VESTING = 3 * 365 days;    // 3 years vesting after cliff
    uint256 public constant ADVISOR_CLIFF = 180 days;       // 6 months cliff for advisors
    uint256 public constant ADVISOR_VESTING = 2 * 365 days; // 2 years vesting after cliff
    uint256 public constant INVESTOR_CLIFF = 90 days;       // 3 months cliff for investors
    uint256 public constant INVESTOR_VESTING = 365 days;    // 1 year vesting after cliff

    // Allocation tracking
    uint256 public teamAllocated;
    uint256 public advisorAllocated;
    uint256 public investorAllocated;

    // Events
    event VestingScheduleCreated(
        address indexed beneficiary,
        uint256 indexed scheduleId,
        uint256 amount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 duration
    );
    event TokensReleased(
        address indexed beneficiary,
        uint256 indexed scheduleId,
        uint256 amount
    );
    event VestingRevoked(
        address indexed beneficiary,
        uint256 indexed scheduleId,
        uint256 refundAmount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract
     * @param _xfToken Address of XF token contract
     * @param _owner Address of contract owner
     */
    function initialize(
        address _xfToken,
        address _owner
    ) public initializer {
        require(_xfToken != address(0), "TokenDistribution: invalid XF token");
        require(_owner != address(0), "TokenDistribution: invalid owner");

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        xfToken = IERC20(_xfToken);
    }

    /**
     * @dev Create a vesting schedule for a team member
     * @param beneficiary Address of the team member
     * @param amount Amount of tokens to vest
     * @param startTime Vesting start time (0 for current time)
     */
    function createTeamVesting(
        address beneficiary,
        uint256 amount,
        uint256 startTime
    ) external onlyOwner nonReentrant {
        require(beneficiary != address(0), "TokenDistribution: invalid beneficiary");
        require(amount > 0, "TokenDistribution: amount must be greater than 0");
        require(teamAllocated + amount <= TEAM_ALLOCATION, "TokenDistribution: team allocation exceeded");

        uint256 start = startTime == 0 ? block.timestamp : startTime;

        _createVestingSchedule(
            beneficiary,
            amount,
            start,
            TEAM_CLIFF,
            TEAM_VESTING,
            true  // Team vesting is revocable
        );

        teamAllocated = teamAllocated + amount;
    }

    /**
     * @dev Create a vesting schedule for an advisor
     * @param beneficiary Address of the advisor
     * @param amount Amount of tokens to vest
     * @param startTime Vesting start time (0 for current time)
     */
    function createAdvisorVesting(
        address beneficiary,
        uint256 amount,
        uint256 startTime
    ) external onlyOwner nonReentrant {
        require(beneficiary != address(0), "TokenDistribution: invalid beneficiary");
        require(amount > 0, "TokenDistribution: amount must be greater than 0");
        require(advisorAllocated + amount <= ADVISOR_ALLOCATION, "TokenDistribution: advisor allocation exceeded");

        uint256 start = startTime == 0 ? block.timestamp : startTime;

        _createVestingSchedule(
            beneficiary,
            amount,
            start,
            ADVISOR_CLIFF,
            ADVISOR_VESTING,
            true  // Advisor vesting is revocable
        );

        advisorAllocated = advisorAllocated + amount;
    }

    /**
     * @dev Create a vesting schedule for an early investor
     * @param beneficiary Address of the investor
     * @param amount Amount of tokens to vest
     * @param startTime Vesting start time (0 for current time)
     */
    function createInvestorVesting(
        address beneficiary,
        uint256 amount,
        uint256 startTime
    ) external onlyOwner nonReentrant {
        require(beneficiary != address(0), "TokenDistribution: invalid beneficiary");
        require(amount > 0, "TokenDistribution: amount must be greater than 0");
        require(investorAllocated + amount <= INVESTOR_ALLOCATION, "TokenDistribution: investor allocation exceeded");

        uint256 start = startTime == 0 ? block.timestamp : startTime;

        _createVestingSchedule(
            beneficiary,
            amount,
            start,
            INVESTOR_CLIFF,
            INVESTOR_VESTING,
            false  // Investor vesting is NOT revocable
        );

        investorAllocated = investorAllocated + amount;
    }

    /**
     * @dev Create a custom vesting schedule
     * @param beneficiary Address of the beneficiary
     * @param amount Amount of tokens to vest
     * @param startTime Vesting start time
     * @param cliffDuration Cliff duration in seconds
     * @param vestingDuration Vesting duration in seconds (after cliff)
     * @param revocable Can the vesting be revoked?
     */
    function createCustomVesting(
        address beneficiary,
        uint256 amount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    ) external onlyOwner nonReentrant {
        require(beneficiary != address(0), "TokenDistribution: invalid beneficiary");
        require(amount > 0, "TokenDistribution: amount must be greater than 0");

        uint256 start = startTime == 0 ? block.timestamp : startTime;

        _createVestingSchedule(
            beneficiary,
            amount,
            start,
            cliffDuration,
            vestingDuration,
            revocable
        );
    }

    /**
     * @dev Internal function to create a vesting schedule
     */
    function _createVestingSchedule(
        address beneficiary,
        uint256 amount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    ) internal {
        require(startTime >= block.timestamp, "TokenDistribution: start time must be in future or now");

        VestingSchedule memory schedule = VestingSchedule({
            beneficiary: beneficiary,
            totalAmount: amount,
            startTime: startTime,
            cliffDuration: cliffDuration,
            duration: vestingDuration,
            released: 0,
            revocable: revocable,
            revoked: false
        });

        vestingSchedules[beneficiary].push(schedule);
        totalVested = totalVested + amount;

        uint256 scheduleId = vestingSchedules[beneficiary].length - 1;

        emit VestingScheduleCreated(
            beneficiary,
            scheduleId,
            amount,
            startTime,
            cliffDuration,
            vestingDuration
        );
    }

    /**
     * @dev Release vested tokens for a specific schedule
     * @param beneficiary Address of the beneficiary
     * @param scheduleId Index of the vesting schedule
     */
    function release(address beneficiary, uint256 scheduleId) external nonReentrant {
        require(beneficiary != address(0), "TokenDistribution: invalid beneficiary");
        require(scheduleId < vestingSchedules[beneficiary].length, "TokenDistribution: invalid schedule");

        VestingSchedule storage schedule = vestingSchedules[beneficiary][scheduleId];
        require(!schedule.revoked, "TokenDistribution: vesting revoked");

        uint256 releasable = _releasableAmount(schedule);
        require(releasable > 0, "TokenDistribution: no tokens to release");

        schedule.released = schedule.released + releasable;
        totalReleased = totalReleased + releasable;

        xfToken.safeTransfer(beneficiary, releasable);

        emit TokensReleased(beneficiary, scheduleId, releasable);
    }

    /**
     * @dev Revoke a vesting schedule (only if revocable)
     * @param beneficiary Address of the beneficiary
     * @param scheduleId Index of the vesting schedule
     */
    function revoke(address beneficiary, uint256 scheduleId) external onlyOwner nonReentrant {
        require(beneficiary != address(0), "TokenDistribution: invalid beneficiary");
        require(scheduleId < vestingSchedules[beneficiary].length, "TokenDistribution: invalid schedule");

        VestingSchedule storage schedule = vestingSchedules[beneficiary][scheduleId];
        require(schedule.revocable, "TokenDistribution: vesting not revocable");
        require(!schedule.revoked, "TokenDistribution: already revoked");

        uint256 releasable = _releasableAmount(schedule);
        if (releasable > 0) {
            schedule.released = schedule.released + releasable;
            totalReleased = totalReleased + releasable;
            xfToken.safeTransfer(beneficiary, releasable);
        }

        uint256 refund = schedule.totalAmount - schedule.released;
        schedule.revoked = true;

        // Refund unvested tokens to owner
        if (refund > 0) {
            totalVested = totalVested - refund;
        }

        emit VestingRevoked(beneficiary, scheduleId, refund);
    }

    /**
     * @dev Calculate releasable amount for a vesting schedule
     * @param schedule The vesting schedule
     * @return Amount of tokens that can be released
     */
    function _releasableAmount(VestingSchedule memory schedule) internal view returns (uint256) {
        if (block.timestamp < schedule.startTime + schedule.cliffDuration) {
            // Still in cliff period
            return 0;
        } else if (block.timestamp >= schedule.startTime + schedule.cliffDuration + schedule.duration) {
            // Fully vested
            return schedule.totalAmount - schedule.released;
        } else {
            // Linear vesting after cliff
            uint256 timeFromStart = block.timestamp - schedule.startTime;
            uint256 totalVestingTime = schedule.cliffDuration + schedule.duration;
            uint256 vestedAmount = (schedule.totalAmount * timeFromStart) / totalVestingTime;
            return vestedAmount - schedule.released;
        }
    }

    /**
     * @dev Get releasable amount for a specific schedule
     * @param beneficiary Address of the beneficiary
     * @param scheduleId Index of the vesting schedule
     * @return Amount of tokens that can be released
     */
    function releasableAmount(address beneficiary, uint256 scheduleId) external view returns (uint256) {
        require(beneficiary != address(0), "TokenDistribution: invalid beneficiary");
        require(scheduleId < vestingSchedules[beneficiary].length, "TokenDistribution: invalid schedule");

        VestingSchedule memory schedule = vestingSchedules[beneficiary][scheduleId];
        if (schedule.revoked) {
            return 0;
        }

        return _releasableAmount(schedule);
    }

    /**
     * @dev Get number of vesting schedules for a beneficiary
     * @param beneficiary Address of the beneficiary
     * @return Number of vesting schedules
     */
    function getVestingScheduleCount(address beneficiary) external view returns (uint256) {
        return vestingSchedules[beneficiary].length;
    }

    /**
     * @dev Get vesting schedule details
     * @param beneficiary Address of the beneficiary
     * @param scheduleId Index of the vesting schedule
     */
    function getVestingSchedule(address beneficiary, uint256 scheduleId) external view returns (
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 duration,
        uint256 released,
        bool revocable,
        bool revoked
    ) {
        require(beneficiary != address(0), "TokenDistribution: invalid beneficiary");
        require(scheduleId < vestingSchedules[beneficiary].length, "TokenDistribution: invalid schedule");

        VestingSchedule memory schedule = vestingSchedules[beneficiary][scheduleId];
        return (
            schedule.totalAmount,
            schedule.startTime,
            schedule.cliffDuration,
            schedule.duration,
            schedule.released,
            schedule.revocable,
            schedule.revoked
        );
    }

    /**
     * @dev Emergency withdraw (owner only) - for tokens not in vesting schedules
     * @param token Token address (address(0) for native token)
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success, ) = payable(owner()).call{value: amount}("");
            require(success, "TokenDistribution: withdraw failed");
        } else {
            // Ensure we don't withdraw vested tokens
            if (token == address(xfToken)) {
                uint256 available = xfToken.balanceOf(address(this));
                uint256 locked = totalVested - totalReleased;
                require(amount <= available - locked, "TokenDistribution: cannot withdraw vested tokens");
            }
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}


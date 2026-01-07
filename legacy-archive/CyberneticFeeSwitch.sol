// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./IFeeAdapter.sol";
import "./veXF.sol";

/**
 * @title CyberneticFeeSwitch
 * @dev Governance-settable fee tiers for protocol
 * Growth mode: Lower fees (0.1%) to attract TVL
 * Extraction mode: Higher fees (1.0%) for revenue
 * Controlled by veXF governance
 * UUPS upgradeable contract
 */
contract CyberneticFeeSwitch is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, IFeeAdapter {
    // Fee tier constants (in basis points)
    uint256 public constant GROWTH_MODE_FEE_BPS = 10;      // 0.1%
    uint256 public constant EXTRACTION_MODE_FEE_BPS = 100;  // 1.0%
    uint256 public constant MAX_FEE_BPS = 1000;            // 10% maximum

    // Current state
    bool public feesEnabled;
    uint256 public currentFeeBps;
    FeeMode public currentMode;

    // veXF contract for governance
    veXF public veXFContract;

    // Minimum veXF required to change fee settings
    uint256 public minVeXFForFeeChange;

    // Cooldown period for fee changes (in seconds)
    uint256 public constant FEE_CHANGE_COOLDOWN = 7 days;
    uint256 public lastFeeChangeTime;

    enum FeeMode {
        Growth,      // Low fees to attract TVL
        Extraction   // Higher fees for revenue
    }

    // Events
    event FeesEnabled(bool enabled);
    event FeeModeChanged(FeeMode oldMode, FeeMode newMode, uint256 newFeeBps);
    event FeeChanged(uint256 oldFeeBps, uint256 newFeeBps);
    event VeXFSet(address indexed veXF);
    event MinVeXFChanged(uint256 oldMin, uint256 newMin);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract (replaces constructor for upgradeable contracts)
     * @param _veXF Address of veXF contract
     * @param _owner Address of contract owner
     */
    function initialize(
        address _veXF,
        address _owner
    ) public initializer {
        require(_veXF != address(0), "CyberneticFeeSwitch: invalid veXF");
        require(_owner != address(0), "CyberneticFeeSwitch: invalid owner");

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        veXFContract = veXF(_veXF);
        feesEnabled = true;
        currentFeeBps = GROWTH_MODE_FEE_BPS;
        currentMode = FeeMode.Growth;
        minVeXFForFeeChange = 1000 * 1e18; // 1000 veXF minimum

        emit VeXFSet(_veXF);
    }

    /**
     * @dev Enable or disable fees (owner or veXF governance)
     */
    function setFeesEnabled(bool enabled) external {
        require(
            msg.sender == owner() || _hasMinVeXF(msg.sender),
            "CyberneticFeeSwitch: unauthorized"
        );
        
        feesEnabled = enabled;
        emit FeesEnabled(enabled);
    }

    /**
     * @dev Set fee mode (Growth or Extraction)
     * @param mode New fee mode
     */
    function setFeeMode(FeeMode mode) external nonReentrant {
        require(
            msg.sender == owner() || _hasMinVeXF(msg.sender),
            "CyberneticFeeSwitch: unauthorized"
        );
        require(
            block.timestamp >= lastFeeChangeTime + FEE_CHANGE_COOLDOWN,
            "CyberneticFeeSwitch: cooldown active"
        );

        FeeMode oldMode = currentMode;
        uint256 oldFeeBps = currentFeeBps;

        currentMode = mode;
        
        if (mode == FeeMode.Growth) {
            currentFeeBps = GROWTH_MODE_FEE_BPS;
        } else {
            currentFeeBps = EXTRACTION_MODE_FEE_BPS;
        }

        lastFeeChangeTime = block.timestamp;

        emit FeeModeChanged(oldMode, mode, currentFeeBps);
        emit FeeChanged(oldFeeBps, currentFeeBps);
    }

    /**
     * @dev Set custom fee (owner only, with max limit)
     * @param feeBps Fee in basis points (max 1000 = 10%)
     */
    function setCustomFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= MAX_FEE_BPS, "CyberneticFeeSwitch: fee too high");
        require(feeBps > 0, "CyberneticFeeSwitch: fee must be greater than 0");
        
        uint256 oldFeeBps = currentFeeBps;
        currentFeeBps = feeBps;
        
        // Reset to custom mode (not Growth or Extraction)
        currentMode = FeeMode.Growth; // Default, but fee is custom

        emit FeeChanged(oldFeeBps, feeBps);
    }

    /**
     * @dev Set veXF contract address
     */
    function setVeXF(address _veXF) external onlyOwner {
        require(_veXF != address(0), "CyberneticFeeSwitch: invalid veXF");
        veXFContract = veXF(_veXF);
        emit VeXFSet(_veXF);
    }

    /**
     * @dev Set minimum veXF required for fee changes
     */
    function setMinVeXF(uint256 _minVeXF) external onlyOwner {
        uint256 oldMin = minVeXFForFeeChange;
        minVeXFForFeeChange = _minVeXF;
        emit MinVeXFChanged(oldMin, _minVeXF);
    }

    /**
     * @dev Get the current fee multiplier (IFeeAdapter interface)
     * @return feeMultiplier Fee multiplier in basis points
     */
    function getFeeMultiplier() external view override returns (uint256) {
        if (!feesEnabled) {
            return 0;
        }
        return currentFeeBps;
    }

    /**
     * @dev Check if fees are enabled (IFeeAdapter interface)
     * @return enabled True if fees are enabled
     */
    function isFeesEnabled() external view override returns (bool) {
        return feesEnabled;
    }

    /**
     * @dev Get the effective fee for a given base fee (IFeeAdapter interface)
     * @param baseFee Base fee in basis points
     * @return effectiveFee Effective fee in basis points
     */
    function getEffectiveFee(uint256 baseFee) external view override returns (uint256) {
        if (!feesEnabled) {
            return 0;
        }
        // Apply fee multiplier to base fee
        // If currentFeeBps is 10 (0.1%), it means use 0.1% of the base fee
        // This allows fine-grained control
        return (baseFee * currentFeeBps) / 10000;
    }

    /**
     * @dev Check if an address has minimum veXF for governance
     * @param account Address to check
     * @return hasMin True if account has minimum veXF
     */
    function _hasMinVeXF(address account) internal view returns (bool) {
        return veXFContract.balanceOf(account) >= minVeXFForFeeChange;
    }

    /**
     * @dev Get current fee mode
     * @return mode Current fee mode
     */
    function getFeeMode() external view returns (FeeMode) {
        return currentMode;
    }

    /**
     * @dev Get current fee in basis points
     * @return feeBps Current fee in basis points
     */
    function getCurrentFeeBps() external view returns (uint256) {
        return currentFeeBps;
    }

    /**
     * @dev Check if fee change cooldown is active
     * @return active True if cooldown is active
     */
    function isCooldownActive() external view returns (bool) {
        return block.timestamp < lastFeeChangeTime + FEE_CHANGE_COOLDOWN;
    }

    /**
     * @dev Get time until cooldown expires
     * @return timeRemaining Seconds until cooldown expires (0 if not active)
     */
    function getCooldownTimeRemaining() external view returns (uint256) {
        if (block.timestamp >= lastFeeChangeTime + FEE_CHANGE_COOLDOWN) {
            return 0;
        }
        return (lastFeeChangeTime + FEE_CHANGE_COOLDOWN) - block.timestamp;
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}

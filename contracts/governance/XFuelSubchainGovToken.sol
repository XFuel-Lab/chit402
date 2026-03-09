// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title XFuelSubchainGovToken
 * @notice Governance token for the XFuel shared subchain (tsub360777 / tsub365001 / tsub361001).
 *
 * Required by Theta Metachain's ValidatorStakeManager contract to:
 *   1. Mint staker rewards per main-chain block via `mintStakerReward()`
 *   2. Report the reward rate via `stakerRewardPerBlock()`
 *
 * The `minter` role MUST be set to the ValidatorStakeManager (VSM) contract address
 * after deployment. On privatenet the VSM is at 0xA826bA8Fa8998E324757c6BCB544f0Cdba3eb4AB.
 *
 * @dev Architecture: one subchain, multiple circuits.
 *   Circuits deployed on this subchain:
 *     - ThetaInferenceCircuit  (AI inference intents)
 *     - A2ACircuit             (agent-to-agent escrow)
 *     - ThetaGPUCircuit        (raw GPU provisioning)
 *     - DataHubs               (decentralized data provenance)
 *
 * Theta Metachain reference:
 *   https://github.com/thetatoken/theta-metachain-guide/blob/master/
 *   demos/subchain-governance-token/contracts/SubchainGovernanceToken.sol
 */
contract XFuelSubchainGovToken is ERC20 {

    // ─── Events ──────────────────────────────────────────────────────────────

    event MinterUpdated(address indexed oldMinter, address indexed newMinter);
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event StakerRewardPerBlockUpdated(uint256 oldRate, uint256 newRate);

    // ─── State ───────────────────────────────────────────────────────────────

    uint8  private _decimals;
    uint256 private _stakerRewardPerBlock;

    uint256 public maxSupply;

    /// @notice The minter address — MUST be the ValidatorStakeManager contract.
    address public minter;

    /// @notice The admin address — can update minter and reward rate.
    address public admin;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param minter_               ValidatorStakeManager contract address on Theta main chain.
     *                              On privatenet: 0xA826bA8Fa8998E324757c6BCB544f0Cdba3eb4AB
     *                              Set to deployer temporarily; call updateMinter() after VSM deploys.
     * @param initDistrWallet_      Wallet that receives the initial token supply.
     * @param admin_                Admin wallet (can change minter and reward rate).
     *
     * @dev Default parameters match the Theta guide example and privatenet depositStake.js:
     *   maxSupply            = 1,000,000,000 XFGOV  (1 billion)
     *   initMintAmount       = 500,000,000 XFGOV    (500 million to deployer)
     *   stakerRewardPerBlock = 2 XFGOV per main-chain block
     */
    constructor(
        address minter_,
        address initDistrWallet_,
        address admin_
    ) ERC20("XFuel Subchain Gov", "XFGOV") {
        require(minter_ != address(0),        "minter is zero address");
        require(initDistrWallet_ != address(0), "initDistrWallet is zero address");
        require(admin_ != address(0),         "admin is zero address");

        _decimals             = 18;
        maxSupply             = 1_000_000_000e18;  // 1B XFGOV hard cap
        _stakerRewardPerBlock = 2e18;              // 2 XFGOV per main-chain block
        minter                = minter_;
        admin                 = admin_;

        uint256 initMint = 500_000_000e18;         // 500M to deployer / distribution wallet
        require(initMint <= maxSupply, "initMint exceeds maxSupply");
        _mint(initDistrWallet_, initMint);

        emit MinterUpdated(address(0), minter_);
        emit AdminUpdated(address(0), admin_);
        emit StakerRewardPerBlockUpdated(0, _stakerRewardPerBlock);
    }

    // ─── ERC20 Overrides ─────────────────────────────────────────────────────

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    // ─── Theta Metachain Required Interface ──────────────────────────────────

    /**
     * @notice Called by ValidatorStakeManager to mint staker rewards.
     * @dev    Returns false (does not revert) if minter check fails or supply is capped —
     *         this matches the Theta reference implementation's behaviour.
     */
    function mintStakerReward(address account, uint256 amount) external minterOnly returns (bool) {
        if (msg.sender != minter) return false;

        uint256 current = totalSupply();
        if (current >= maxSupply) return false;

        // Cap at maxSupply
        if (current + amount > maxSupply) {
            amount = maxSupply - current;
        }

        _mint(account, amount);
        return true;
    }

    /**
     * @notice Returns the number of XFGOV tokens minted per main-chain block as staker rewards.
     * @dev    ValidatorStakeManager reads this to compute per-epoch distributions.
     */
    function stakerRewardPerBlock() external view returns (uint256) {
        return _stakerRewardPerBlock;
    }

    // ─── Admin Functions ─────────────────────────────────────────────────────

    /**
     * @notice Update the minter to the ValidatorStakeManager address.
     * @dev    Call this after initial deployment with the VSM contract address.
     *         Privatenet VSM: 0xA826bA8Fa8998E324757c6BCB544f0Cdba3eb4AB
     *         Testnet VSM:    verify from Theta Metachain docs before setting.
     */
    function updateMinter(address newMinter) external adminOnly {
        require(newMinter != address(0), "minter is zero address");
        emit MinterUpdated(minter, newMinter);
        minter = newMinter;
    }

    function updateAdmin(address newAdmin) external adminOnly {
        require(newAdmin != address(0), "admin is zero address");
        emit AdminUpdated(admin, newAdmin);
        admin = newAdmin;
    }

    /**
     * @notice Adjust staker reward emission rate.
     * @dev    2e18 (2 XFGOV/block) matches privatenet default.
     *         Lower for mainnet to manage inflation.
     */
    function updateStakerRewardPerBlock(uint256 newRate) external adminOnly {
        emit StakerRewardPerBlockUpdated(_stakerRewardPerBlock, newRate);
        _stakerRewardPerBlock = newRate;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier adminOnly() {
        require(msg.sender == admin, "XFuelSubchainGovToken: caller is not admin");
        _;
    }

    modifier minterOnly() {
        require(msg.sender == minter, "XFuelSubchainGovToken: caller is not minter");
        _;
    }
}

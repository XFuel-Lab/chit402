// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AngelEscrow
 * @author XFuel Protocol
 * @custom:security-contact security@xfuel.app
 * @notice Immutable native-TFUEL escrow for the Angel round with fixed-purpose
 *         bucket accounting and bitmap-based multisig approvals.
 * @dev This contract is Theta-native and intentionally avoids token accounting,
 *      shared storage, and upgradeability. It ring-fences TFUEL into three
 *      fixed buckets:
 *      - AUDIT bucket: 0
 *      - SUBCHAIN bucket: 1
 *      - DEVOPS bucket: 2
 *
 *      Privileged operations require signer approvals via deterministic action
 *      hashes. Each signer occupies a fixed bitmap slot assigned at deployment.
 *      Signer membership is immutable after deployment and role mutation
 *      functions are permanently disabled.
 */
contract AngelEscrow is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    uint8 public constant AUDIT_BUCKET = 0;
    uint8 public constant SUBCHAIN_BUCKET = 1;
    uint8 public constant DEVOPS_BUCKET = 2;
    uint8 public constant BUCKET_COUNT = 3;

    string public constant VERSION = "1.0.0";

    bytes32 private constant ACTION_SET_BUCKET_CAP = keccak256("SET_BUCKET_CAP");
    bytes32 private constant ACTION_RELEASE_FROM_BUCKET = keccak256("RELEASE_FROM_BUCKET");
    bytes32 private constant ACTION_REFUND_EXCESS_TO_TREASURY = keccak256("REFUND_EXCESS_TO_TREASURY");
    bytes32 private constant ACTION_PAUSE = keccak256("PAUSE");
    bytes32 private constant ACTION_UNPAUSE = keccak256("UNPAUSE");

    /**
     * @notice Approval state tracked for a pending multisig action.
     * @param bitmap Bitset of signer approvals for the action hash.
     * @param approvals Number of unique signer approvals recorded.
     */
    struct ApprovalState {
        uint256 bitmap;
        uint256 approvals;
    }

    /// @notice Immutable treasury destination for excess refunds.
    address payable public immutable treasury;

    /// @notice Immutable approval threshold required to execute privileged actions.
    uint256 public immutable threshold;

    /// @notice Immutable ordered signer set used to derive bitmap positions.
    address[] public signers;

    /// @notice Bucket caps denominated in native TFUEL wei.
    uint256[BUCKET_COUNT] public bucketCaps;

    /// @notice Total native TFUEL ever received by this escrow.
    uint256 public totalRaised;

    /// @notice Lifetime amount released from each bucket denominated in native TFUEL wei.
    uint256[BUCKET_COUNT] private _releasedFromBucket;

    mapping(address => uint256) private _signerBit;
    mapping(bytes32 => ApprovalState) private _approvalStates;

    /**
     * @notice Emitted when native TFUEL is deposited into the escrow.
     * @param sender Address that provided the TFUEL.
     * @param amount Amount of TFUEL received.
     * @param newBalance Contract balance after the deposit.
     * @param totalRaisedAmount Lifetime TFUEL received by the escrow after the deposit.
     */
    event DepositReceived(
        address indexed sender,
        uint256 amount,
        uint256 newBalance,
        uint256 totalRaisedAmount
    );

    /**
     * @notice Emitted whenever a signer records approval for an action hash.
     * @param actionHash Deterministic hash of the action parameters.
     * @param signer Signer that approved the action.
     * @param approvals Current number of approvals recorded for the action.
     * @param thresholdRequired Threshold required for execution.
     */
    event ActionApproved(
        bytes32 indexed actionHash,
        address indexed signer,
        uint256 approvals,
        uint256 thresholdRequired
    );

    /**
     * @notice Emitted when an action reaches threshold and is consumed for execution.
     * @param actionHash Deterministic hash of the executed action.
     * @param executor Signer whose call completed the threshold.
     */
    event ActionExecuted(bytes32 indexed actionHash, address indexed executor);

    /**
     * @notice Emitted when a bucket cap is changed.
     * @param bucket Bucket identifier.
     * @param previousCap Previous bucket cap.
     * @param newCap New bucket cap.
     * @param actionHash Action hash that authorized the change.
     */
    event BucketCapUpdated(
        uint8 indexed bucket,
        uint256 previousCap,
        uint256 newCap,
        bytes32 indexed actionHash
    );

    /**
     * @notice Emitted when TFUEL is released from a bucket.
     * @param bucket Bucket identifier.
     * @param recipient Recipient of the released TFUEL.
     * @param amount Amount released.
     * @param totalReleasedBucket Lifetime amount released from the bucket after execution.
     * @param actionHash Action hash that authorized the release.
     */
    event BucketReleased(
        uint8 indexed bucket,
        address indexed recipient,
        uint256 amount,
        uint256 totalReleasedBucket,
        bytes32 indexed actionHash
    );

    /**
     * @notice Emitted when excess TFUEL above outstanding obligations is refunded to treasury.
     * @param treasuryRecipient Treasury recipient that received the refund.
     * @param amount Amount refunded.
     * @param remainingBalance Contract balance remaining after the refund.
     * @param actionHash Action hash that authorized the refund.
     */
    event ExcessRefunded(
        address indexed treasuryRecipient,
        uint256 amount,
        uint256 remainingBalance,
        bytes32 indexed actionHash
    );

    error InvalidSigner();
    error DuplicateSigner(address signer);
    error InvalidThreshold();
    error InvalidBucket(uint8 bucket);
    error ZeroAddress();
    error ZeroAmount();
    error RoleMutationDisabled();
    error NotSigner(address account);
    error ActionAlreadyApproved(bytes32 actionHash, address signer);
    error InsufficientBucketCapacity(uint8 bucket, uint256 available, uint256 requested);
    error InsufficientEscrowBalance(uint256 available, uint256 requiredAmount);
    error CapBelowReleased(uint8 bucket, uint256 releasedAmount, uint256 requestedCap);
    error NoExcessAvailable(uint256 balance, uint256 obligations);
    error NativeTransferFailed(address recipient, uint256 amount);

    /**
     * @notice Creates a new immutable Angel escrow instance.
     * @param initialSigners Ordered list of multisig signers. Maximum supported size is 256.
     * @param initialThreshold Number of signer approvals required for privileged execution.
     * @param treasuryRecipient Treasury destination for excess refunds.
     * @param initialBucketCaps Initial bucket caps for AUDIT, SUBCHAIN, and DEVOPS.
     */
    constructor(
        address[] memory initialSigners,
        uint256 initialThreshold,
        address payable treasuryRecipient,
        uint256[BUCKET_COUNT] memory initialBucketCaps
    ) {
        if (treasuryRecipient == address(0)) revert ZeroAddress();

        uint256 signerCount_ = initialSigners.length;
        if (signerCount_ == 0 || signerCount_ > 256) revert InvalidThreshold();
        if (initialThreshold == 0 || initialThreshold > signerCount_) revert InvalidThreshold();

        treasury = treasuryRecipient;
        threshold = initialThreshold;
        bucketCaps = initialBucketCaps;

        for (uint256 i = 0; i < signerCount_; ++i) {
            address signer = initialSigners[i];
            if (signer == address(0)) revert InvalidSigner();
            if (_signerBit[signer] != 0) revert DuplicateSigner(signer);

            uint256 bit = uint256(1) << i;
            _signerBit[signer] = bit;
            signers.push(signer);

            _grantRole(SIGNER_ROLE, signer);
            _grantRole(DEFAULT_ADMIN_ROLE, signer);
        }
    }

    /**
     * @notice Accepts a native TFUEL deposit into the escrow.
     */
    receive() external payable {
        _recordDeposit();
    }

    /**
     * @notice Accepts a native TFUEL deposit into the escrow.
     */
    function deposit() external payable {
        _recordDeposit();
    }

    /**
     * @notice Returns the current native TFUEL balance held by the escrow.
     * @return Current contract balance.
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Returns the number of configured signers.
     * @return Number of immutable signers.
     */
    function signerCount() external view returns (uint256) {
        return signers.length;
    }

    /**
     * @notice Returns the lifetime amount released from a bucket.
     * @param bucket Bucket identifier.
     * @return Amount released from the bucket.
     */
    function releasedFromBucket(uint8 bucket) public view returns (uint256) {
        _validateBucket(bucket);
        return _releasedFromBucket[bucket];
    }

    /**
     * @notice Returns aggregate unreleased obligations across all buckets.
     * @dev This calculation is intentionally defensive and does not assume
     *      `bucketCaps[i] >= _releasedFromBucket[i]` even though state-changing
     *      paths enforce that invariant.
     * @return obligations Sum of remaining obligations across all buckets.
     */
    function outstandingObligations() public view returns (uint256 obligations) {
        for (uint256 i = 0; i < BUCKET_COUNT; ++i) {
            uint256 cap = bucketCaps[i];
            uint256 released = _releasedFromBucket[i];
            if (cap > released) {
                obligations += cap - released;
            }
        }
    }

    /**
     * @notice Records signer approval and, once threshold is met, updates a bucket cap.
     * @param bucket Bucket identifier.
     * @param newCap New cap for the bucket.
     * @return executed True if this call reached threshold and executed the action.
     */
    function setBucketCap(uint8 bucket, uint256 newCap)
        external
        onlySigner
        whenNotPaused
        nonReentrant
        returns (bool executed)
    {
        _validateBucket(bucket);

        uint256 alreadyReleased = _releasedFromBucket[bucket];
        if (newCap < alreadyReleased) {
            revert CapBelowReleased(bucket, alreadyReleased, newCap);
        }

        bytes32 actionHash = keccak256(
            abi.encode(address(this), block.chainid, ACTION_SET_BUCKET_CAP, bucket, newCap)
        );

        executed = _approveAction(actionHash);
        if (!executed) {
            return false;
        }

        uint256 previousCap = bucketCaps[bucket];
        bucketCaps[bucket] = newCap;

        emit BucketCapUpdated(bucket, previousCap, newCap, actionHash);
    }

    /**
     * @notice Records signer approval and, once threshold is met, releases TFUEL from a bucket.
     * @param bucket Bucket identifier.
     * @param recipient Recipient of the TFUEL release.
     * @param amount Amount of TFUEL to release.
     * @return executed True if this call reached threshold and executed the action.
     */
    function releaseFromBucket(
        uint8 bucket,
        address payable recipient,
        uint256 amount
    ) external onlySigner whenNotPaused nonReentrant returns (bool executed) {
        _validateBucket(bucket);
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 availableBucket = bucketCaps[bucket] - _releasedFromBucket[bucket];
        if (amount > availableBucket) {
            revert InsufficientBucketCapacity(bucket, availableBucket, amount);
        }

        if (address(this).balance < amount) {
            revert InsufficientEscrowBalance(address(this).balance, amount);
        }

        bytes32 actionHash = keccak256(
            abi.encode(address(this), block.chainid, ACTION_RELEASE_FROM_BUCKET, bucket, recipient, amount)
        );

        executed = _approveAction(actionHash);
        if (!executed) {
            return false;
        }

        _releasedFromBucket[bucket] += amount;
        _safeNativeTransfer(recipient, amount);

        emit BucketReleased(bucket, recipient, amount, _releasedFromBucket[bucket], actionHash);
    }

    /**
     * @notice Records signer approval and, once threshold is met, refunds all excess TFUEL to treasury.
     * @dev Excess is defined as contract balance above outstanding obligations.
     * @return executed True if this call reached threshold and executed the action.
     */
    function refundExcessToTreasury()
        external
        onlySigner
        whenNotPaused
        nonReentrant
        returns (bool executed)
    {
        uint256 obligations = outstandingObligations();
        uint256 balance = address(this).balance;

        if (balance <= obligations) revert NoExcessAvailable(balance, obligations);

        bytes32 actionHash = keccak256(
            abi.encode(address(this), block.chainid, ACTION_REFUND_EXCESS_TO_TREASURY)
        );

        executed = _approveAction(actionHash);
        if (!executed) {
            return false;
        }

        uint256 refundAmount = balance - obligations;
        _safeNativeTransfer(treasury, refundAmount);

        emit ExcessRefunded(treasury, refundAmount, address(this).balance, actionHash);
    }

    /**
     * @notice Records signer approval and, once threshold is met, pauses privileged execution.
     * @return executed True if this call reached threshold and executed the action.
     */
    function pause() external onlySigner whenNotPaused returns (bool executed) {
        bytes32 actionHash = keccak256(
            abi.encode(address(this), block.chainid, ACTION_PAUSE)
        );

        executed = _approveAction(actionHash);
        if (!executed) {
            return false;
        }

        _pause();
    }

    /**
     * @notice Records signer approval and, once threshold is met, unpauses privileged execution.
     * @return executed True if this call reached threshold and executed the action.
     */
    function unpause() external onlySigner whenPaused returns (bool executed) {
        bytes32 actionHash = keccak256(
            abi.encode(address(this), block.chainid, ACTION_UNPAUSE)
        );

        executed = _approveAction(actionHash);
        if (!executed) {
            return false;
        }

        _unpause();
    }

    /**
     * @notice Returns pending approval state for a specific action hash.
     * @param actionHash Deterministic action hash.
     * @return bitmap Current signer approval bitmap.
     * @return approvals Current number of signer approvals.
     */
    function getApprovalState(bytes32 actionHash) external view returns (uint256 bitmap, uint256 approvals) {
        ApprovalState storage state = _approvalStates[actionHash];
        return (state.bitmap, state.approvals);
    }

    /**
     * @notice Disables role grants permanently after deployment.
     */
    function grantRole(bytes32, address) public pure override {
        revert RoleMutationDisabled();
    }

    /**
     * @notice Disables role revocations permanently after deployment.
     */
    function revokeRole(bytes32, address) public pure override {
        revert RoleMutationDisabled();
    }

    /**
     * @notice Disables role renounce permanently after deployment.
     */
    function renounceRole(bytes32, address) public pure override {
        revert RoleMutationDisabled();
    }

    /**
     * @notice Restricts function access to immutable signers only.
     */
    modifier onlySigner() {
        if (!hasRole(SIGNER_ROLE, msg.sender)) revert NotSigner(msg.sender);
        _;
    }

    /**
     * @notice Records a native TFUEL deposit and updates deposit accounting.
     */
    function _recordDeposit() internal {
        if (msg.value == 0) revert ZeroAmount();

        totalRaised += msg.value;
        emit DepositReceived(msg.sender, msg.value, address(this).balance, totalRaised);
    }

    /**
     * @notice Validates a bucket identifier.
     * @param bucket Bucket identifier.
     */
    function _validateBucket(uint8 bucket) internal pure {
        if (bucket >= BUCKET_COUNT) revert InvalidBucket(bucket);
    }

    /**
     * @notice Records signer approval for an action and returns true only when threshold is reached.
     * @param actionHash Deterministic action hash.
     * @return executed True when the action reached threshold and was consumed.
     */
    function _approveAction(bytes32 actionHash) internal returns (bool executed) {
        uint256 bit = _signerBit[msg.sender];
        if (bit == 0) revert NotSigner(msg.sender);

        ApprovalState storage state = _approvalStates[actionHash];
        if (state.bitmap & bit != 0) {
            revert ActionAlreadyApproved(actionHash, msg.sender);
        }

        state.bitmap |= bit;
        unchecked {
            state.approvals += 1;
        }

        emit ActionApproved(actionHash, msg.sender, state.approvals, threshold);

        if (state.approvals < threshold) {
            return false;
        }

        delete _approvalStates[actionHash];
        emit ActionExecuted(actionHash, msg.sender);
        return true;
    }

    /**
     * @notice Transfers native TFUEL and reverts on failure.
     * @param recipient Recipient address.
     * @param amount Amount to transfer.
     */
    function _safeNativeTransfer(address payable recipient, uint256 amount) internal {
        (bool ok, ) = recipient.call{value: amount}("");
        if (!ok) revert NativeTransferFailed(recipient, amount);
    }
}

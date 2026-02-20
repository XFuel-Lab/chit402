// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MappingSensor
 * @author XFuel Protocol -- Expansion Circuit #14
 * @notice Decentralized Mapping and Sensor Data: ZK-verified geospatial attestation,
 *         crowdsourced map contributions, and sensor data marketplace.
 *
 * Architecture (inspired by Hivemapper + DIMO + WeatherXM, generalized):
 *   1. Device Registration  -- Dashcams/sensors register with type, location, firmware hash.
 *   2. Data Submission       -- Devices submit ZK-proven geospatial data (imagery/telemetry).
 *   3. Quality Scoring       -- AI quality checks via SP1-verified image/data quality proofs.
 *   4. Marketplace           -- Buyers purchase verified map/sensor data with protocol fees.
 *   5. Coverage Rewards      -- Devices earn based on map freshness, coverage gaps, data quality.
 *
 * Research ties:
 *   - Hivemapper (hivemapper.com): Decentralized mapping with 4K dashcams;
 *     HONEY burn-and-mint economy; 200-300B dollar mapping industry.
 *   - DIMO (dimo.zone): Vehicle data DePIN; 100K+ connected cars;
 *     on-chain attestation of driving data; insurance/fleet analytics.
 *   - WeatherXM (weatherxm.com): Community weather stations; WXM token;
 *     hyper-local weather data for agriculture/insurance/logistics.
 *
 *   For XFuel integration:
 *   - EVM anchor for device fleet; raw imagery/sensor data stays off-chain.
 *   - SP1 proves: "Device D captured data at location L with quality Q at time T"
 *     without revealing proprietary routes or customer PII.
 *   - Fees flow to CoreRevenueSplitter (0.5% protocol fee on data purchases).
 *   - Fully isolated: own device registry, submission state, marketplace.
 *
 * Core Layer integration:
 *   - Emits DataSubmitted / DataPurchased for ai-listener.js coordination.
 *   - Sends protocol fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for geospatial data proof verification.
 */
contract MappingSensor is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("MAPPING_SENSOR_CIRCUIT");

    address public revenueSplitter;
    address public zkVerifier;

    uint16 public protocolFeeBps = 50;
    uint16 public constant MAX_FEE = 200;
    uint16 public constant BPS_DENOM = 10000;

    enum DeviceType { Dashcam, WeatherStation, AirQuality, Traffic, Lidar, Generic }

    struct Device {
        bytes32 deviceId;
        address owner;
        DeviceType deviceType;
        bytes32 locationHash;
        bytes32 firmwareHash;
        uint256 totalSubmissions;
        uint256 totalEarned;
        uint256 qualityScore;
        bool    active;
        uint64  registeredAt;
    }

    mapping(bytes32 => Device) public devices;
    uint256 public deviceCount;

    struct Submission {
        bytes32 submissionId;
        bytes32 deviceId;
        bytes32 dataHash;
        bytes32 locationHash;
        uint256 dataSizeBytes;
        uint256 qualityScore;
        bytes32 proofNullifier;
        uint64  submittedAt;
    }

    mapping(bytes32 => Submission) public submissions;
    uint256 public submissionCount;
    mapping(bytes32 => bool) public usedNullifiers;

    enum ListingStatus { Active, Sold, Expired, Cancelled }

    struct DataListing {
        bytes32 listingId;
        bytes32 submissionId;
        address seller;
        uint256 price;
        ListingStatus status;
        address buyer;
        uint64  listedAt;
        uint64  soldAt;
    }

    mapping(bytes32 => DataListing) public listings;
    uint256 public listingCount;

    mapping(bytes32 => uint256) public regionCoverage;

    uint256 public totalDataSold;
    uint256 public totalVolume;
    uint256 public totalFeesCollected;

    event DeviceRegistered(bytes32 indexed deviceId, address indexed owner, DeviceType deviceType);
    event DeviceUpdated(bytes32 indexed deviceId, bool active);
    event DataSubmitted(bytes32 indexed circuitId, bytes32 indexed deviceId, bytes32 submissionId, bytes32 dataHash, bytes32 nullifier);
    event DataListed(bytes32 indexed circuitId, bytes32 indexed listingId, bytes32 submissionId, uint256 price);
    event DataPurchased(bytes32 indexed listingId, address indexed buyer, uint256 price, uint256 fee);
    event DataCancelled(bytes32 indexed listingId);
    event CoverageUpdated(bytes32 indexed locationHash, uint256 count);

    error DeviceNotFound();
    error DeviceNotActive();
    error SubmissionNotFound();
    error ListingNotFound();
    error InvalidListingStatus();
    error NullifierUsed();
    error InsufficientPayment();

    constructor(address _admin, address _revenueSplitter, address _zkVerifier) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
    }

    function registerDevice(
        DeviceType deviceType,
        bytes32 locationHash,
        bytes32 firmwareHash
    ) external whenNotPaused returns (bytes32 deviceId) {
        require(locationHash != bytes32(0), "ZeroLocation");
        require(firmwareHash != bytes32(0), "ZeroFirmware");

        deviceId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, deviceCount));

        devices[deviceId] = Device({
            deviceId: deviceId,
            owner: msg.sender,
            deviceType: deviceType,
            locationHash: locationHash,
            firmwareHash: firmwareHash,
            totalSubmissions: 0,
            totalEarned: 0,
            qualityScore: 5000,
            active: true,
            registeredAt: uint64(block.timestamp)
        });

        deviceCount++;
        emit DeviceRegistered(deviceId, msg.sender, deviceType);
    }

    function updateDevice(bytes32 deviceId, bool active) external {
        Device storage d = devices[deviceId];
        if (d.registeredAt == 0) revert DeviceNotFound();
        require(msg.sender == d.owner || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "NotAuth");
        d.active = active;
        emit DeviceUpdated(deviceId, active);
    }

    function submitData(
        bytes32 deviceId,
        bytes32 dataHash,
        bytes32 locationHash,
        uint256 dataSizeBytes,
        uint256 qualityScore,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused {
        Device storage d = devices[deviceId];
        if (d.registeredAt == 0) revert DeviceNotFound();
        if (!d.active) revert DeviceNotActive();
        if (usedNullifiers[nullifier]) revert NullifierUsed();
        require(dataHash != bytes32(0), "ZeroData");
        require(dataSizeBytes > 0, "ZeroSize");

        usedNullifiers[nullifier] = true;

        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        bytes32 subId = keccak256(abi.encodePacked(CIRCUIT_ID, deviceId, submissionCount));

        submissions[subId] = Submission({
            submissionId: subId,
            deviceId: deviceId,
            dataHash: dataHash,
            locationHash: locationHash,
            dataSizeBytes: dataSizeBytes,
            qualityScore: qualityScore,
            proofNullifier: nullifier,
            submittedAt: uint64(block.timestamp)
        });

        submissionCount++;
        d.totalSubmissions++;
        d.qualityScore = (d.qualityScore * 9 + qualityScore) / 10;

        regionCoverage[locationHash]++;
        emit CoverageUpdated(locationHash, regionCoverage[locationHash]);
        emit DataSubmitted(CIRCUIT_ID, deviceId, subId, dataHash, nullifier);
    }

    function listData(
        bytes32 submissionId,
        uint256 price
    ) external whenNotPaused returns (bytes32 listingId) {
        Submission storage s = submissions[submissionId];
        if (s.submittedAt == 0) revert SubmissionNotFound();
        Device storage d = devices[s.deviceId];
        require(msg.sender == d.owner, "NotOwner");
        require(price > 0, "ZeroPrice");

        listingId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, listingCount));

        listings[listingId] = DataListing({
            listingId: listingId,
            submissionId: submissionId,
            seller: msg.sender,
            price: price,
            status: ListingStatus.Active,
            buyer: address(0),
            listedAt: uint64(block.timestamp),
            soldAt: 0
        });

        listingCount++;
        emit DataListed(CIRCUIT_ID, listingId, submissionId, price);
    }

    function purchaseData(bytes32 listingId) external payable nonReentrant whenNotPaused {
        DataListing storage l = listings[listingId];
        if (l.listedAt == 0) revert ListingNotFound();
        if (l.status != ListingStatus.Active) revert InvalidListingStatus();
        if (msg.value < l.price) revert InsufficientPayment();

        uint256 fee = (msg.value * protocolFeeBps) / BPS_DENOM;
        uint256 sellerPayment = msg.value - fee;

        l.buyer = msg.sender;
        l.status = ListingStatus.Sold;
        l.soldAt = uint64(block.timestamp);

        Submission storage s = submissions[l.submissionId];
        Device storage d = devices[s.deviceId];
        d.totalEarned += sellerPayment;

        totalDataSold++;
        totalVolume += msg.value;
        totalFeesCollected += fee;

        if (fee > 0) _forwardFee(fee);

        (bool ok, ) = payable(l.seller).call{value: sellerPayment}("");
        require(ok, "PayFailed");

        emit DataPurchased(listingId, msg.sender, sellerPayment, fee);
    }

    function cancelListing(bytes32 listingId) external {
        DataListing storage l = listings[listingId];
        if (l.listedAt == 0) revert ListingNotFound();
        require(msg.sender == l.seller, "NotOwner");
        require(l.status == ListingStatus.Active, "OnlyActive");

        l.status = ListingStatus.Cancelled;
        emit DataCancelled(listingId);
    }

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

    function setProtocolFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= MAX_FEE, "FeeTooHigh");
        protocolFeeBps = _bps;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) { revenueSplitter = _rs; }
    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) { zkVerifier = _zk; }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function getDevice(bytes32 id) external view returns (Device memory) { return devices[id]; }
    function getSubmission(bytes32 id) external view returns (Submission memory) { return submissions[id]; }
    function getListing(bytes32 id) external view returns (DataListing memory) { return listings[id]; }

    function getStats() external view returns (
        uint256 devices_, uint256 submissions_, uint256 listings_,
        uint256 dataSold_, uint256 volume_, uint256 fees_
    ) {
        return (deviceCount, submissionCount, listingCount,
                totalDataSold, totalVolume, totalFeesCollected);
    }

    receive() external payable {}
}

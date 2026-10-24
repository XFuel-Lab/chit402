// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {EscrowMerkle} from "./EscrowMerkle.sol";
import {Jwk7638} from "./Jwk7638.sol";

/// @title EquivocationEscrowV0
/// @notice Base Sepolia (chainId 84532) test bond for the Chit402 receipt log.
///         The log issuer posts a bond in test USDC. Anyone who holds two
///         EIP-712 tree heads, signed by the pinned P-256 key, that disagree
///         about the same log (type A: same epoch and size, different roots;
///         type B: same epoch, different leaves at the same index) can submit
///         them through a two-step commit and reveal. A valid reveal freezes
///         withdrawal for the claim window, pays one bounty per epoch to the
///         earliest commit, and lets affected payers register a refund using a
///         signed ReceiptBinding.
///
///         Testnet only. Mainnet needs its own design. There is no pause, no
///         upgrade path, no key rotation and no list edit after activation.
///         Every failed check reverts with no state change.
contract EquivocationEscrowV0 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    /// @dev EIP-712 `TreeHead(uint32 epoch,uint64 tree_size,bytes32 root,uint64 published_at,bytes32 kid)`.
    struct TreeHead {
        uint32 epoch;
        uint64 treeSize;
        bytes32 root;
        uint64 publishedAt;
        bytes32 kid;
    }

    /// @dev P-256 signature as two big-endian 32-byte words. High-S is accepted.
    struct Sig {
        bytes32 r;
        bytes32 s;
    }

    /// @dev EIP-712 `ReceiptBinding(bytes32 leaf_hash,bytes32 payer_commitment,uint64 amount_atomic,bytes32 asset_id,bytes32 kid)`.
    struct ReceiptBinding {
        bytes32 leafHash;
        bytes32 payerCommitment;
        uint64 amountAtomic;
        bytes32 assetId;
        bytes32 kid;
    }

    /// @dev Type B evidence: two heads in one epoch that place different
    ///      leaves at the same index.
    struct EvidenceB {
        TreeHead h1;
        Sig s1;
        TreeHead h2;
        Sig s2;
        uint64 index;
        bytes32 l1;
        bytes32 l2;
        bytes32[] p1;
        bytes32[] p2;
    }

    /// @dev One quarantine list entry, or one high-water mark.
    struct HeadRef {
        uint32 epoch;
        uint64 treeSize;
        bytes32 root;
    }

    struct Commit {
        address committer;
        uint48 at;
        uint48 seq;
    }

    struct Incident {
        uint32 epoch;
        uint64 openedAt;
        uint64 claimsCloseAt;
        uint64 freezeUntil;
        bool settled;
        uint256 requested;
        uint256 pool;
    }

    struct EpochBounty {
        uint64 firstRevealAt;
        uint48 bestSeq;
        bool finalized;
        address bestPayTo;
        uint256 paid;
    }

    struct BKey {
        bytes32 lo;
        bytes32 hi;
        uint256 incidentId;
    }

    struct Refund {
        address payer;
        uint64 amount;
        bool paid;
        uint256 incidentId;
    }

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------

    uint256 public constant CHAIN_ID = 84532;

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,bytes32 salt)");
    bytes32 public constant TREEHEAD_TYPEHASH =
        keccak256("TreeHead(uint32 epoch,uint64 tree_size,bytes32 root,uint64 published_at,bytes32 kid)");
    bytes32 public constant BINDING_TYPEHASH = keccak256(
        "ReceiptBinding(bytes32 leaf_hash,bytes32 payer_commitment,uint64 amount_atomic,bytes32 asset_id,bytes32 kid)"
    );
    bytes32 public constant COMMIT_TAG = keccak256("chit402.escrow.v0.commit");
    bytes32 public constant PAYER_TAG = keccak256("chit402.payer-commitment.v1");
    /// @dev The receipt payment asset (Base mainnet USDC, CAIP-19 style). Bindings
    ///      name the asset the receipt was paid in. The bond itself is Base Sepolia
    ///      test USDC, so refunds pay test USDC against mainnet-shaped amounts.
    bytes32 public constant USDC_BASE_ID = keccak256("eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");

    address public constant P256_VERIFIER = address(0x100);

    uint8 public constant EVIDENCE_A = 1;
    uint8 public constant EVIDENCE_B = 2;

    uint256 public constant MIN_DELAY = 5 minutes;
    uint256 public constant REVEAL_WINDOW = 24 hours;
    uint256 public constant CONTEST_WINDOW = 1 hours;
    uint256 public constant MAX_OPEN_COMMITS = 8;

    uint256 public constant BOND_PERIOD = 14 days;
    uint256 public constant NOTICE_PERIOD = 14 days;
    uint256 public constant CLAIM_WINDOW = 14 days;
    /// @dev Cumulative withdrawal freeze over the bond's whole life.
    uint256 public constant FREEZE_CAP = 28 days;

    uint256 public constant MIN_BOND = 1_000_000_000; // 1,000 USDC (6 decimals)
    uint256 public constant BOUNTY = 50_000_000; // 50 USDC per epoch
    uint256 public constant BOUNTY_CAP = 100_000_000; // 100 USDC total
    uint256 public constant REFUND_CAP = 5_000_000; // 5 USDC per receipt

    // ------------------------------------------------------------------
    // Immutables
    // ------------------------------------------------------------------

    address public immutable OWNER;
    IERC20 public immutable TOKEN;
    bytes32 public immutable KID;
    bytes32 public immutable PUB_X;
    bytes32 public immutable PUB_Y;
    bytes32 public immutable LOG_SALT;
    bytes32 public immutable TREEHEAD_DOMAIN_SEPARATOR;
    bytes32 public immutable BINDING_DOMAIN_SEPARATOR;

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    uint256 public bondAccounted;
    uint64 public activatedAt;
    uint64 public noticeAt;
    bool public closed;
    /// @dev Withdrawal is frozen while block.timestamp < freezeUntil. Each
    ///      incident freezes from its opening for min(CLAIM_WINDOW, the
    ///      unused cap), charged to frozenUsed when it opens. Once frozenUsed
    ///      reaches FREEZE_CAP, later incidents still record evidence and pay
    ///      from the remaining bond, but never freeze.
    uint64 public freezeUntil;
    uint32 public frozenUsed;

    bool public listPinned;
    bytes32 public quarantineListHash;
    uint256 public quarantineCount;
    mapping(bytes32 => bool) public quarantined;

    uint48 public commitSeq;
    mapping(bytes32 => Commit) public commits;
    mapping(address => bytes32[MAX_OPEN_COMMITS]) internal _commitSlots;

    uint256 public incidentCount;
    mapping(uint256 => Incident) internal _incidents;
    /// @dev incidentKey(epoch) => incident id (0 = none). One fork is one
    ///      incident: once an epoch's incident exists, every later key from
    ///      that epoch joins it while its claim window is open and is refused
    ///      after, so a settled epoch never opens or freezes again.
    mapping(bytes32 => uint256) public incidentOf;
    /// @dev Incidents opened and not yet settled.
    uint256 public openIncidents;
    /// @dev Sum of `requested` over unsettled incidents (bounty reserve).
    uint256 public openRequested;

    mapping(uint32 => EpochBounty) internal _bounties;
    uint256 public bountiesPaid;
    uint256 public pendingBounties;

    /// @dev Evidence key => incident id it was recorded under (0 = unseen).
    mapping(bytes32 => uint256) public evidenceIncident;
    mapping(bytes32 => BKey) internal _bKeys;

    /// @dev Leaf hash => registered refund. One refund per leaf across incidents.
    mapping(bytes32 => Refund) internal _refunds;

    mapping(address => uint256) public credits;

    // ------------------------------------------------------------------
    // Errors (no error echoes caller input)
    // ------------------------------------------------------------------

    error WrongChain();
    error ZeroAddress();
    error NoTokenCode();
    error WrongDecimals();
    error KidMismatch();
    error LivenessFailed();
    error NotOwner();
    error AlreadyActive();
    error NotActive();
    error ListAlreadyPinned();
    error ListNotPinned();
    error EmptyListHash();
    error AboveHighWater();
    error DuplicateHighWater();
    error BondTooSmall();
    error FundingMismatch();
    error ZeroAmount();
    error TooEarly();
    error NoNotice();
    error NoticeAlreadyGiven();
    error IncidentOpen();
    error CoverageEnded();
    error CommitExists();
    error TooManyOpenCommits();
    error NoCommit();
    error CommitTooYoung();
    error CommitExpired();
    error ZeroPayTo();
    error NotEquivocation();
    error UnknownKid();
    error BadSignature();
    error Excluded();
    error BadProof();
    error DuplicateEvidence();
    error NoPendingBounty();
    error ContestOpen();
    error NotAffected();
    error ClaimsClosed();
    error BadCommitment();
    error WrongAsset();
    error AlreadyClaimed();
    error NothingToSettle();
    error IncidentClosed();
    error AnotherIncidentOpen();
    error ClaimsOpen();
    error NotSettled();
    error NothingToClaim();

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event LivenessHead(uint32 epoch, uint64 treeSize, bytes32 root);
    event QuarantineListPinned(bytes32 listHash, uint256 entryCount);
    event Funded(uint256 amount, uint256 bondAccounted);
    event Activated(uint64 at);
    event NoticeGiven(uint64 at, uint64 withdrawableAt);
    event NoticeCancelled(uint64 at);
    event Withdrawn(uint256 amount);
    event Committed(bytes32 indexed commitHash, address indexed committer, uint48 seq);
    event EvidenceRecorded(
        bytes32 indexed key, uint8 evidenceType, uint32 epoch, uint48 seq, address payTo, uint256 incidentId
    );
    event IncidentOpened(uint256 indexed incidentId, uint32 indexed epoch, uint64 claimsCloseAt, uint64 freezeUntil);
    event BountyFinalized(uint32 indexed epoch, address payTo, uint256 amount);
    event RefundRegistered(bytes32 indexed leafHash, address payer, uint256 amount, uint256 incidentId);
    event IncidentSettled(uint256 indexed incidentId, uint256 requested, uint256 pool);
    event RefundPaid(bytes32 indexed leafHash, address payer, uint256 amount);
    event CreditClaimed(address indexed payee, uint256 amount);

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    /// @param owner_     Immutable owner (funds, pins the list, activates, gives notice, withdraws).
    /// @param token_     Bond token. Base Sepolia USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e.
    /// @param kid_       32-byte RFC 7638 thumbprint of the issuer key.
    /// @param pubX_      Issuer P-256 public x.
    /// @param pubY_      Issuer P-256 public y.
    /// @param logSalt_   EIP-712 domain salt (log id).
    /// @param liveHead   A genuine head signed by the issuer key, proving 0x100 and the key work here.
    /// @param liveSig    Its signature.
    constructor(
        address owner_,
        address token_,
        bytes32 kid_,
        bytes32 pubX_,
        bytes32 pubY_,
        bytes32 logSalt_,
        TreeHead memory liveHead,
        Sig memory liveSig
    ) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (owner_ == address(0) || token_ == address(0)) revert ZeroAddress();
        if (token_.code.length == 0) revert NoTokenCode();
        if (IERC20Metadata(token_).decimals() != 6) revert WrongDecimals();
        if (Jwk7638.thumbprintP256(pubX_, pubY_) != kid_) revert KidMismatch();

        OWNER = owner_;
        TOKEN = IERC20(token_);
        KID = kid_;
        PUB_X = pubX_;
        PUB_Y = pubY_;
        LOG_SALT = logSalt_;
        bytes32 tdom = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Chit402TreeHead"), keccak256("1"), CHAIN_ID, logSalt_)
        );
        TREEHEAD_DOMAIN_SEPARATOR = tdom;
        BINDING_DOMAIN_SEPARATOR = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Chit402ReceiptBinding"), keccak256("1"), CHAIN_ID, logSalt_)
        );

        if (liveHead.kid != kid_) revert LivenessFailed();
        bytes32 e = sha256(abi.encodePacked(hex"1901", tdom, _treeHeadStructHash(liveHead)));
        if (!_p256(e, liveSig.r, liveSig.s, pubX_, pubY_)) revert LivenessFailed();
        emit LivenessHead(liveHead.epoch, liveHead.treeSize, liveHead.root);
    }

    // ------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != OWNER) revert NotOwner();
        _;
    }

    /// @notice Pin the issuer-signed quarantine list. Once only, and only before activation.
    /// @param listHash   sha256 of the RFC 8785 bytes of the published list document.
    /// @param entries    Quarantined heads (epoch, tree_size, root).
    /// @param highWater  Highest signed head per epoch at list signing time.
    function pinQuarantineList(bytes32 listHash, HeadRef[] calldata entries, HeadRef[] calldata highWater)
        external
        onlyOwner
        nonReentrant
    {
        if (activatedAt != 0) revert AlreadyActive();
        if (listPinned) revert ListAlreadyPinned();
        if (listHash == bytes32(0)) revert EmptyListHash();
        for (uint256 i = 0; i < highWater.length; i++) {
            for (uint256 j = i + 1; j < highWater.length; j++) {
                if (highWater[i].epoch == highWater[j].epoch) revert DuplicateHighWater();
            }
        }
        for (uint256 i = 0; i < entries.length; i++) {
            bool covered = false;
            for (uint256 j = 0; j < highWater.length; j++) {
                if (highWater[j].epoch == entries[i].epoch && entries[i].treeSize <= highWater[j].treeSize) {
                    covered = true;
                    break;
                }
            }
            if (!covered) revert AboveHighWater();
            quarantined[_headRefKey(entries[i].epoch, entries[i].treeSize, entries[i].root)] = true;
        }
        listPinned = true;
        quarantineListHash = listHash;
        quarantineCount = entries.length;
        emit QuarantineListPinned(listHash, entries.length);
    }

    /// @notice Add to the bond. The token balance must grow by exactly `amount`.
    function fund(uint256 amount) external onlyOwner nonReentrant {
        if (closed) revert NotActive();
        if (amount == 0) revert ZeroAmount();
        uint256 beforeBal = TOKEN.balanceOf(address(this));
        TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBal = TOKEN.balanceOf(address(this));
        if (afterBal < beforeBal || afterBal - beforeBal != amount) revert FundingMismatch();
        bondAccounted += amount;
        emit Funded(amount, bondAccounted);
    }

    function activate() external onlyOwner nonReentrant {
        if (activatedAt != 0 || closed) revert AlreadyActive();
        if (!listPinned) revert ListNotPinned();
        if (bondAccounted < MIN_BOND) revert BondTooSmall();
        activatedAt = uint64(block.timestamp);
        emit Activated(activatedAt);
    }

    function giveNotice() external onlyOwner nonReentrant {
        if (activatedAt == 0 || closed) revert NotActive();
        if (noticeAt != 0) revert NoticeAlreadyGiven();
        if (block.timestamp < uint256(activatedAt) + BOND_PERIOD) revert TooEarly();
        noticeAt = uint64(block.timestamp);
        emit NoticeGiven(noticeAt, uint64(block.timestamp + NOTICE_PERIOD));
    }

    function cancelNotice() external onlyOwner nonReentrant {
        if (closed) revert NotActive();
        if (noticeAt == 0) revert NoNotice();
        noticeAt = 0;
        emit NoticeCancelled(uint64(block.timestamp));
    }

    /// @notice Withdraw the remaining bond after notice, the notice period and
    ///         the reveal grace, while withdrawal is not frozen. Registered
    ///         refunds of unsettled incidents and pending bounties (within the
    ///         cap) stay in the contract and remain claimable. Closing ends
    ///         new reveals and new refund registrations. Before activation
    ///         nothing is covered yet, so the owner may withdraw at any time.
    function withdraw() external onlyOwner nonReentrant {
        if (closed) revert NotActive();
        uint256 reserve = 0;
        if (activatedAt != 0) {
            if (noticeAt == 0) revert NoNotice();
            if (block.timestamp < revealGraceEnd()) revert TooEarly();
            if (_frozen()) revert IncidentOpen();
            uint256 bountyRoom = BOUNTY_CAP - bountiesPaid;
            uint256 bountyReserve = pendingBounties * BOUNTY;
            reserve = openRequested + (bountyReserve < bountyRoom ? bountyReserve : bountyRoom);
        }
        uint256 kept = bondAccounted < reserve ? bondAccounted : reserve;
        uint256 amount = bondAccounted - kept;
        bondAccounted = kept;
        closed = true;
        if (amount != 0) TOKEN.safeTransfer(OWNER, amount);
        emit Withdrawn(amount);
    }

    // ------------------------------------------------------------------
    // Commit and reveal
    // ------------------------------------------------------------------

    /// @notice Step 1. `c = commitHash(msg.sender, payTo, evidenceType, evidenceHash, salt)`.
    function commit(bytes32 c) external nonReentrant {
        if (closed) revert NotActive();
        if (noticeAt != 0 && block.timestamp >= uint256(noticeAt) + NOTICE_PERIOD) revert CoverageEnded();
        Commit storage existing = commits[c];
        if (existing.committer != address(0) && !_expired(existing)) revert CommitExists();

        bytes32[MAX_OPEN_COMMITS] storage slots = _commitSlots[msg.sender];
        uint256 slot = MAX_OPEN_COMMITS;
        for (uint256 i = 0; i < MAX_OPEN_COMMITS; i++) {
            bytes32 h = slots[i];
            if (h == c) {
                slot = i;
                break;
            }
            if (h == bytes32(0)) {
                // Slots are filled in order and never cleared, so nothing
                // after the first empty slot is in use.
                if (slot == MAX_OPEN_COMMITS) slot = i;
                break;
            }
            if (slot == MAX_OPEN_COMMITS) {
                Commit storage old = commits[h];
                if (old.committer == address(0) || _expired(old)) slot = i;
            }
        }
        if (slot == MAX_OPEN_COMMITS) revert TooManyOpenCommits();
        bytes32 prev = slots[slot];
        if (prev != bytes32(0) && prev != c) delete commits[prev];
        slots[slot] = c;

        uint48 seq = ++commitSeq;
        commits[c] = Commit({committer: msg.sender, at: uint48(block.timestamp), seq: seq});
        emit Committed(c, msg.sender, seq);
    }

    /// @notice Step 2 for type A: same epoch and tree size, different roots.
    function revealA(TreeHead calldata h1, Sig calldata s1, TreeHead calldata h2, Sig calldata s2, address payTo, bytes32 salt)
        external
        nonReentrant
    {
        uint48 seq = _consumeCommit(payTo, EVIDENCE_A, evidenceHashA(h1, s1, h2, s2), salt);
        if (h1.epoch != h2.epoch || h1.treeSize != h2.treeSize || h1.root == h2.root) revert NotEquivocation();
        _checkHead(h1, s1);
        _checkHead(h2, s2);
        (bytes32 lo, bytes32 hi) = _order(h1.root, h2.root);
        bytes32 key = keyA(h1.epoch, h1.treeSize, lo, hi);
        _record(key, EVIDENCE_A, h1.epoch, seq, payTo, lo, hi);
    }

    /// @notice Step 2 for type B: same epoch, different leaves at the same index.
    function revealB(EvidenceB calldata ev, address payTo, bytes32 salt) external nonReentrant {
        uint48 seq = _consumeCommit(payTo, EVIDENCE_B, evidenceHashB(ev), salt);
        if (ev.h1.epoch != ev.h2.epoch || ev.l1 == ev.l2) revert NotEquivocation();
        if (ev.index >= ev.h1.treeSize || ev.index >= ev.h2.treeSize) revert BadProof();
        _checkHead(ev.h1, ev.s1);
        _checkHead(ev.h2, ev.s2);
        if (!EscrowMerkle.verifyInclusion(ev.l1, ev.index, ev.h1.treeSize, ev.h1.root, ev.p1)) revert BadProof();
        if (!EscrowMerkle.verifyInclusion(ev.l2, ev.index, ev.h2.treeSize, ev.h2.root, ev.p2)) revert BadProof();
        (bytes32 lo, bytes32 hi) = _order(ev.l1, ev.l2);
        bytes32 key = keyB(ev.h1.epoch, ev.index, lo, hi);
        _record(key, EVIDENCE_B, ev.h1.epoch, seq, payTo, lo, hi);
    }

    /// @notice Credit the epoch bounty to the earliest commit among reveals
    ///         that landed inside the contest window. Anyone may call.
    function finalizeBounty(uint32 epoch) external nonReentrant {
        EpochBounty storage b = _bounties[epoch];
        if (b.firstRevealAt == 0 || b.finalized) revert NoPendingBounty();
        if (block.timestamp < uint256(b.firstRevealAt) + CONTEST_WINDOW) revert ContestOpen();
        b.finalized = true;
        pendingBounties -= 1;
        uint256 reserve = openRequested;
        uint256 amount = 0;
        if (bountiesPaid + BOUNTY <= BOUNTY_CAP && bondAccounted >= reserve + BOUNTY) {
            amount = BOUNTY;
            bountiesPaid += amount;
            bondAccounted -= amount;
            credits[b.bestPayTo] += amount;
        }
        b.paid = amount;
        emit BountyFinalized(epoch, b.bestPayTo, amount);
    }

    // ------------------------------------------------------------------
    // Refunds
    // ------------------------------------------------------------------

    /// @notice Register a refund for a receipt whose leaf is one side of a
    ///         recorded type B key. Pays the payer opened from the binding
    ///         commitment only, so anyone may submit.
    function registerRefund(bytes32 key, ReceiptBinding calldata b, Sig calldata sig, address payer, bytes32 payerSalt)
        external
        nonReentrant
    {
        BKey storage bk = _bKeys[key];
        if (bk.incidentId == 0 || (b.leafHash != bk.lo && b.leafHash != bk.hi)) revert NotAffected();
        if (closed) revert NotActive();
        Incident storage inc = _incidents[bk.incidentId];
        if (inc.settled || block.timestamp > inc.claimsCloseAt) revert ClaimsClosed();
        if (b.kid != KID) revert UnknownKid();
        if (!_p256(bindingDigest(b), sig.r, sig.s, PUB_X, PUB_Y)) revert BadSignature();
        if (payer == address(0) || keccak256(abi.encode(PAYER_TAG, payer, payerSalt)) != b.payerCommitment) {
            revert BadCommitment();
        }
        if (b.assetId != USDC_BASE_ID) revert WrongAsset();
        if (_refunds[b.leafHash].incidentId != 0) revert AlreadyClaimed();
        uint64 amount = b.amountAtomic < REFUND_CAP ? b.amountAtomic : uint64(REFUND_CAP);
        _refunds[b.leafHash] = Refund({payer: payer, amount: amount, paid: false, incidentId: bk.incidentId});
        inc.requested += amount;
        openRequested += amount;
        emit RefundRegistered(b.leafHash, payer, amount, bk.incidentId);
    }

    /// @notice Close an incident after its claim window. Refunds take
    ///         min(requested, bond) and are paid pro rata. Anyone may call.
    function settle(uint256 incidentId) external nonReentrant {
        if (incidentId == 0 || incidentId > incidentCount) revert NothingToSettle();
        Incident storage inc = _incidents[incidentId];
        if (inc.settled) revert NothingToSettle();
        if (block.timestamp <= inc.claimsCloseAt) revert ClaimsOpen();
        _settle(incidentId, inc);
    }

    /// @notice Pay a settled refund to its payer. Anyone may call.
    function claimRefund(bytes32 leafHash) external nonReentrant {
        Refund storage r = _refunds[leafHash];
        if (r.incidentId == 0 || r.paid) revert NothingToClaim();
        Incident storage inc = _incidents[r.incidentId];
        if (!inc.settled) revert NotSettled();
        r.paid = true;
        uint256 pay = inc.requested == 0 ? 0 : (uint256(r.amount) * inc.pool) / inc.requested;
        if (pay != 0) TOKEN.safeTransfer(r.payer, pay);
        emit RefundPaid(leafHash, r.payer, pay);
    }

    /// @notice Pull credited bounties to the caller.
    function claim() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NothingToClaim();
        credits[msg.sender] = 0;
        TOKEN.safeTransfer(msg.sender, amount);
        emit CreditClaimed(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Views and helpers
    // ------------------------------------------------------------------

    function withdrawableAt() public view returns (uint256) {
        return noticeAt == 0 ? type(uint256).max : uint256(noticeAt) + NOTICE_PERIOD;
    }

    function revealGraceEnd() public view returns (uint256) {
        return noticeAt == 0 ? type(uint256).max : uint256(noticeAt) + NOTICE_PERIOD + MIN_DELAY + REVEAL_WINDOW;
    }

    function frozen() external view returns (bool) {
        return _frozen();
    }


    function incident(uint256 id) external view returns (Incident memory) {
        return _incidents[id];
    }

    function bounty(uint32 epoch) external view returns (EpochBounty memory) {
        return _bounties[epoch];
    }

    function bKey(bytes32 key) external view returns (BKey memory) {
        return _bKeys[key];
    }

    function refundOf(bytes32 leafHash) external view returns (Refund memory) {
        return _refunds[leafHash];
    }

    function openCommitSlots(address who) external view returns (bytes32[MAX_OPEN_COMMITS] memory) {
        return _commitSlots[who];
    }

    function commitHash(address submitter, address payTo, uint8 evidenceType, bytes32 evidenceHash, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(COMMIT_TAG, block.chainid, address(this), submitter, payTo, evidenceType, evidenceHash, salt)
        );
    }

    function evidenceHashA(TreeHead calldata h1, Sig calldata s1, TreeHead calldata h2, Sig calldata s2)
        public
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(h1, s1, h2, s2, uint64(0), bytes32(0), bytes32(0), new bytes32[](0), new bytes32[](0))
        );
    }

    function evidenceHashB(EvidenceB calldata ev) public pure returns (bytes32) {
        return keccak256(abi.encode(ev.h1, ev.s1, ev.h2, ev.s2, ev.index, ev.l1, ev.l2, ev.p1, ev.p2));
    }

    function keyA(uint32 epoch, uint64 treeSize, bytes32 rootLo, bytes32 rootHi) public pure returns (bytes32) {
        return keccak256(abi.encode(bytes1("A"), epoch, treeSize, rootLo, rootHi));
    }

    function keyB(uint32 epoch, uint64 index, bytes32 leafLo, bytes32 leafHi) public pure returns (bytes32) {
        return keccak256(abi.encode(bytes1("B"), epoch, index, leafLo, leafHi));
    }

    /// @notice e = SHA-256(0x1901 || treeHeadDomainSeparator || structHash), the value P-256 signs.
    function treeHeadDigest(TreeHead memory h) public view returns (bytes32) {
        return sha256(abi.encodePacked(hex"1901", TREEHEAD_DOMAIN_SEPARATOR, _treeHeadStructHash(h)));
    }

    /// @notice e = SHA-256(0x1901 || bindingDomainSeparator || structHash).
    function bindingDigest(ReceiptBinding memory b) public view returns (bytes32) {
        return sha256(
            abi.encodePacked(
                hex"1901",
                BINDING_DOMAIN_SEPARATOR,
                keccak256(abi.encode(BINDING_TYPEHASH, b.leafHash, b.payerCommitment, b.amountAtomic, b.assetId, b.kid))
            )
        );
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _treeHeadStructHash(TreeHead memory h) internal pure returns (bytes32) {
        return keccak256(abi.encode(TREEHEAD_TYPEHASH, h.epoch, h.treeSize, h.root, h.publishedAt, h.kid));
    }

    function _headRefKey(uint32 epoch, uint64 treeSize, bytes32 root) internal pure returns (bytes32) {
        return keccak256(abi.encode(epoch, treeSize, root));
    }

    function _expired(Commit storage c) internal view returns (bool) {
        return block.timestamp > uint256(c.at) + MIN_DELAY + REVEAL_WINDOW;
    }

    /// @dev At most one incident is open at a time and each freeze is charged
    ///      up front, so the total frozen time never exceeds FREEZE_CAP.
    function _frozen() internal view returns (bool) {
        return block.timestamp < freezeUntil;
    }

    /// @notice Incident identity: the conflicting epoch plus the issuer kid.
    ///         Both heads of any type A or B evidence share one epoch, and the
    ///         kid is pinned, so every key from one fork maps to one incident.
    function incidentKey(uint32 epoch) public view returns (bytes32) {
        return keccak256(abi.encode(epoch, KID));
    }

    function _order(bytes32 a, bytes32 b) internal pure returns (bytes32, bytes32) {
        return a < b ? (a, b) : (b, a);
    }

    function _consumeCommit(address payTo, uint8 evidenceType, bytes32 evidenceHash, bytes32 salt)
        internal
        returns (uint48 seq)
    {
        if (activatedAt == 0 || closed) revert NotActive();
        bytes32 c = commitHash(msg.sender, payTo, evidenceType, evidenceHash, salt);
        Commit memory cm = commits[c];
        if (cm.committer == address(0) || cm.committer != msg.sender) revert NoCommit();
        if (block.timestamp < uint256(cm.at) + MIN_DELAY) revert CommitTooYoung();
        if (block.timestamp > uint256(cm.at) + MIN_DELAY + REVEAL_WINDOW) revert CommitExpired();
        if (payTo == address(0)) revert ZeroPayTo();
        delete commits[c];
        return cm.seq;
    }

    function _checkHead(TreeHead calldata h, Sig calldata s) internal view {
        if (h.kid != KID) revert UnknownKid();
        if (!_p256(treeHeadDigest(h), s.r, s.s, PUB_X, PUB_Y)) revert BadSignature();
        if (quarantined[_headRefKey(h.epoch, h.treeSize, h.root)]) revert Excluded();
    }

    function _record(bytes32 key, uint8 evidenceType, uint32 epoch, uint48 seq, address payTo, bytes32 lo, bytes32 hi)
        internal
    {
        if (evidenceIncident[key] != 0) revert DuplicateEvidence();

        bytes32 ik = incidentKey(epoch);
        uint256 incidentId = incidentOf[ik];
        if (incidentId == 0) {
            // One open incident at a time: a different epoch waits until the
            // open one is settled (anyone may settle after its window).
            if (openIncidents != 0) revert AnotherIncidentOpen();
            incidentId = ++incidentCount;
            incidentOf[ik] = incidentId;
            openIncidents = 1;
            uint64 closeAt = uint64(block.timestamp + CLAIM_WINDOW);
            uint256 room = FREEZE_CAP - frozenUsed;
            uint256 d = room < CLAIM_WINDOW ? room : CLAIM_WINDOW;
            uint64 until = 0;
            if (d != 0) {
                until = uint64(block.timestamp + d);
                freezeUntil = until;
                frozenUsed += uint32(d);
            }
            _incidents[incidentId] = Incident({
                epoch: epoch,
                openedAt: uint64(block.timestamp),
                claimsCloseAt: closeAt,
                freezeUntil: until,
                settled: false,
                requested: 0,
                pool: 0
            });
            emit IncidentOpened(incidentId, epoch, closeAt, until);
        } else {
            // Same fork. Join only while its claim window is open; after
            // that the epoch is closed for good (no re-open, no new freeze).
            Incident storage cur = _incidents[incidentId];
            if (cur.settled || block.timestamp > cur.claimsCloseAt) revert IncidentClosed();
        }
        evidenceIncident[key] = incidentId;
        if (evidenceType == EVIDENCE_B) {
            _bKeys[key] = BKey({lo: lo, hi: hi, incidentId: incidentId});
        }

        EpochBounty storage b = _bounties[epoch];
        if (!b.finalized) {
            if (b.firstRevealAt == 0) {
                b.firstRevealAt = uint64(block.timestamp);
                b.bestSeq = seq;
                b.bestPayTo = payTo;
                pendingBounties += 1;
            } else if (block.timestamp < uint256(b.firstRevealAt) + CONTEST_WINDOW && seq < b.bestSeq) {
                b.bestSeq = seq;
                b.bestPayTo = payTo;
            }
        }
        emit EvidenceRecorded(key, evidenceType, epoch, seq, payTo, incidentId);
    }

    function _settle(uint256 incidentId, Incident storage inc) internal {
        uint256 pool = inc.requested < bondAccounted ? inc.requested : bondAccounted;
        inc.pool = pool;
        inc.settled = true;
        bondAccounted -= pool;
        openIncidents -= 1;
        openRequested -= inc.requested;
        emit IncidentSettled(incidentId, inc.requested, pool);
    }

    /// @dev Strict 0x100 check: the call must succeed AND return exactly 32
    ///      bytes AND the word must be 1. After Azul the precompile returns
    ///      empty output on failure instead of reverting, so a success flag
    ///      alone would accept anything.
    function _p256(bytes32 e, bytes32 r, bytes32 s, bytes32 x, bytes32 y) internal view returns (bool ok) {
        address verifier = P256_VERIFIER;
        assembly ("memory-safe") {
            let p := mload(0x40)
            mstore(p, e)
            mstore(add(p, 0x20), r)
            mstore(add(p, 0x40), s)
            mstore(add(p, 0x60), x)
            mstore(add(p, 0x80), y)
            mstore(0x00, 0)
            let success := staticcall(gas(), verifier, p, 0xa0, 0x00, 0x20)
            ok := and(success, and(eq(returndatasize(), 0x20), eq(mload(0x00), 1)))
        }
    }
}

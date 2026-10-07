// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Hash preimages for ChitIssuerRoot. One copy, used by the contract
///         and by tests. Field names match docs/product/issuer-root.md.
library ChitIssuerDigests {
    bytes32 internal constant GENESIS_DOMAIN = keccak256("chit.issuerRoot.genesis.v1");
    bytes32 internal constant COMMIT_DOMAIN = keccak256("chit.issuerRoot.commit.v1");
    bytes32 internal constant WITNESS_POP_DOMAIN = keccak256("chit.issuerRoot.witnessPop.v1");
    bytes32 internal constant RECOVER_AUTH_DOMAIN = keccak256("chit.issuerRoot.recoverAuth.v1");
    bytes32 internal constant RECOVER_ROOT_DOMAIN = keccak256("chit.issuerRoot.recoverRoot.v1");
    bytes32 internal constant GUARDIAN_AUTH_DOMAIN = keccak256("chit.issuerRoot.guardianAuth.v1");
    bytes32 internal constant GUARDIAN_ROOT_DOMAIN = keccak256("chit.issuerRoot.guardianRoot.v1");

    function guardianSetHash(address[] memory set, uint64 threshold) public pure returns (bytes32) {
        return keccak256(abi.encode(set, threshold));
    }

    /// @dev Signed by each guardian before they are seated. The registry
    ///      address is not included: it does not exist until the constructor
    ///      runs. `witnessSalt` plus chain id, controller, and genesis kid
    ///      bind the proof. Recovery and rotation digests bind `address(this)`.
    struct PopStatic {
        uint256 chainId;
        bytes32 witnessSalt;
        address controller;
        bytes32 genesisKid;
        uint64 genesisNotBefore;
        uint64 activatedAt;
        uint64 guardianThreshold;
    }

    function witnessPopDigest(PopStatic memory p, address[] memory set) public pure returns (bytes32) {
        return keccak256(abi.encode(WITNESS_POP_DOMAIN, p, set));
    }

    /// @dev Proof of possession after the registry exists (guardian rotation).
    function seatedPopDigest(
        uint256 chainId,
        address registry,
        uint64 nextGuardianSeq,
        uint64 guardianThreshold,
        address[] memory set
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(WITNESS_POP_DOMAIN, chainId, registry, nextGuardianSeq, guardianThreshold, set));
    }

    function recoverAuthDigest(
        uint256 chainId,
        address registry,
        uint64 guardianSeq,
        bytes32 kid,
        bool invalidatePrior
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(RECOVER_AUTH_DOMAIN, chainId, registry, guardianSeq, kid, invalidatePrior));
    }

    struct RotateAuth {
        uint256 chainId;
        address registry;
        uint64 guardianSeq;
        uint64 nextGuardianSeq;
        uint64 newThreshold;
    }

    function rotateAuthDigest(RotateAuth memory p, address[] memory newSet) public pure returns (bytes32) {
        return keccak256(abi.encode(GUARDIAN_AUTH_DOMAIN, p, newSet));
    }

    struct CommitStatic {
        bytes32 prevRootHash;
        uint64 seq;
        uint256 chainId;
        address registry;
        uint64 blockNumber;
        uint64 historyVersion;
        bytes32 historySnapshot;
        uint64 guardianSeq;
        bytes32 guardianSetHash;
        bytes32 opsHash;
        bytes32 freezeHash;
    }

    struct GenesisStatic {
        uint256 chainId;
        address registry;
        address controller;
        bytes32 genesisKid;
        uint64 genesisNotBefore;
        uint64 activatedAt;
        uint64 blockNumber;
        bytes32 witnessSalt;
        uint64 guardianSeq;
        uint64 guardianThreshold;
        uint64 historyVersion;
        bytes32 historySnapshot;
    }

    function genesisRootHash(GenesisStatic memory p, address[] memory set) public pure returns (bytes32) {
        return keccak256(abi.encode(GENESIS_DOMAIN, p, set));
    }

    struct RecoverStatic {
        bytes32 prevRootHash;
        uint64 seq;
        uint256 chainId;
        address registry;
        uint64 blockNumber;
        uint64 historyVersion;
        bytes32 historySnapshot;
        uint64 guardianSeq;
        bytes32 kid;
        uint64 retiredAt;
        uint64 retirementBlock;
        bool invalidatePrior;
    }

    function recoverRootHash(RecoverStatic memory p) public pure returns (bytes32) {
        return keccak256(abi.encode(RECOVER_ROOT_DOMAIN, p));
    }

    struct GuardianStatic {
        bytes32 prevRootHash;
        uint64 seq;
        uint256 chainId;
        address registry;
        uint64 blockNumber;
        uint64 historyVersion;
        bytes32 historySnapshot;
        uint64 guardianSeq;
        uint64 guardianThreshold;
    }

    function guardianRootHash(GuardianStatic memory p, address[] memory set) public pure returns (bytes32) {
        return keccak256(abi.encode(GUARDIAN_ROOT_DOMAIN, p, set));
    }
}

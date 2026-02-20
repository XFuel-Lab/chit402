// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Barrel file: imports core-layer and circuit contracts so Hardhat discovers
// them via the standard `contracts/` sources path.  This file generates no
// additional bytecode — it just ensures artifacts are produced.

import "../core-layer/contracts/CoreRevenueSplitter.sol";
import "../core-layer/contracts/ZKVerifierSP1.sol";
import "../core-layer/contracts/SP1ProofHooks.sol";
import "../core-layer/contracts/veXFGovernance.sol";
import "../circuits/tao-evm/TAOCircuit.sol";
import "../circuits/a2a/A2ACircuit.sol";
import "../circuits/theta-gpu/ThetaGPUCircuit.sol";
import "../circuits/zkml/ZKMLCircuit.sol";
import "../circuits/akash/AkashCircuit.sol";
import "../circuits/autonomous-vaults/AutonomousVaults.sol";
import "../circuits/agent-robotics/AgentRobotics.sol";
import "../circuits/data-hubs/DataHubs.sol";
import "../circuits/yield-optimization/YieldCircuit.sol";
import "../circuits/near-agents/NearAgents.sol";
import "../circuits/solana-ai-bridge/SolanaAIBridge.sol";
import "../circuits/filecoin-storage/FilecoinStorage.sol";
import "../circuits/energy-grid/EnergyGrid.sol";
import "../circuits/mapping-sensor/MappingSensor.sol";
import "../circuits/wireless-depin/WirelessDePIN.sol";
import "../circuits/uplink/UplinkCircuit.sol";
import "../believer/BelieverRound.sol";

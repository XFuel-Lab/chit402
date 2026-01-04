import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import snarkjs from 'snarkjs';
import config from './config.js';
import logger from './logger.js';

/**
 * ZK Proof Generator for Theta deposits
 * Generates proofs of transaction inclusion and deposit details
 */
class ZKProver {
  constructor() {
    this.circuitWasm = null;
    this.circuitZkey = null;
    this.verificationKey = null;
    this.initialized = false;
  }

  /**
   * Initialize the ZK prover with circuit files
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) {
      return;
    }

    try {
      // Check if circuit files exist
      if (!existsSync(config.zk.circuitWasm)) {
        logger.warn({ path: config.zk.circuitWasm }, 'Circuit WASM not found - ZK proofs will be mocked');
        this.initialized = 'mock';
        return;
      }

      if (!existsSync(config.zk.circuitZkey)) {
        logger.warn({ path: config.zk.circuitZkey }, 'Circuit ZKEY not found - ZK proofs will be mocked');
        this.initialized = 'mock';
        return;
      }

      // Load verification key
      if (existsSync(config.zk.verificationKey)) {
        const vkeyData = await readFile(config.zk.verificationKey, 'utf8');
        this.verificationKey = JSON.parse(vkeyData);
      }

      this.circuitWasm = config.zk.circuitWasm;
      this.circuitZkey = config.zk.circuitZkey;
      this.initialized = true;

      logger.info('ZK prover initialized successfully');
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize ZK prover, using mock mode');
      this.initialized = 'mock';
    }
  }

  /**
   * Generate ZK proof for a deposit
   * @param {Object} depositData - Deposit event data
   * @param {Object} blockData - Block data for proof
   * @param {Object} txData - Transaction data
   * @returns {Promise<Object>} Proof object with proof and public signals
   */
  async generateProof(depositData, blockData, txData) {
    if (!this.initialized) {
      await this.init();
    }

    // If in mock mode, generate a mock proof
    if (this.initialized === 'mock') {
      return this.generateMockProof(depositData, blockData, txData);
    }

    try {
      // Prepare circuit inputs
      const inputs = this.prepareCircuitInputs(depositData, blockData, txData);

      logger.info({ vault: depositData.vault }, 'Generating ZK proof');

      // Generate proof using snarkjs
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        inputs,
        this.circuitWasm,
        this.circuitZkey
      );

      // Verify proof locally before submitting
      if (this.verificationKey) {
        const isValid = await snarkjs.groth16.verify(
          this.verificationKey,
          publicSignals,
          proof
        );

        if (!isValid) {
          throw new Error('Generated proof is invalid');
        }

        logger.info({ vault: depositData.vault }, 'Proof verified locally');
      }

      // Package proof for on-chain verification
      const solidityProof = this.formatProofForSolidity(proof, publicSignals);

      return {
        proof: solidityProof,
        publicSignals,
        inputs,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error({ err: error, vault: depositData.vault }, 'Failed to generate ZK proof');
      throw error;
    }
  }

  /**
   * Prepare inputs for the ZK circuit
   * @param {Object} depositData - Deposit event data
   * @param {Object} blockData - Block data
   * @param {Object} txData - Transaction data
   * @returns {Object} Circuit inputs
   */
  prepareCircuitInputs(depositData, blockData, txData) {
    // Convert addresses to field elements (remove 0x and convert to BigInt)
    const vaultAddress = BigInt(depositData.vault);
    const senderAddress = BigInt(depositData.sender);

    // Block information
    const blockNumber = BigInt(blockData.number);
    const blockHash = BigInt(blockData.hash);
    const blockTimestamp = BigInt(blockData.timestamp);

    // Transaction information
    const txHash = BigInt(txData.hash);
    const txIndex = BigInt(txData.index || 0);

    // Amounts (already in wei)
    const grossAmount = BigInt(depositData.grossAmount.toString());
    const feeAmount = BigInt(depositData.feeAmount.toString());
    const netAmount = BigInt(depositData.netAmount.toString());

    return {
      // Public inputs (will be verified on-chain)
      vaultAddress: vaultAddress.toString(),
      netAmount: netAmount.toString(),
      blockNumber: blockNumber.toString(),
      
      // Private inputs (proven but not revealed)
      senderAddress: senderAddress.toString(),
      grossAmount: grossAmount.toString(),
      feeAmount: feeAmount.toString(),
      blockHash: blockHash.toString(),
      blockTimestamp: blockTimestamp.toString(),
      txHash: txHash.toString(),
      txIndex: txIndex.toString()
    };
  }

  /**
   * Format proof for Solidity verification
   * @param {Object} proof - Raw proof from snarkjs
   * @param {Array} publicSignals - Public signals
   * @returns {Object} Formatted proof
   */
  formatProofForSolidity(proof, publicSignals) {
    return {
      a: [proof.pi_a[0], proof.pi_a[1]],
      b: [
        [proof.pi_b[0][1], proof.pi_b[0][0]],
        [proof.pi_b[1][1], proof.pi_b[1][0]]
      ],
      c: [proof.pi_c[0], proof.pi_c[1]],
      input: publicSignals
    };
  }

  /**
   * Generate mock proof for development/testing
   * @param {Object} depositData - Deposit event data
   * @param {Object} blockData - Block data
   * @param {Object} txData - Transaction data
   * @returns {Object} Mock proof object
   */
  generateMockProof(depositData, blockData, txData) {
    logger.warn({ vault: depositData.vault }, 'Generating MOCK proof - not for production use');

    const mockProof = {
      proof: {
        a: ['0x' + '1'.repeat(64), '0x' + '2'.repeat(64)],
        b: [
          ['0x' + '3'.repeat(64), '0x' + '4'.repeat(64)],
          ['0x' + '5'.repeat(64), '0x' + '6'.repeat(64)]
        ],
        c: ['0x' + '7'.repeat(64), '0x' + '8'.repeat(64)],
        input: [
          depositData.vault,
          depositData.netAmount.toString(),
          blockData.number.toString()
        ]
      },
      publicSignals: [
        depositData.vault,
        depositData.netAmount.toString(),
        blockData.number.toString()
      ],
      inputs: this.prepareCircuitInputs(depositData, blockData, txData),
      timestamp: Date.now(),
      mock: true
    };

    return mockProof;
  }

  /**
   * Verify a proof (for testing)
   * @param {Object} proof - Proof to verify
   * @param {Array} publicSignals - Public signals
   * @returns {Promise<boolean>}
   */
  async verifyProof(proof, publicSignals) {
    if (!this.verificationKey) {
      logger.warn('Verification key not loaded, skipping verification');
      return true;
    }

    try {
      const isValid = await snarkjs.groth16.verify(
        this.verificationKey,
        publicSignals,
        proof
      );
      return isValid;
    } catch (error) {
      logger.error({ err: error }, 'Proof verification failed');
      return false;
    }
  }

  /**
   * Generate proof hash for storage
   * @param {Object} proofData - Complete proof data
   * @returns {string} Hash of the proof
   */
  generateProofHash(proofData) {
    const proofString = JSON.stringify(proofData.proof);
    const crypto = require('crypto');
    return '0x' + crypto.createHash('sha256').update(proofString).digest('hex');
  }
}

// Create singleton instance
let zkProver = null;

/**
 * Initialize the ZK prover
 * @returns {Promise<ZKProver>}
 */
export async function initProver() {
  if (!zkProver) {
    zkProver = new ZKProver();
    await zkProver.init();
  }
  return zkProver;
}

/**
 * Get the ZK prover instance
 * @returns {ZKProver}
 */
export function getProver() {
  if (!zkProver) {
    throw new Error('Prover not initialized. Call initProver() first.');
  }
  return zkProver;
}

export default ZKProver;


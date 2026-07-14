/**
 * zkGPT Prover Client (Phase 1 — ZKG-1)
 *
 * HTTP client for the zkGPT prover service. When a task requests proof_system: 'zkgpt',
 * the backend can call this client instead of the SP1 prover. The zkGPT prover (upstream:
 * github.com/security-Anonymous/zkgpt) must be run separately and expose an HTTP API;
 * set ZKGPT_PROVER_URL to point to it.
 *
 * Reference: eprint.iacr.org/2025/1184; docs/REFERENCES-AND-ATTRIBUTION.md
 */

import axios from 'axios';
import logger from './logger.js';

const DEFAULT_TIMEOUT_MS = 300_000; // 5 min — upstream demo can take 38s+ (range) then GKR; container may OOM

/**
 * @typedef {Object} ZkGPTProofRequest
 * @property {string} [vault_address]
 * @property {string} net_amount
 * @property {number} block_number
 * @property {string} merkle_root
 * @property {string} identity_commitment
 * @property {boolean} [ai_task]
 * @property {string} [task_type]
 * @property {string} [task_id]
 * @property {string} [source_chain]
 * @property {string} [output_hash]
 * @property {string} [proof_system]
 */

/**
 * @typedef {Object} ZkGPTProofResult
 * @property {boolean} success
 * @property {string} proof - Proof bytes (base64 or 0x hex)
 * @property {Object} publicInputs
 * @property {string} nullifier - 0x-prefixed hex
 * @property {number} provingTimeMs
 * @property {number} [totalTimeMs]
 * @property {number} [timestamp]
 */

let _client = null;

class ZkGPTProverClient {
  constructor() {
    const url = process.env.ZKGPT_PROVER_URL || '';
    if (!url || url.trim() === '') {
      throw new Error('ZKGPT_PROVER_URL is required for ZkGPTProverClient');
    }
    this.baseUrl = url.replace(/\/$/, '');
    this.timeout = parseInt(process.env.ZKGPT_PROVER_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10);
    logger.info(
      { baseUrl: this.baseUrl, timeout: this.timeout },
      'ZkGPTProverClient initialized (Phase 1)'
    );
  }

  /**
   * Health check for the zkGPT prover service.
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const resp = await axios.get(`${this.baseUrl}/health`, { timeout: 5000 });
      return resp.status === 200;
    } catch (err) {
      logger.warn({ err: err.message, url: this.baseUrl }, 'zkGPT prover health check failed');
      return false;
    }
  }

  /**
   * Generate a zkGPT proof for an AI task. Request shape is compatible with
   * the payload built in ai-listener _generateTaskProof; the prover service
   * should accept task_id, output_hash, net_amount, merkle_root, etc., and
   * return proof bytes + public values + nullifier.
   *
   * @param {ZkGPTProofRequest} request - Same shape as SP1 proof request (ai_task, task_id, output_hash, ...)
   * @param {boolean} [_urgent] - Ignored; single proof only
   * @returns {Promise<ZkGPTProofResult>} Result compatible with task.sp1Proof / handler expectations
   */
  async generateProof(request, _urgent = false) {
    const startTime = Date.now();

    const body = {
      task_id: request.task_id,
      net_amount: request.net_amount,
      block_number: request.block_number,
      merkle_root: request.merkle_root,
      identity_commitment: request.identity_commitment,
      output_hash: request.output_hash,
      task_type: request.task_type,
      source_chain: request.source_chain,
    };

    const response = await axios.post(`${this.baseUrl}/prove`, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: this.timeout,
    });

    const elapsed = Date.now() - startTime;
    const data = response.data;

    // Expect service to return { proof, public_inputs, nullifier, proving_time_ms } or similar
    const proof = data.proof ?? data.proof_bytes;
    const publicInputs = data.public_inputs ?? data.publicInputs ?? {
      vault_address: request.vault_address ?? '0x0000000000000000000000000000000000000000',
      net_amount: request.net_amount,
      block_number: request.block_number,
      merkle_root: request.merkle_root,
      identity_commitment: request.identity_commitment,
    };
    const nullifier = data.nullifier ?? ('0x' + (data.nullifier_hex || '0'.repeat(64)));
    const provingTimeMs = data.proving_time_ms ?? data.provingTimeMs ?? elapsed;

    if (proof == null || (typeof proof === 'string' && !proof.replace(/^0x/, '').trim())) {
      throw new Error('zkGPT prover response missing or empty proof');
    }
    const proofStr = typeof proof === 'string' ? proof : Buffer.from(proof).toString('base64');
    if (!proofStr || proofStr.length < 32) {
      throw new Error('zkGPT prover response proof too short to be valid');
    }

    const result = {
      success: true,
      proof: proofStr,
      publicInputs,
      publicValues: publicInputs, // alias for handlers that expect publicValues
      nullifier: nullifier.startsWith('0x') ? nullifier : '0x' + nullifier,
      provingTimeMs,
      totalTimeMs: elapsed,
      timestamp: Date.now(),
    };

    logger.info(
      { taskId: request.task_id, provingTimeMs: result.provingTimeMs, nullifier: result.nullifier?.slice(0, 18) + '...' },
      'zkGPT proof generated'
    );

    return result;
  }
}

/**
 * Get or create the zkGPT prover client. Returns null if ZKGPT_PROVER_URL is not set.
 * @returns {ZkGPTProverClient | null}
 */
export function getZkGPTProver() {
  if (process.env.ZKGPT_PROVER_URL) {
    if (!_client) {
      _client = new ZkGPTProverClient();
    }
    return _client;
  }
  return null;
}

/**
 * Check if zkGPT prover is configured (ZKGPT_PROVER_URL set).
 * @returns {boolean}
 */
export function isZkGPTProverConfigured() {
  return !!(process.env.ZKGPT_PROVER_URL && process.env.ZKGPT_PROVER_URL.trim() !== '');
}

export default ZkGPTProverClient;

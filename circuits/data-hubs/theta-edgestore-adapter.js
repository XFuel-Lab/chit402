/**
 * Theta EdgeStore Adapter
 *
 * Handles all interactions with the Theta EdgeStore off-chain storage layer:
 *   - Wallet-signed auth token generation (24h expiry)
 *   - Data upload: POST https://api.thetaedgestore.com/api/v2/data
 *   - Data retrieval: GET https://data.thetaedgestore.com/api/v2/data/<key>
 *   - On-chain sealing via DataHubs.attachEdgeStoreCid()
 *
 * Auth flow (per Theta EdgeStore docs, Feb 2026):
 *   The auth token is a wallet-signed message:
 *     message = `Theta EdgeStore Call ${timestamp}`
 *     token   = `${timestamp}.${walletAddress}.${eth_sign(message)}`
 *   Token is valid for 24 hours. This adapter caches it and refreshes automatically.
 *
 * Upload response shape:
 *   { key: "0x...", node_id: "...", size: N, timestamp: N }
 *
 * Retrieval URL:
 *   GET https://data.thetaedgestore.com/api/v2/data/<key>
 *
 * Usage:
 *   import { ThetaEdgeStoreAdapter } from './theta-edgestore-adapter.js';
 *
 *   const adapter = new ThetaEdgeStoreAdapter({
 *     walletPrivateKey: process.env.THETA_EDGESTORE_WALLET_KEY,
 *     contract: dataHubsContractInstance,   // optional — for on-chain sealing
 *   });
 *
 *   const { cid, nodeId } = await adapter.upload(dataBuffer, 'my-dataset.json');
 *   // cid = bytes32 content key for on-chain commitment
 */

import { ethers } from 'ethers';

const EDGESTORE_UPLOAD_BASE   = 'https://api.thetaedgestore.com/api/v2/data';
const EDGESTORE_RETRIEVE_BASE = 'https://data.thetaedgestore.com/api/v2/data';
const TOKEN_EXPIRY_MS         = 23 * 60 * 60 * 1000; // refresh 1h before 24h expiry

export class ThetaEdgeStoreAdapter {
  constructor(config = {}) {
    this.walletPrivateKey = config.walletPrivateKey || process.env.THETA_EDGESTORE_WALLET_KEY || '';
    this.uploadBase       = config.uploadBase   || EDGESTORE_UPLOAD_BASE;
    this.retrieveBase     = config.retrieveBase || EDGESTORE_RETRIEVE_BASE;
    this.apiTimeout       = config.apiTimeout   || 60000;

    // Optional ethers.Contract instance for on-chain sealing
    this.contract = config.contract || null;

    // Auth token cache
    this._token     = null;
    this._tokenTime = 0;
    this._wallet    = null;

    // Stats
    this.stats = {
      uploads: 0, uploadFailures: 0, totalBytesUploaded: 0,
      retrievals: 0, retrievalFailures: 0,
      seals: 0, sealFailures: 0,
    };

    this.log = config.logger || console;
  }

  // ─── Auth token ────────────────────────────────────────────────────────────

  _getWallet() {
    if (!this._wallet) {
      if (!this.walletPrivateKey) throw new Error('THETA_EDGESTORE_WALLET_KEY not configured');
      this._wallet = new ethers.Wallet(this.walletPrivateKey);
    }
    return this._wallet;
  }

  /**
   * Generate or return cached auth token.
   * Token format: `${timestamp}.${walletAddress}.${signature}`
   * Message: `Theta EdgeStore Call ${timestamp}`
   */
  async _getAuthToken() {
    const now = Date.now();
    if (this._token && now - this._tokenTime < TOKEN_EXPIRY_MS) {
      return this._token;
    }

    const wallet    = this._getWallet();
    const timestamp = Math.floor(now / 1000).toString();
    const message   = `Theta EdgeStore Call ${timestamp}`;

    // eth_sign (NOT EIP-712 — Theta EdgeStore uses the raw personal_sign prefix)
    const signature = await wallet.signMessage(message);
    this._token     = `${timestamp}.${wallet.address}.${signature}`;
    this._tokenTime = now;

    this.log.info?.(`[EdgeStore] Auth token refreshed | wallet=${wallet.address.slice(0, 12)}...`);
    return this._token;
  }

  // ─── Upload ────────────────────────────────────────────────────────────────

  /**
   * Upload data to Theta EdgeStore.
   * @param {Buffer|Uint8Array|string} data  Raw data or UTF-8 string.
   * @param {string} [filename]             Optional filename for Content-Disposition.
   * @returns {{ cid: string, nodeId: string, sizeBytes: number }}
   *   cid    — bytes32 hex content key for on-chain commitment
   *   nodeId — keccak256 of the EdgeStore node address (for on-chain sealing)
   */
  async upload(data, filename = 'data.bin') {
    const token    = await this._getAuthToken();
    const body     = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const sizeBytes = body.length || body.byteLength || 0;

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), this.apiTimeout);
    const t0         = Date.now();

    this.stats.uploads++;
    this.log.info?.(`[EdgeStore] Uploading ${sizeBytes} bytes | file=${filename}`);

    try {
      const res = await fetch(this.uploadBase, {
        method: 'POST',
        headers: {
          'x-theta-edgestore-auth': token,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const elapsed = Date.now() - t0;

      if (!res.ok) {
        this.stats.uploadFailures++;
        const errBody = await res.text().catch(() => '');
        throw new Error(`EdgeStore upload HTTP ${res.status} after ${elapsed}ms: ${errBody.slice(0, 200)}`);
      }

      const json = await res.json();
      // Response: { key: "0x...", node_id: "...", size: N, timestamp: N }
      const rawKey = json.key || json.content_key || json.cid || '';
      if (!rawKey) throw new Error(`EdgeStore upload succeeded but no key in response: ${JSON.stringify(json)}`);

      // Normalise to bytes32 — pad if key is shorter than 64 hex chars
      const cid    = this._toBytes32(rawKey);
      const nodeId = json.node_id
        ? ethers.keccak256(ethers.toUtf8Bytes(json.node_id))
        : ethers.keccak256(ethers.toUtf8Bytes(`edgestore-node-${rawKey}`));

      this.stats.totalBytesUploaded += sizeBytes;
      this.log.info?.(`[EdgeStore] Upload OK | cid=${cid.slice(0, 18)}... | node=${nodeId.slice(0, 18)}... | ${elapsed}ms`);

      return { cid, nodeId, sizeBytes, rawKey, elapsed };
    } catch (err) {
      clearTimeout(timeout);
      this.stats.uploadFailures++;
      if (err.name === 'AbortError') {
        throw new Error(`EdgeStore upload timed out after ${this.apiTimeout}ms`);
      }
      throw err;
    }
  }

  // ─── Retrieval ─────────────────────────────────────────────────────────────

  /**
   * Retrieve data from Theta EdgeStore by content key.
   * @param {string} cid  bytes32 hex key or raw EdgeStore key string.
   * @returns {Buffer} Raw data bytes.
   */
  async retrieve(cid) {
    const key        = this._fromBytes32(cid);
    const url        = `${this.retrieveBase}/${encodeURIComponent(key)}`;
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), this.apiTimeout);
    const t0         = Date.now();

    this.stats.retrievals++;
    this.log.info?.(`[EdgeStore] Retrieving | key=${key.slice(0, 20)}...`);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'x-theta-edgestore-auth': await this._getAuthToken() },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const elapsed = Date.now() - t0;
      if (!res.ok) {
        this.stats.retrievalFailures++;
        throw new Error(`EdgeStore retrieve HTTP ${res.status} after ${elapsed}ms`);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      this.log.info?.(`[EdgeStore] Retrieved ${buf.length} bytes in ${elapsed}ms`);
      return buf;
    } catch (err) {
      clearTimeout(timeout);
      this.stats.retrievalFailures++;
      if (err.name === 'AbortError') throw new Error(`EdgeStore retrieval timed out after ${this.apiTimeout}ms`);
      throw err;
    }
  }

  // ─── On-chain seal ─────────────────────────────────────────────────────────

  /**
   * Seal a DataHubs contribution on-chain with its EdgeStore CID.
   * Calls DataHubs.attachEdgeStoreCid(contributionId, cid, nodeId).
   * Non-fatal — on-chain failure is logged but does not throw.
   *
   * @param {string} contributionId  bytes32 contribution ID.
   * @param {string} cid             bytes32 EdgeStore content key.
   * @param {string} nodeId          bytes32 EdgeStore node identifier.
   * @param {number} [gasLimit]      Gas limit override (default 150k).
   * @returns {{ txHash: string|null, error: string|null }}
   */
  async sealOnChain(contributionId, cid, nodeId, gasLimit = 150000) {
    if (!this.contract) {
      return { txHash: null, error: 'No contract configured' };
    }

    this.stats.seals++;
    try {
      this.log.info?.(`[EdgeStore] Sealing on-chain | contrib=${contributionId.slice(0, 18)}... | cid=${cid.slice(0, 18)}...`);
      const tx = await this.contract.attachEdgeStoreCid(contributionId, cid, nodeId, { gasLimit });
      const receipt = await tx.wait();
      this.log.info?.(`[EdgeStore] Sealed on-chain | tx=${receipt.hash.slice(0, 18)}... | gas=${receipt.gasUsed}`);
      return { txHash: receipt.hash, error: null };
    } catch (err) {
      this.stats.sealFailures++;
      const msg = err.message?.split('\n')[0]?.slice(0, 120);
      this.log.warn?.(`[EdgeStore] On-chain seal failed (non-fatal): ${msg}`);
      return { txHash: null, error: msg };
    }
  }

  // ─── Combined: upload + seal ───────────────────────────────────────────────

  /**
   * Upload data to EdgeStore then immediately seal the contribution on-chain.
   * This is the primary entry point for the datahubs-handler.js contributeData flow.
   *
   * @param {object} opts
   * @param {Buffer|string}  opts.data           Raw data to upload.
   * @param {string}         opts.filename        Filename for upload (default: data.bin).
   * @param {string}         opts.contributionId  bytes32 contribution ID for sealing.
   * @param {number}         [opts.gasLimit]      Gas limit for seal tx.
   * @returns {{ cid, nodeId, sizeBytes, txHash, sealError }}
   */
  async uploadAndSeal({ data, filename = 'data.bin', contributionId, gasLimit }) {
    const { cid, nodeId, sizeBytes, elapsed } = await this.upload(data, filename);

    let txHash = null, sealError = null;
    if (contributionId) {
      const sealed = await this.sealOnChain(contributionId, cid, nodeId, gasLimit);
      txHash    = sealed.txHash;
      sealError = sealed.error;
    }

    return { cid, nodeId, sizeBytes, uploadMs: elapsed, txHash, sealError };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Convert any hex string to a zero-padded bytes32 hex string. */
  _toBytes32(hex) {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    return '0x' + clean.padStart(64, '0');
  }

  /** Convert a bytes32 hex back to a minimal hex string for URL use. */
  _fromBytes32(hex) {
    const clean = (hex.startsWith('0x') ? hex.slice(2) : hex).replace(/^0+/, '') || '0';
    return clean;
  }

  getStats() {
    return { ...this.stats };
  }
}

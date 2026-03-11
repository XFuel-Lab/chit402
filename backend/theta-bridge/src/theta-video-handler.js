/**
 * Theta Video Handler — Track 3.2 + 3.3
 *
 * Handles all interactions with the Theta Video API:
 *   3.2 — VOD: upload → transcode → ZK provenance on-chain
 *   3.3 — Livestream: create stream → select ingestor → return RTMP details
 *
 * Theta Video API docs:
 *   Auth:  x-tva-sa-id: {sa_id} and x-tva-sa-secret: {sa_secret} headers on every request
 *   Base:  https://api.thetavideoapi.com
 *
 * VOD flow:
 *   1. POST /upload                  → { id, presigned_url }
 *   2. PUT <presigned_url>           → upload raw video bytes
 *   3. POST /video                   → { id } (starts transcoding)
 *   4. GET /video/<id> (poll)        → { state: "success", playback_uri, ... }
 *   5. emit VideoProvenance on-chain via ThetaInferenceCircuit.emitVideoProvenance()
 *
 * Livestream flow:
 *   1. POST /stream                  → { id, stream_server, stream_key }
 *   2. GET /ingestor/filter          → list Edge Ingestors
 *   3. PUT /ingestor/<id>/select     → select nearest (5-min expiry window)
 *   4. Return RTMP details to agent via webhook
 *
 * Usage:
 *   import { ThetaVideoHandler } from './theta-video-handler.js';
 *   const handler = new ThetaVideoHandler({ saId: process.env.THETA_VIDEO_SA_ID, saSecret: process.env.THETA_VIDEO_SA_SECRET });
 *   const { playbackUri, videoId, contentHash } = await handler.uploadAndTranscode(videoBuffer, { filename: 'output.mp4' });
 */

const VIDEO_API_BASE = 'https://api.thetavideoapi.com';
const POLL_INTERVAL_MS = 5000;   // 5s between GET /video/<id> polls
const POLL_MAX_ATTEMPTS = 360;   // 30 minutes max (360 × 5s)

class ThetaVideoHandler {
  constructor(config = {}) {
    this.saId     = config.saId     || process.env.THETA_VIDEO_SA_ID     || '';
    this.saSecret = config.saSecret || process.env.THETA_VIDEO_SA_SECRET || '';
    this.apiBase  = config.apiBase  || VIDEO_API_BASE;
    this.apiTimeout = config.apiTimeout || 30000;

    // Optional on-chain contract for VideoProvenance events
    this.contract  = config.contract || null;
    this.gasLimit  = config.gasLimit || 200000;

    this.stats = {
      uploads: 0, uploadFailures: 0,
      transcodes: 0, transcodeFailures: 0,
      livestreams: 0, livestreamFailures: 0,
      provenanceEmits: 0, provenanceFailures: 0,
    };

    this.log = config.logger || console;
  }

  // ─── Auth headers ──────────────────────────────────────────────────────────
  // Per Theta Video API docs: use x-tva-sa-id and x-tva-sa-secret headers.
  // NOT Authorization: Basic — those are separate named headers.

  _authHeaders() {
    if (!this.saId || !this.saSecret) throw new Error('THETA_VIDEO_SA_ID / THETA_VIDEO_SA_SECRET not configured');
    return {
      'x-tva-sa-id': this.saId,
      'x-tva-sa-secret': this.saSecret,
    };
  }

  async _fetch(path, options = {}) {
    const url = `${this.apiBase}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.apiTimeout);
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...this._authHeaders(),
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error(`Theta Video API timed out: ${path}`);
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  3.2 — VOD: upload + transcode + ZK provenance
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Full VOD pipeline: upload → transcode → poll → provenance.
   * @param {Buffer|Uint8Array} videoBuffer  Raw video bytes.
   * @param {object} opts
   * @param {string}  opts.filename          Video filename (e.g. 'output.mp4').
   * @param {string}  [opts.nftCollection]   TNT-721 collection address for DRM.
   * @param {string}  [opts.intentId]        bytes32 intent ID for on-chain provenance.
   * @returns {{ videoId, playbackUri, contentHash, provenanceTx }}
   */
  async uploadAndTranscode(videoBuffer, { filename = 'video.mp4', nftCollection, intentId } = {}) {
    // Step 1: Get presigned upload URL
    const { uploadId, presignedUrl } = await this._createUpload(filename);

    // Step 2: Upload raw bytes to presigned URL
    await this._putVideo(presignedUrl, videoBuffer, filename);

    // Step 3: Start transcoding job
    const videoId = await this._createVideo(uploadId, filename, nftCollection);

    // Step 4: Poll until complete
    const { playbackUri, state } = await this._pollVideo(videoId);
    if (state !== 'success') throw new Error(`Video transcoding failed: state=${state}`);

    // Content hash for ZK proof (keccak256 of playback URI — proves specific output)
    const { ethers } = await import('ethers');
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(playbackUri));

    // Step 5: Emit VideoProvenance on-chain (non-fatal)
    let provenanceTx = null;
    if (this.contract && intentId) {
      provenanceTx = await this._emitProvenance(intentId, videoId, contentHash, playbackUri);
    }

    this.log.info?.(`[VideoHandler] VOD complete | videoId=${videoId} | playback=${playbackUri.slice(0, 60)}...`);
    return { videoId, playbackUri, contentHash, provenanceTx };
  }

  async _createUpload(filename) {
    this.stats.uploads++;
    this.log.info?.(`[VideoHandler] Creating upload slot | file=${filename}`);

    // POST /upload — no body required per Theta Video API docs
    const res = await this._fetch('/upload', { method: 'POST' });

    if (!res.ok) {
      this.stats.uploadFailures++;
      const body = await res.text().catch(() => '');
      throw new Error(`POST /upload HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    // Response: { status, body: { uploads: [{ id, presigned_url, ... }] } }
    const inner = data.body || data;
    const upload = Array.isArray(inner.uploads) ? inner.uploads[0] : inner;
    const uploadId     = upload.id     || upload.upload_id;
    const presignedUrl = upload.presigned_url || upload.upload_url;
    if (!uploadId || !presignedUrl) throw new Error(`Unexpected /upload response: ${JSON.stringify(data)}`);

    this.log.info?.(`[VideoHandler] Upload slot created | id=${uploadId}`);
    return { uploadId, presignedUrl };
  }

  async _putVideo(presignedUrl, videoBuffer, filename) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min for large files
    this.log.info?.(`[VideoHandler] Uploading ${videoBuffer.length || videoBuffer.byteLength} bytes to presigned URL`);

    try {
      const res = await fetch(presignedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': this._mimeType(filename),
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
        body: videoBuffer,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        this.stats.uploadFailures++;
        throw new Error(`PUT presigned URL HTTP ${res.status}`);
      }
      this.log.info?.(`[VideoHandler] Upload to presigned URL OK`);
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('Video upload timed out (5 min)');
      throw err;
    }
  }

  async _createVideo(uploadId, filename, nftCollection) {
    this.stats.transcodes++;
    const body = {
      source_upload_id: uploadId,
      playback_policy: 'public',
    };
    if (nftCollection) body.nft_collection = nftCollection;

    const res = await this._fetch('/video', { method: 'POST', body: JSON.stringify(body) });

    if (!res.ok) {
      this.stats.transcodeFailures++;
      const errBody = await res.text().catch(() => '');
      throw new Error(`POST /video HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data  = await res.json();
    // Response: { status, body: { videos: [{ id, state, ... }] } }
    const inner = data.body || data;
    const video = Array.isArray(inner.videos) ? inner.videos[0] : inner;
    const videoId = video.id || video.video_id;
    if (!videoId) throw new Error(`Unexpected /video response: ${JSON.stringify(data)}`);

    this.log.info?.(`[VideoHandler] Transcode started | videoId=${videoId}`);
    return videoId;
  }

  /**
   * Poll GET /video/<id> until state === 'success' or 'error'.
   * Typical transcode: 2-10 min. Max wait: 30 min.
   */
  async _pollVideo(videoId) {
    this.log.info?.(`[VideoHandler] Polling transcode status | videoId=${videoId}`);

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      const res = await this._fetch(`/video/${videoId}`);
      if (!res.ok) {
        this.log.warn?.(`[VideoHandler] Poll HTTP ${res.status} on attempt ${attempt + 1}`);
        continue;
      }

      const data  = await res.json();
      // Response: { status, body: { videos: [{ id, state, progress, playback_uri, ... }] } }
      const inner = data.body || data;
      const video = Array.isArray(inner.videos) ? inner.videos[0] : inner;
      const state = video.state || video.status;
      const progress = video.progress ?? null;

      if (progress !== null) {
        this.log.info?.(`[VideoHandler] Transcoding... ${progress}% | attempt=${attempt + 1}`);
      }

      if (state === 'success') {
        const playbackUri = video.playback_uri || video.hls_url || video.playback_url || '';
        this.log.info?.(`[VideoHandler] Transcode complete | state=success | playback=${playbackUri.slice(0, 60)}...`);
        return { state: 'success', playbackUri, inner: video };
      }

      if (state === 'error' || state === 'failed') {
        this.stats.transcodeFailures++;
        return { state, playbackUri: null, inner: video };
      }
    }

    this.stats.transcodeFailures++;
    throw new Error(`Video transcode polling timed out after ${POLL_MAX_ATTEMPTS} attempts (${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS / 60000).toFixed(0)} min)`);
  }

  async _emitProvenance(intentId, videoId, contentHash, playbackUri) {
    if (!this.contract) return null;
    this.stats.provenanceEmits++;

    try {
      const { ethers } = await import('ethers');
      const videoIdBytes = ethers.keccak256(ethers.toUtf8Bytes(videoId));

      const tx = await this.contract.emitVideoProvenance(
        intentId, videoIdBytes, contentHash, playbackUri,
        { gasLimit: this.gasLimit }
      );
      const receipt = await tx.wait();
      this.log.info?.(`[VideoHandler] VideoProvenance emitted | tx=${receipt.hash.slice(0, 18)}...`);
      return receipt.hash;
    } catch (err) {
      this.stats.provenanceFailures++;
      this.log.warn?.(`[VideoHandler] emitVideoProvenance failed (non-fatal): ${err.message?.slice(0, 120)}`);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  3.3 — Livestream
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a livestream session and select the nearest Edge Ingestor.
   * Returns RTMP server + stream key for the broadcasting agent.
   *
   * Notes:
   *   - Max 3 livestreams per service account
   *   - Ingestor selection has a 5-minute expiry window — must start streaming immediately
   */
  async createLivestream({ name = 'XFuel Livestream', ingestorQuery = {} } = {}) {
    this.stats.livestreams++;

    try {
      // Step 1: Create stream — body: { name } only (no playback_policy for streams)
      const streamRes = await this._fetch('/stream', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });

      if (!streamRes.ok) {
        this.stats.livestreamFailures++;
        const body = await streamRes.text().catch(() => '');
        throw new Error(`POST /stream HTTP ${streamRes.status}: ${body.slice(0, 200)}`);
      }

      const streamData  = await streamRes.json();
      const streamInner = streamData.body || streamData;
      const streamId    = streamInner.id;
      const streamKey   = streamInner.stream_key;

      this.log.info?.(`[VideoHandler] Stream created | id=${streamId}`);

      // Step 2: List Edge Ingestors
      const ingestors = await this._listIngestors(ingestorQuery);
      if (!ingestors.length) throw new Error('No Edge Ingestors available');

      // Step 3: Select nearest ingestor (first = highest priority per Theta docs)
      const selected = await this._selectIngestor(ingestors[0].id, streamId);

      this.log.info?.(`[VideoHandler] Livestream ready | streamId=${streamId} | ingestor=${ingestors[0].id}`);
      return {
        streamId,
        streamKey,
        streamServer:    selected.stream_server || ingestors[0].stream_server || '',
        playbackUri:     streamInner.playback_uri || streamInner.hls_url || '',
        ingestorId:      ingestors[0].id,
        ingestorExpiry:  Date.now() + 5 * 60 * 1000, // 5-min ingestor expiry
      };
    } catch (err) {
      this.stats.livestreamFailures++;
      throw err;
    }
  }

  async _listIngestors(query = {}) {
    const params = new URLSearchParams(query).toString();
    const res = await this._fetch(`/ingestor/filter${params ? '?' + params : ''}`);
    if (!res.ok) return [];
    const data  = await res.json();
    const inner = data.body || data;
    return Array.isArray(inner) ? inner : (inner.ingestors || []);
  }

  async _selectIngestor(ingestorId, streamId) {
    // Body must include tva_stream per Theta docs — omitting it causes 403
    const res = await this._fetch(`/ingestor/${ingestorId}/select`, {
      method: 'PUT',
      body: JSON.stringify({ tva_stream: streamId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`PUT /ingestor/${ingestorId}/select HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.body || data;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _mimeType(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    return { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo' }[ext] || 'video/mp4';
  }

  isConfigured() {
    return !!(this.saId && this.saSecret);
  }

  getStats() {
    return { ...this.stats };
  }
}

module.exports = { ThetaVideoHandler, VIDEO_API_BASE };

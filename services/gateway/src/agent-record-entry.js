/**
 * Agent Record entry fingerprint stamped into a new receipt's issuer JWS.
 *
 * `signed: false` means this object is not a second signature. When issuance
 * is asked to bind an entry, the same object is a claim inside the payment
 * JWS, so the fingerprint is covered by `issuer_signature`. Payment
 * payload_version stays 10. A receipt that was not asked omits the claim.
 * An existing JWS is not rewritten to add it.
 *
 * The public foreign-ingest body cannot supply this. The chat door can,
 * because that payment is the caller's. The house stamp script still checks
 * the hash against the public 1F916 record before it signs.
 */
export const AGENT_RECORD_ENTRY_SCHEMA = 'chit402.agent_record_entry.v0';

const FINGERPRINT_ALGS = new Set(['1f916-entry-hash', 'provisional-sha256-jcs']);

function fingerprintText(value) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (value && typeof value === 'object' && value.fingerprint != null) {
    return String(value.fingerprint).trim().toLowerCase();
  }
  return '';
}

/**
 * @param {string|object|null|undefined} input
 * @returns {object|null}
 */
export function agentRecordEntryClaim(input) {
  if (input == null || input === '') return null;
  const source = typeof input === 'string' ? { fingerprint: input } : input;
  if (!source || typeof source !== 'object') return null;
  const fingerprint = fingerprintText(source);
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) return null;
  const fingerprintAlg = source.fingerprint_alg || '1f916-entry-hash';
  if (!FINGERPRINT_ALGS.has(fingerprintAlg)) return null;
  const registry = source.registry || '1f916';
  if (registry !== '1f916') return null;
  return {
    schema: AGENT_RECORD_ENTRY_SCHEMA,
    signed: false,
    registry: '1f916',
    fingerprint,
    fingerprint_alg: fingerprintAlg,
  };
}

/**
 * Header `X-Chit-Agent-Record-Fingerprint`, or body `agent_record_entry`.
 * Absent is not an error. A present value that is not a 64-hex 1F916
 * fingerprint is an error, so issuance does not drop it silently.
 * @param {{ headers?: object, body?: object }} [req]
 */
export function agentRecordEntryFromRequest(req) {
  const headers = req?.headers || {};
  const body = req?.body && typeof req.body === 'object' ? req.body : {};
  const headerRaw = headers['x-chit-agent-record-fingerprint'];
  const bodyRaw = body.agent_record_entry ?? body.xfuel?.agent_record_entry ?? null;
  const headerPresent = headerRaw != null && String(headerRaw).trim() !== '';
  const bodyPresent = bodyRaw != null && bodyRaw !== '';
  if (!headerPresent && !bodyPresent) return { entry: null, error: null };
  const headerFp = headerPresent ? fingerprintText(headerRaw) : null;
  const bodyFp = bodyPresent ? fingerprintText(bodyRaw) : null;
  if (headerFp && bodyFp && headerFp !== bodyFp) {
    return {
      entry: null,
      error: 'agent_record_entry fingerprint on the header and the body disagree',
    };
  }
  const source = bodyPresent && typeof bodyRaw === 'object'
    ? { ...bodyRaw, fingerprint: bodyFp || headerFp }
    : { fingerprint: bodyFp || headerFp };
  const entry = agentRecordEntryClaim(source);
  if (!entry) {
    return {
      entry: null,
      error: 'agent_record_entry fingerprint must be 64 hex characters for registry 1f916',
    };
  }
  return { entry, error: null };
}

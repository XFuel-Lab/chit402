/**
 * Exact bytes of a signed public record, keyed by receipt id.
 * The map is filled only by the signing job. A read never inserts.
 * PUBLIC_RECORD_SERVE defaults off: stored bytes stay unserved until
 * the verifier that understands them is the one operators run.
 */

const records = new Map();

export function publicRecordServeEnabled(env = process.env) {
  return String(env.PUBLIC_RECORD_SERVE || '').trim() === 'true';
}

export function publicRecordJobEnabled(env = process.env) {
  return String(env.PUBLIC_RECORD_JOB || '').trim() === 'true';
}

export function getPublicRecordBytes(receiptId) {
  if (receiptId == null || receiptId === '') return null;
  const hit = records.get(String(receiptId));
  return hit ? Buffer.from(hit) : null;
}

/** First write wins. A later signature is not stored. */
export function putPublicRecordBytes(receiptId, bytes) {
  const key = String(receiptId || '');
  if (!key || records.has(key)) return false;
  records.set(key, Buffer.from(bytes));
  return true;
}

export function publicRecordCount() {
  return records.size;
}

export function resetPublicRecords() {
  records.clear();
}

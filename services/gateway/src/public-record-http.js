/**
 * Read path for a stored public record.
 * This file does not sign, does not import the signer, and does not insert.
 * PUBLIC_RECORD_SERVE defaults off, so a stored record is still a 404.
 * The 404 body is the same for an unknown id, a private id, and a stored
 * record while serving is off.
 */
import { getPublicRecordBytes, publicRecordServeEnabled } from './public-record-store.js';

const NOT_FOUND_BODY = Buffer.from('{"error":"not_found"}');

function sendNotFound(res) {
  res.status(404);
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(NOT_FOUND_BODY);
}

export function handlePublicRecordGet(req, res) {
  const raw = req?.params?.taskId ?? req?.params?.receiptId ?? '';
  const id = String(raw || '').endsWith('.json') ? String(raw).slice(0, -5) : String(raw || '');
  if (!publicRecordServeEnabled() || !id) {
    sendNotFound(res);
    return;
  }
  const bytes = getPublicRecordBytes(id);
  if (!bytes) {
    sendNotFound(res);
    return;
  }
  res.status(200);
  res.set('Cache-Control', 'public, immutable');
  res.set('Content-Type', 'application/jose');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(bytes);
}

export { NOT_FOUND_BODY };

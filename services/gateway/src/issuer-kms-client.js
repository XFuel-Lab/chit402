/**
 * Issuer KMS client. The caller passes a static credential pair.
 * The AWS default provider chain, including IMDS, is not used.
 * defaultsMode is pinned so AWS_DEFAULTS_MODE=auto cannot probe IMDS.
 */
import { KMSClient } from '@aws-sdk/client-kms';

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function trimmed(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

export function createIssuerKmsClient({ region, credentials } = {}) {
  const accessKeyId = trimmed(credentials && credentials.accessKeyId);
  const secretAccessKey = trimmed(credentials && credentials.secretAccessKey);
  if (accessKeyId == null || secretAccessKey == null) {
    throw coded('issuer credentials missing', 'issuer_creds_missing');
  }
  const sessionToken = trimmed(credentials && credentials.sessionToken);
  const explicit = { accessKeyId, secretAccessKey };
  if (sessionToken != null) explicit.sessionToken = sessionToken;
  return new KMSClient({
    region: region || undefined,
    credentials: explicit,
    defaultsMode: 'standard',
    maxAttempts: 2,
  });
}

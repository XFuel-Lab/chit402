/**
 * Issuer KMS client. The caller passes a static credential pair.
 * The AWS default provider chain, including IMDS, is not used.
 */
import { KMSClient } from '@aws-sdk/client-kms';

export function createIssuerKmsClient({ region, credentials } = {}) {
  return new KMSClient({
    region: region || undefined,
    credentials,
  });
}

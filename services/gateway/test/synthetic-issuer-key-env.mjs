// Side-effect import: make the synthetic test key the gateway's active issuer
// key, so receipts signed by it are trusted. Import before any module under
// src/ that reads ISSUER_PRIVATE_KEY.
import { syntheticIssuerKeyEnv } from '../../../packages/verify/test/fixtures/slot-typing/synthetic-key.mjs';

process.env.ISSUER_PRIVATE_KEY = syntheticIssuerKeyEnv();
// The synthetic key is a test key: keep a test run non-production.
process.env.ISSUER_TEST_KEY = process.env.ISSUER_TEST_KEY || '1';

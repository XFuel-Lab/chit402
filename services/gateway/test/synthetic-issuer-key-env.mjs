// Side-effect import: make the synthetic test key the gateway's active issuer
// key, so receipts signed by it are trusted. Import before any module under
// src/ that reads ISSUER_PRIVATE_KEY.
import { syntheticIssuerKeyEnv } from '../../../packages/verify/test/fixtures/slot-typing/synthetic-key.mjs';

process.env.ISSUER_PRIVATE_KEY = syntheticIssuerKeyEnv();

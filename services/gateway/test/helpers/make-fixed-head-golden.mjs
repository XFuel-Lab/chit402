/**
 * Prints the G1 golden JSON for the fixed-head byte-identity test.
 * Run from services/gateway on the base commit (flag unset):
 *   node test/helpers/make-fixed-head-golden.mjs test/fixtures/fixed-head-g1-main.json
 */
import { syntheticIssuerKey, syntheticIssuerKeyEnv } from '../../../../packages/verify/test/fixtures/slot-typing/synthetic-key.mjs';
import fs from 'node:fs';
import { runScenario, stubSigner } from './fixed-head-scenario.mjs';

process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
delete process.env.RECEIPT_FIXED_HEAD_EIP712;
process.env.ISSUER_PRIVATE_KEY = syntheticIssuerKeyEnv();
const key = syntheticIssuerKey();
process.env.ISSUER_KID = key.kid;
const { ReceiptMerkleTree } = await import('../../src/receipt-merkle.js');
const { _setIssuerSignerForTest } = await import('../../src/issuer-signer.js');
_setIssuerSignerForTest(stubSigner({ kid: key.kid, publicJwk: key.publicJwk, privateKey: key.privateKey }));
const { out } = await runScenario({ ReceiptMerkleTree });
const target = process.argv[2];
if (!target) throw new Error('usage: make-fixed-head-golden.mjs <out.json>');
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);

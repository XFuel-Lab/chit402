/**
 * Sign quarantine list v1 with the production issuer key. Host only, run by
 * hand, from services/gateway, in the gateway's own environment. Dry run by
 * default: checks everything, signs nothing, writes nothing.
 *
 *   node scripts/sign-quarantine-list-production.mjs --log-dir "$RECEIPT_LOG_DIR" --list quarantine-list-v1-dryrun.json
 *   node scripts/sign-quarantine-list-production.mjs --log-dir "$RECEIPT_LOG_DIR" --list quarantine-list-v1-dryrun.json \
 *     --list-sha256 <LIST_SHA256 from the dry run> --apply --confirm SIGN-QUARANTINE-LIST-V1-WITH-PRODUCTION-KEY
 *
 * --list is the unsigned document printed by scripts/sign-quarantine-list.mjs
 * (dry run). That script's guard still refuses the production key; this is a
 * separate entry point (src/quarantine-list-production.js). The key is loaded
 * the way the gateway loads it (ISSUER_PRIVATE_KEY or KMS) and is never
 * printed, logged or written. Output: the signed v1 under
 * <log dir>/quarantine-list/v1.json and SIGNED_LIST_SHA256 for
 * pinQuarantineList. RECEIPT_LOG_DIR must be set, as the gateway sees it, and
 * --log-dir must name the same directory (log_dir_env_unset otherwise).
 */
process.env.DOTENV_CONFIG_QUIET = 'true';
const { runProductionListSigner } = await import('../src/quarantine-list-production.js');
const { buildUnsignedV1FromLog } = await import('../src/quarantine-list-from-log.js');
const { initIssuerSigner } = await import('../src/issuer-signer.js');

const result = await runProductionListSigner({
  argv: process.argv.slice(2),
  env: process.env,
  buildFromLog: (logDir) => buildUnsignedV1FromLog(logDir),
  loadSigner: (env) => initIssuerSigner(env),
});
process.exit(result.ok ? 0 : 1);

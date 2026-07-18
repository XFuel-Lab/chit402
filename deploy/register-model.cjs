/**
 * register-model — one command for a provider to commit + register the exact model it serves
 * on the on-chain ModelRegistry (PoMA, Verified Inference Phase 1/2). See docs/POMA_SPEC.md.
 *
 * Computes the KECCAK_MERKLE commitment over the ordered weight shards (identical scheme to
 * services/gateway/src/model-commitment.js and contracts/core/ModelRegistry.sol — parity-tested)
 * and calls registerModel(modelId, commitment, scheme=0, arch, quant, metadataURI).
 *
 * Usage (env-driven; hardhat consumes argv):
 *   MODEL_REGISTRY_ADDRESS=0x... \
 *   MODEL_SLUG="llama-3-70b:q4_k_m" MODEL_ARCH=llama-3 MODEL_QUANT=q4_k_m \
 *   MODEL_METADATA_URI="ipfs://manifest" \
 *   MODEL_SHARDS="./m-00001.safetensors,./m-00002.safetensors" \
 *   npx hardhat run deploy/register-model.cjs --network base-sepolia
 *
 * MODEL_SHARDS may be a comma-separated file list OR a directory (its files are used in
 * lexical order — verify the order matches how the model is loaded).
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

const LEAF_PREFIX = '0x00';
const NODE_PREFIX = '0x01';

function shardLeaf(buf) {
  return ethers.keccak256(ethers.concat([LEAF_PREFIX, buf]));
}

function merkleRoot(leaves) {
  if (leaves.length === 0) return ethers.ZeroHash;
  let level = leaves.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(
        i + 1 < level.length ? ethers.keccak256(ethers.concat([NODE_PREFIX, level[i], level[i + 1]])) : level[i],
      );
    }
    level = next;
  }
  return level[0];
}

function resolveShardFiles(spec) {
  if (!spec) throw new Error('MODEL_SHARDS is required (comma-separated files or a directory)');
  if (fs.existsSync(spec) && fs.statSync(spec).isDirectory()) {
    return fs
      .readdirSync(spec)
      .filter((f) => fs.statSync(path.join(spec, f)).isFile())
      .sort()
      .map((f) => path.join(spec, f));
  }
  return spec.split(',').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const registryAddr = process.env.MODEL_REGISTRY_ADDRESS;
  const slug = (process.env.MODEL_SLUG || '').trim().toLowerCase();
  const arch = process.env.MODEL_ARCH || '';
  const quant = process.env.MODEL_QUANT || '';
  const metadataURI = process.env.MODEL_METADATA_URI || '';

  if (!/^0x[0-9a-fA-F]{40}$/.test(registryAddr || '')) {
    throw new Error('MODEL_REGISTRY_ADDRESS must be a deployed ModelRegistry address');
  }
  if (!slug) throw new Error('MODEL_SLUG is required (canonical "<family>:<quant>")');

  const files = resolveShardFiles(process.env.MODEL_SHARDS);
  const [signer] = await ethers.getSigners();
  const chainId = Number(network.config.chainId || 0);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  XFuel — register-model (PoMA)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Network:   ${network.name} (chainId: ${chainId || 'auto'})`);
  console.log(`  Registry:  ${registryAddr}`);
  console.log(`  Signer:    ${signer.address}`);
  console.log(`  Slug:      ${slug}`);
  console.log(`  Shards:    ${files.length}`);
  console.log('───────────────────────────────────────────────────────────');

  const leaves = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    leaves.push(shardLeaf(buf));
    console.log(`  • ${path.basename(f)} (${buf.length} bytes)`);
  }
  const modelId = ethers.keccak256(ethers.toUtf8Bytes(slug));
  const commitment = merkleRoot(leaves);
  console.log(`\n  modelId:    ${modelId}`);
  console.log(`  commitment: ${commitment}`);

  const registry = await ethers.getContractAt('ModelRegistry', registryAddr, signer);
  console.log('\n  Submitting registerModel(...)');
  const tx = await registry.registerModel(modelId, commitment, 0 /* KECCAK_MERKLE */, arch, quant, metadataURI);
  const rcpt = await tx.wait();

  let version = null;
  for (const log of rcpt.logs) {
    try {
      const parsed = registry.interface.parseLog(log);
      if (parsed && parsed.name === 'ModelRegistered') version = parsed.args.version.toString();
    } catch {
      /* not our event */
    }
  }
  console.log(`  ✓ Registered ${slug} as version ${version ?? '(see tx)'} — tx ${rcpt.hash}`);
  console.log('\n  Add to gateway MODEL_COMMITMENTS so receipts carry it:');
  console.log(`    {"${slug}": {"commitment": "${commitment}", "version": ${version ?? 1}}}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

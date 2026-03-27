/**
 * XFuel Protocol — Theta Inference Circuit Deployment Script
 *
 * Deploys ThetaInferenceCircuit and registers default EdgeCloud services.
 *
 * Usage:
 *   npx hardhat run deploy/theta-inference.cjs --network hardhat
 *   npx hardhat run deploy/theta-inference.cjs --network theta-testnet
 *   npx hardhat run deploy/theta-inference.cjs --network theta-mainnet
 *
 * Environment variables (optional):
 *   REVENUE_SPLITTER   — CoreRevenueSplitter address (defaults to deployer)
 *   ZK_VERIFIER        — ZKVerifierSP1 address (defaults to address(0) for mock)
 *   ZK_VERIFIER_ZKGPT  — ZKVerifierZkGPT address (Phase 1); if set, calls setZKVerifierZkGPT after deploy
 */

const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function fetchAwsSecret(arn) {
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const resp = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  return resp.SecretString;
}

async function resolvePrivateKey() {
  // 1. Direct private key (highest priority)
  const rawKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (rawKey && rawKey.length >= 64 && !rawKey.startsWith('arn:')) {
    console.log('  Wallet source: PRIVATE_KEY env var');
    return rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
  }

  // 2. Keystore file + password (plaintext or via AWS Secrets Manager)
  const keystorePath = process.env.DEPLOYER_MAINNET_KEYSTORE_PATH || process.env.DEPLOYER_KEYSTORE_PATH;
  let keystorePassword = process.env.DEPLOYER_KEYSTORE_PASSWORD_PLAINTEXT;

  if (!keystorePassword) {
    const passwordRef = process.env.DEPLOYER_KEYSTORE_PASSWORD;
    if (passwordRef && passwordRef.startsWith('arn:aws:secretsmanager:') &&
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      console.log('  Fetching keystore password from AWS Secrets Manager...');
      try {
        keystorePassword = await fetchAwsSecret(passwordRef);
      } catch (err) {
        console.error(`  AWS fetch failed: ${err.message}`);
      }
    }
  }

  if (keystorePath && keystorePassword && fs.existsSync(keystorePath)) {
    console.log(`  Decrypting keystore: ${path.basename(keystorePath)}`);
    const keystoreJson = fs.readFileSync(keystorePath, 'utf8');
    const wallet = await hre.ethers.Wallet.fromEncryptedJson(keystoreJson, keystorePassword);
    console.log(`  Wallet source: keystore → ${wallet.address}`);
    return wallet.privateKey;
  }

  return null;
}

async function main() {
  // Resolve private key and inject into Hardhat runtime config so
  // getSigners() returns a proper HardhatEthersSigner (Theta RPC compat)
  const pk = await resolvePrivateKey();

  let deployer;
  const isLocal = hre.network.name === 'hardhat' || hre.network.name === 'localhost';

  if (isLocal) {
    deployer = (await hre.ethers.getSigners())[0];
  } else if (pk) {
    hre.network.config.accounts = [pk];
    deployer = (await hre.ethers.getSigners())[0];
  } else {
    throw new Error(
      'No deployer wallet found. Add one of these to .env.local:\n' +
      '  PRIVATE_KEY=0xYourHexPrivateKey\n' +
      '  DEPLOYER_PRIVATE_KEY=0xYourHexPrivateKey\n' +
      'Or ensure DEPLOYER_MAINNET_KEYSTORE_PATH + DEPLOYER_KEYSTORE_PASSWORD + AWS creds are set'
    );
  }

  const network = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  XFuel Protocol — Theta Inference Circuit Deployment');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Network:  ${network} (Chain ID: ${chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance:  ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const manifest = {
    network,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {},
    gasUsed: {},
    services: [],
  };

  const revenueSplitter = process.env.REVENUE_SPLITTER || deployer.address;
  const zkVerifier = process.env.ZK_VERIFIER || hre.ethers.ZeroAddress;

  const isTheta = ['theta-testnet', 'theta-mainnet'].includes(hre.network.name);

  // ─── Deploy ThetaInferenceCircuit ──────────────────────────────────────────
  console.log('[1/3] Deploying ThetaInferenceCircuit...');
  let circuit;
  try {
    const Factory = await hre.ethers.getContractFactory('ThetaInferenceCircuit');
    const overrides = isTheta ? { gasLimit: 6000000 } : {};
    circuit = await Factory.connect(deployer).deploy(deployer.address, revenueSplitter, zkVerifier, overrides);
    await circuit.waitForDeployment();
    const addr = await circuit.getAddress();
    const receipt = await circuit.deploymentTransaction().wait();

    console.log(`  ✓ ThetaInferenceCircuit: ${addr}`);
    console.log(`    Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`    RevenueSplitter: ${revenueSplitter}`);
    console.log(`    ZKVerifier:      ${zkVerifier}`);

    manifest.contracts.ThetaInferenceCircuit = addr;
    manifest.gasUsed.ThetaInferenceCircuit = receipt.gasUsed.toString();
  } catch (err) {
    console.error(`  ✗ Deployment failed: ${err.message}`);
    process.exit(1);
  }

  // Phase 1: Set ZKVerifierZkGPT on ThetaInferenceCircuit if provided
  const zkVerifierZkGPT = process.env.ZK_VERIFIER_ZKGPT || null;
  if (zkVerifierZkGPT) {
    console.log('\n  Setting ZKVerifierZkGPT (Phase 1)...');
    const tx = await circuit.setZKVerifierZkGPT(zkVerifierZkGPT);
    await tx.wait();
    console.log(`  ✓ ThetaInferenceCircuit.setZKVerifierZkGPT(${zkVerifierZkGPT})`);
  }

  // ─── Register Default EdgeCloud Services ───────────────────────────────────
  console.log('\n[2/3] Registering EdgeCloud services...');

  const ServiceType = {
    LLM_INFERENCE: 0,
    IMAGE_GENERATION: 1,
    SPEECH_TO_TEXT: 2,
    VOICE_CLONING: 3,
    RAG_QUERY: 4,
    VIDEO_PROCESSING: 5,
    OBJECT_DETECTION: 6,
  };

  const services = [
    { type: ServiceType.LLM_INFERENCE,    model: 'llama-3.1-70b',       price: '0.01',  latency: 5000  },
    { type: ServiceType.LLM_INFERENCE,    model: 'llama-3.1-405b',      price: '0.05',  latency: 15000 },
    { type: ServiceType.IMAGE_GENERATION, model: 'flux-schnell',        price: '0.05',  latency: 10000 },
    { type: ServiceType.SPEECH_TO_TEXT,   model: 'whisper-large-v3',    price: '0.005', latency: 8000  },
    { type: ServiceType.VOICE_CLONING,    model: 'voice-clone-v1',      price: '0.02',  latency: 12000 },
    { type: ServiceType.RAG_QUERY,        model: 'llama-rag-70b',       price: '0.008', latency: 6000  },
    { type: ServiceType.VIDEO_PROCESSING, model: 'theta-transcode-v2',  price: '0.1',   latency: 60000 },
    { type: ServiceType.OBJECT_DETECTION, model: 'yolov8-xlarge',       price: '0.003', latency: 2000  },
  ];

  const txOpts = isTheta ? { gasLimit: 500000 } : {};

  for (const svc of services) {
    try {
      const tx = await circuit.registerService(
        svc.type, svc.model,
        hre.ethers.parseEther(svc.price),
        svc.latency,
        txOpts
      );
      await tx.wait();
      console.log(`  ✓ ${svc.model} (type=${svc.type}, ${svc.price} TFUEL, ≤${svc.latency}ms)`);
      manifest.services.push({ model: svc.model, type: svc.type, price: svc.price });
    } catch (err) {
      console.error(`  ✗ ${svc.model}: ${err.message}`);
    }
  }

  // ─── Register Preset Hooks ──────────────────────────────────────────────
  console.log('\n[3/3] Registering preset hooks with GPU tiers...');

  manifest.presets = [];

  const GpuTier = { RTX_4090: 0, A100: 1, H100: 2 };

  const presets = [
    { name: 'Quick Llama 3.1',      type: ServiceType.LLM_INFERENCE,    model: 'llama-3.1-8b',      gpu: GpuTier.RTX_4090, prompt: 'Hello, summarize the latest AI research.' },
    { name: 'Need Bigger GPU',      type: ServiceType.LLM_INFERENCE,    model: 'llama-3.1-405b',    gpu: GpuTier.H100,     prompt: 'Analyze this complex dataset and provide insights.' },
    { name: 'Voice Agent',          type: ServiceType.VOICE_CLONING,    model: 'voice-clone-v1',    gpu: GpuTier.A100,     prompt: 'Clone this voice and generate speech.' },
    { name: 'Enterprise RAG',       type: ServiceType.RAG_QUERY,        model: 'llama-rag-70b',     gpu: GpuTier.A100,     prompt: 'Query the knowledge base for compliance info.' },
    { name: 'Quick Image Gen',      type: ServiceType.IMAGE_GENERATION, model: 'flux-schnell',      gpu: GpuTier.RTX_4090, prompt: 'A futuristic city skyline at sunset, cyberpunk style' },
    { name: 'Medical Transcription', type: ServiceType.SPEECH_TO_TEXT,  model: 'whisper-large-v3',  gpu: GpuTier.A100,     prompt: '' },
  ];

  for (const preset of presets) {
    try {
      const tx = await circuit.registerPreset(
        preset.name, preset.type, preset.model, preset.gpu, preset.prompt,
        txOpts
      );
      await tx.wait();
      const gpuName = Object.keys(GpuTier).find(k => GpuTier[k] === preset.gpu);
      console.log(`  ✓ ${preset.name} (${gpuName}, model=${preset.model})`);
      manifest.presets.push({ name: preset.name, gpu: gpuName, model: preset.model });
    } catch (err) {
      console.error(`  ✗ ${preset.name}: ${err.message}`);
    }
  }

  // ─── Save Manifest ─────────────────────────────────────────────────────────
  const manifestPath = path.join(__dirname, '..', `deploy-theta-inference-${network}-${Date.now()}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n✓ Manifest saved: ${manifestPath}`);

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Deployment Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Contract:  ${manifest.contracts.ThetaInferenceCircuit}`);
  console.log(`  Gas:       ${manifest.gasUsed.ThetaInferenceCircuit}`);
  console.log(`  Services:  ${manifest.services.length} registered`);
  console.log(`  Presets:   ${manifest.presets.length} registered`);
  console.log(`  GPU Tiers: RTX-4090 (1x), A100 (2.5x), H100 (5x)`);
  console.log(`  Fee:       0.5% (50 bps)`);
  console.log(`  Circuit:   THETA_INFERENCE_CIRCUIT`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\nNext steps:');
  console.log('  1. Grant RELAYER_ROLE to your off-chain relayer address');
  console.log('  2. Wire theta-inference-handler.js with the deployed address');
  console.log('  3. Register the circuit in CoreListener:');
  console.log(`     listener.registerCircuit('theta-inference', handler, ['theta_mainnet']);`);
  console.log('  4. Submit a preset intent (one-click):');
  console.log(`     circuit.submitPresetIntent(presetId, 2, serviceId, inputHash, { value: parseEther('0.05') })`);
  console.log('  5. Agent API endpoint:');
  console.log(`     POST /theta-ai/agent-intent { "preset": "NEED_BIGGER_GPU", "gpu_tier": "H100" }`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

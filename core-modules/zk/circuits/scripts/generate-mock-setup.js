// Mock Groth16 Setup Generator
// For development/testing when circom is not available
// DO NOT USE IN PRODUCTION

const fs = require('fs');
const path = require('path');

console.log('🔐 Generating Mock Groth16 Setup Files...');
console.log('⚠️  WARNING: These are MOCK files for development only!');
console.log('');

const buildDir = path.join(__dirname, '../build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Mock verification key
const mockVerificationKey = {
  protocol: 'groth16',
  curve: 'bn128',
  nPublic: 5,
  vk_alpha_1: [
    '20491192805390485299153009773594534940189261866228447918068658471970481763042',
    '9383485363053290200918347156157836566562967994039712273449902621266178545958'
  ],
  vk_beta_2: [
    ['6375614351688725206403948262868962793625744043794305715222011528459656738731',
     '4252822878758300859123897981450591353533073413197771768651442665752259397132'],
    ['10505242626370262277552901082094356697409835680220590971873171140371331206856',
     '21847035105528745403288232691147584728191162732299865338377159692350059136679']
  ],
  vk_gamma_2: [
    ['10857046999023057135944570762232829481370756359578518086990519993285655852781',
     '11559732032986387107991004021392285783925812861821192530917403151452391805634'],
    ['8495653923123431417604973247489272438418190587263600148770280649306958101930',
     '4082367875863433681332203403145435568316851327593401208105741076214120093531']
  ],
  vk_delta_2: [
    ['11559732032986387107991004021392285783925812861821192530917403151452391805634',
     '8495653923123431417604973247489272438418190587263600148770280649306958101930'],
    ['4082367875863433681332203403145435568316851327593401208105741076214120093531',
     '10857046999023057135944570762232829481370756359578518086990519993285655852781']
  ],
  vk_alphabeta_12: [],
  IC: [
    ['1', '2'],
    ['3', '4'],
    ['5', '6'],
    ['7', '8'],
    ['9', '10'],
    ['11', '12']
  ]
};

// Write verification key
const vkeyPath = path.join(__dirname, '../verification_key.json');
fs.writeFileSync(vkeyPath, JSON.stringify(mockVerificationKey, null, 2));
console.log('✅ Generated mock verification_key.json');

// Create mock circuit.wasm marker
const wasmPath = path.join(__dirname, '../circuit.wasm');
fs.writeFileSync(wasmPath, '// MOCK WASM - Run setup-groth16.sh to generate real circuit');
console.log('✅ Generated mock circuit.wasm marker');

// Create mock circuit_final.zkey marker
const zkeyPath = path.join(__dirname, '../circuit_final.zkey');
fs.writeFileSync(zkeyPath, '// MOCK ZKEY - Run setup-groth16.sh to generate real proving key');
console.log('✅ Generated mock circuit_final.zkey marker');

// Create build info
const buildInfo = {
  generated: new Date().toISOString(),
  type: 'MOCK',
  warning: 'These are placeholder files. Run setup-groth16.sh to generate real Groth16 setup.',
  circuitVersion: '1.0.0',
  securityFeatures: [
    'Range proofs',
    'Safe arithmetic',
    'Merkle verification',
    'Identity commitments',
    'Nullifier system'
  ],
  nextSteps: [
    'Install circom: npm install -g circom@latest',
    'Install snarkjs: npm install -g snarkjs@latest',
    'Run setup: ./setup-groth16.sh or setup-groth16.bat'
  ]
};

const buildInfoPath = path.join(buildDir, 'build-info.json');
fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2));
console.log('✅ Generated build/build-info.json');

console.log('');
console.log('🎉 Mock files generated successfully!');
console.log('');
console.log('⚠️  IMPORTANT: These are MOCK files for development only.');
console.log('   To generate real Groth16 setup:');
console.log('   1. Install circom: npm install -g circom@latest');
console.log('   2. Install snarkjs: npm install -g snarkjs@latest');
console.log('   3. Run: ./setup-groth16.sh (or setup-groth16.bat on Windows)');
console.log('');


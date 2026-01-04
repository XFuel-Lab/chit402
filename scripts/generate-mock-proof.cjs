const { ethers } = require('ethers');
const fs = require('fs');

/**
 * Generate Mock ZK-SNARK Proof
 * 
 * Simulates proof generation for testing Persistence minter
 * In production, this would use real Circom/SnarkJS
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

// Parse command line arguments
const args = process.argv.slice(2);
const config = {
  thetaTx: null,
  amount: null,
  recipient: null,
  debug: false
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--theta-tx' && args[i + 1]) {
    config.thetaTx = args[i + 1];
    i++;
  } else if (args[i] === '--amount' && args[i + 1]) {
    config.amount = args[i + 1];
    i++;
  } else if (args[i] === '--recipient' && args[i + 1]) {
    config.recipient = args[i + 1];
    i++;
  } else if (args[i] === '--debug') {
    config.debug = true;
  }
}

function printInfo(message) {
  console.log(`ℹ️  ${message}`);
}

function printSuccess(message) {
  console.log(`✅ ${message}`);
}

function printError(message) {
  console.log(`❌ ${message}`);
}

// Convert Ethereum address to uint256 for circuit
function addressToUint256(address) {
  // Remove 0x prefix and convert to BigInt
  const hex = address.slice(2);
  return BigInt('0x' + hex);
}

// Generate mock Groth16 proof
function generateMockGroth16Proof(publicInputs) {
  // In production, this would call snarkjs:
  // snarkjs groth16 prove circuit_final.zkey witness.wtns proof.json public.json
  
  // Mock proof components (Groth16 format)
  const proof = {
    pi_a: [
      ethers.hexlify(ethers.randomBytes(32)),
      ethers.hexlify(ethers.randomBytes(32)),
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    ],
    pi_b: [
      [
        ethers.hexlify(ethers.randomBytes(32)),
        ethers.hexlify(ethers.randomBytes(32))
      ],
      [
        ethers.hexlify(ethers.randomBytes(32)),
        ethers.hexlify(ethers.randomBytes(32))
      ],
      [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      ]
    ],
    pi_c: [
      ethers.hexlify(ethers.randomBytes(32)),
      ethers.hexlify(ethers.randomBytes(32)),
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    ],
    protocol: "groth16",
    curve: "bn128"
  };
  
  return proof;
}

async function main() {
  console.log('');
  console.log('='.repeat(70));
  console.log('🔐 MOCK ZK-SNARK PROOF GENERATOR');
  console.log('='.repeat(70));
  console.log('');
  
  // Validate inputs
  if (!config.thetaTx) {
    printError('Missing --theta-tx parameter');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/generate-mock-proof.cjs \\');
    console.log('    --theta-tx 0x123... \\');
    console.log('    --amount 0.1 \\');
    console.log('    --recipient persistence1...');
    console.log('');
    process.exit(1);
  }
  
  if (!config.amount) {
    printError('Missing --amount parameter');
    process.exit(1);
  }
  
  if (!config.recipient) {
    printError('Missing --recipient parameter');
    process.exit(1);
  }
  
  printInfo(`Theta TX: ${config.thetaTx}`);
  printInfo(`Amount: ${config.amount} TFUEL`);
  printInfo(`Recipient: ${config.recipient}`);
  console.log('');
  
  try {
    // Connect to Theta to get transaction details
    const provider = new ethers.JsonRpcProvider(
      process.env.THETA_RPC_URL || 'https://eth-rpc-api.thetatoken.org/rpc'
    );
    
    printInfo('Fetching transaction details from Theta...');
    const receipt = await provider.getTransactionReceipt(config.thetaTx);
    
    if (!receipt) {
      printError('Transaction not found on Theta');
      process.exit(1);
    }
    
    printSuccess(`Transaction found in block ${receipt.blockNumber}`);
    
    // Extract sender address
    const sender = receipt.from;
    printInfo(`Sender: ${sender}`);
    console.log('');
    
    // Prepare public inputs for circuit
    const amountWei = ethers.parseEther(config.amount);
    const senderUint = addressToUint256(sender);
    
    const publicInputs = [
      amountWei.toString(),
      senderUint.toString()
    ];
    
    printInfo('Public inputs for ZK circuit:');
    printInfo(`  [0] Amount (wei): ${publicInputs[0]}`);
    printInfo(`  [1] Sender (uint): ${publicInputs[1]}`);
    console.log('');
    
    // Generate mock proof
    printInfo('Generating mock Groth16 proof...');
    printInfo('(In production, this would use real Circom/SnarkJS)');
    
    // Simulate computation delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const proof = generateMockGroth16Proof(publicInputs);
    
    printSuccess('Proof generated!');
    console.log('');
    
    // Create nonce from transaction hash
    const nonce = parseInt(config.thetaTx.slice(-8), 16) % 1000000;
    
    // Prepare output
    const output = {
      proof: proof,
      public_inputs: publicInputs,
      nonce: nonce,
      theta_tx_hash: config.thetaTx,
      theta_sender: sender,
      amount_tfuel: config.amount,
      amount_wei: amountWei.toString(),
      recipient: config.recipient,
      timestamp: Date.now(),
      network: 'theta-mainnet',
      chain_id: 361
    };
    
    // Save to file
    const filename = `proof_${nonce}_${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    
    printSuccess(`Proof saved to: ${filename}`);
    console.log('');
    
    // Display proof summary
    console.log('='.repeat(70));
    console.log('📋 PROOF SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log(`Nonce: ${nonce}`);
    console.log(`Theta TX: ${config.thetaTx}`);
    console.log(`Amount: ${config.amount} TFUEL`);
    console.log(`Sender: ${sender}`);
    console.log(`Recipient: ${config.recipient}`);
    console.log('');
    
    if (config.debug) {
      console.log('Proof components:');
      console.log(JSON.stringify(proof, null, 2));
      console.log('');
    }
    
    console.log('Next steps:');
    console.log('  1. Review proof file');
    console.log('  2. Test mint on Persistence:');
    console.log(`     ./scripts/test-persistence-mint.sh ${filename}`);
    console.log('');
    
    // Display CosmWasm execute message format
    console.log('CosmWasm Execute Message:');
    console.log('```json');
    console.log(JSON.stringify({
      verify_and_mint: {
        proof: {
          a: proof.pi_a.slice(0, 2),
          b: proof.pi_b.slice(0, 2),
          c: proof.pi_c.slice(0, 2)
        },
        public_inputs: publicInputs,
        nonce: nonce,
        theta_tx_hash: config.thetaTx,
        recipient: config.recipient
      }
    }, null, 2));
    console.log('```');
    console.log('');
    
  } catch (error) {
    printError(`Failed to generate proof: ${error.message}`);
    console.log('');
    if (config.debug) {
      console.log('Stack trace:');
      console.log(error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { generateMockGroth16Proof, addressToUint256 };


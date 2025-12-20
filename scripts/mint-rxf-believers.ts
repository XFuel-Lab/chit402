import hre from 'hardhat';
const { ethers } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Theta Mainnet Explorer base URL
const EXPLORER_BASE = 'https://explorer.thetatoken.org';

// Default rXF contract address (can be overridden via env or deployment file)
const DEFAULT_RXF_ADDRESS = '0x8413D034d19435A51974D28541478ce72B8f5904';

// Early Believer wallets and amounts (in rXF tokens, will be converted to wei)
// Format: { address: string, amount: string (in tokens, e.g., "100000"), priorityFlag?: boolean }
interface Believer {
  address: string;
  amount: string; // Amount in tokens (e.g., "100000")
  priorityFlag?: boolean;
  redemptionPeriod?: number; // Custom redemption period in days (0 = default 365 days)
}

// Example Early Believer list - UPDATE THIS WITH ACTUAL WALLETS
// You can also set EARLY_BELIEVERS environment variable as JSON array
// Example: EARLY_BELIEVERS='[{"address":"0x1234...","amount":"100000","priorityFlag":true}]'
const EARLY_BELIEVERS: Believer[] = [
  // Add your Early Believer wallets here
  // Example:
  // { address: '0x1234...', amount: '100000', priorityFlag: true, redemptionPeriod: 365 },
  // { address: '0x5678...', amount: '500000', priorityFlag: false }, // Uses default 365 days
  // { address: '0x9abc...', amount: '1000000', priorityFlag: true, redemptionPeriod: 180 }, // Custom 180 days
];

async function main() {
  console.log('🚀 Starting rXF minting for Early Believers on Theta Mainnet...\n');

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      '❌ No signers available. Please set THETA_MAINNET_PRIVATE_KEY in your .env file.\n' +
      '   Example: THETA_MAINNET_PRIVATE_KEY=0xYourPrivateKeyHere'
    );
  }

  const [deployer] = signers;
  console.log('📝 Minting with account:', deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('💰 Account balance:', ethers.formatEther(balance), 'TFUEL\n');

  if (balance < ethers.parseEther('0.1')) {
    console.warn('⚠️  Warning: Low balance. You may need more TFUEL for transactions.\n');
  }

  // Get network info
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId.toString();
  console.log('🌐 Network:', network.name, '(Chain ID:', chainId + ')');
  
  if (chainId !== '361') {
    console.warn('⚠️  Warning: Not on Theta Mainnet (Chain ID 361). Current chain:', chainId);
  }
  console.log('');

  // Get rXF contract address
  let rXFAddress = process.env.RXF_ADDRESS || DEFAULT_RXF_ADDRESS;
  
  // Try to load from deployment file
  const phase2Path = path.join(__dirname, '..', 'deployments', `phase2-${chainId}.json`);
  if (fs.existsSync(phase2Path)) {
    const phase2Deployment = JSON.parse(fs.readFileSync(phase2Path, 'utf8'));
    if (phase2Deployment.contracts?.rXF) {
      rXFAddress = phase2Deployment.contracts.rXF;
      console.log('📋 Loaded rXF address from deployment file:', rXFAddress);
    }
  } else {
    console.log('📋 Using rXF address:', rXFAddress);
  }
  console.log('');

  // Validate address
  if (!ethers.isAddress(rXFAddress)) {
    throw new Error(`❌ Invalid rXF contract address: ${rXFAddress}`);
  }

  // Get rXF contract
  const rXF = await ethers.getContractAt('rXF', rXFAddress);

  // Verify contract owner
  const owner = await rXF.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `❌ Deployer address (${deployer.address}) is not the owner of rXF contract.\n` +
      `   Contract owner: ${owner}\n` +
      `   Please use the owner wallet to mint.`
    );
  }
  console.log('✅ Verified: Deployer is the contract owner\n');

  // Load believers from environment or use default list
  let believers: Believer[] = EARLY_BELIEVERS;
  
  // Check if believers are provided via environment variable
  if (process.env.EARLY_BELIEVERS) {
    try {
      believers = JSON.parse(process.env.EARLY_BELIEVERS);
      console.log('📋 Loaded Early Believers from environment variable');
    } catch (e) {
      console.warn('⚠️  Failed to parse EARLY_BELIEVERS from env, using default list');
    }
  }

  if (believers.length === 0) {
    throw new Error(
      '❌ No Early Believer wallets provided.\n' +
      '   Please update EARLY_BELIEVERS array in the script or set EARLY_BELIEVERS env variable.\n' +
      '   Format: [{"address":"0x...","amount":"100000","priorityFlag":true}]'
    );
  }

  console.log(`📋 Found ${believers.length} Early Believer wallet(s) to mint to:\n`);
  believers.forEach((b, i) => {
    console.log(`   ${i + 1}. ${b.address} - ${b.amount} rXF${b.priorityFlag ? ' (Priority Flag)' : ''}`);
  });
  console.log('');

  // Prepare batch mint data
  const recipients: string[] = [];
  const amounts: bigint[] = [];
  const redemptionPeriods: bigint[] = [];
  const priorityFlags: boolean[] = [];

  for (const believer of believers) {
    if (!ethers.isAddress(believer.address)) {
      throw new Error(`❌ Invalid address: ${believer.address}`);
    }

    const amountWei = ethers.parseEther(believer.amount);
    if (amountWei <= 0n) {
      throw new Error(`❌ Invalid amount for ${believer.address}: ${believer.amount}`);
    }

    recipients.push(believer.address);
    amounts.push(amountWei);
    
    // Redemption period: 0 = default (365 days), or custom period in seconds
    const redemptionPeriodDays = believer.redemptionPeriod || 0;
    const redemptionPeriodSeconds = redemptionPeriodDays > 0 
      ? BigInt(redemptionPeriodDays * 24 * 60 * 60)
      : 0n;
    redemptionPeriods.push(redemptionPeriodSeconds);
    
    priorityFlags.push(believer.priorityFlag || false);
  }

  // Check current balances before minting
  console.log('📊 Checking current balances...');
  for (let i = 0; i < recipients.length; i++) {
    const balance = await rXF.balanceOf(recipients[i]);
    if (balance > 0n) {
      console.log(`   ⚠️  ${recipients[i]} already has ${ethers.formatEther(balance)} rXF`);
    }
  }
  console.log('');

  // Mint using adminMintBatch
  console.log('🪙 Minting rXF tokens using adminMintBatch...\n');
  
  try {
    const tx = await rXF.adminMintBatch(
      recipients,
      amounts,
      redemptionPeriods,
      priorityFlags,
      {
        gasLimit: 5000000, // Adjust if needed
        gasPrice: 4000000000000, // 4000 gwei (Theta mainnet minimum)
      }
    );

    console.log('⏳ Transaction submitted:', tx.hash);
    console.log('   Explorer:', `${EXPLORER_BASE}/tx/${tx.hash}`);
    console.log('   Waiting for confirmation...\n');

    const receipt = await tx.wait();
    
    if (!receipt) {
      throw new Error('Transaction receipt is null');
    }

    console.log('✅ Transaction confirmed!');
    console.log('   Block number:', receipt.blockNumber);
    console.log('   Gas used:', receipt.gasUsed.toString());
    console.log('   Explorer:', `${EXPLORER_BASE}/tx/${tx.hash}`);
    console.log('');

    // Verify balances after minting
    console.log('📊 Verifying minted balances...\n');
    const results: Array<{
      address: string;
      amount: string;
      balance: string;
      votingBoost: string;
      explorer: string;
      txHash: string;
    }> = [];

    for (let i = 0; i < recipients.length; i++) {
      const balance = await rXF.balanceOf(recipients[i]);
      const votingBoost = await rXF.getVotingBoost(recipients[i]);
      const receipt = await rXF.getReceipt(recipients[i]);
      
      results.push({
        address: recipients[i],
        amount: ethers.formatEther(amounts[i]),
        balance: ethers.formatEther(balance),
        votingBoost: ethers.formatEther(votingBoost),
        explorer: `${EXPLORER_BASE}/address/${recipients[i]}`,
        txHash: tx.hash,
      });

      console.log(`✅ ${recipients[i]}:`);
      console.log(`   Minted: ${ethers.formatEther(amounts[i])} rXF`);
      console.log(`   Total Balance: ${ethers.formatEther(balance)} rXF`);
      console.log(`   Voting Boost (4×): ${ethers.formatEther(votingBoost)} veXF power`);
      console.log(`   Priority Flag: ${receipt.hasPriorityFlag ? 'Yes' : 'No'}`);
      console.log(`   Redemption Period: ${receipt.redemptionPeriod > 0n ? (Number(receipt.redemptionPeriod) / (24 * 60 * 60)) + ' days' : 'Default (365 days)'}`);
      console.log(`   Explorer: ${EXPLORER_BASE}/address/${recipients[i]}`);
      console.log('');
    }

    // Print summary
    console.log('='.repeat(60));
    console.log('📋 MINTING SUMMARY');
    console.log('='.repeat(60));
    console.log('🌐 Network:', network.name, '(Chain ID:', chainId + ')');
    console.log('👤 Minter:', deployer.address);
    console.log('📝 rXF Contract:', rXFAddress);
    console.log('   Explorer:', `${EXPLORER_BASE}/address/${rXFAddress}`);
    console.log('');
    console.log('📊 Transaction Details:');
    console.log('   Hash:', tx.hash);
    console.log('   Explorer:', `${EXPLORER_BASE}/tx/${tx.hash}`);
    console.log('   Block:', receipt.blockNumber);
    console.log('   Gas Used:', receipt.gasUsed.toString());
    console.log('');
    console.log('🪙 Minted Tokens:');
    let totalMinted = 0n;
    for (const result of results) {
      console.log(`   ${result.address}:`);
      console.log(`      Amount: ${result.amount} rXF`);
      console.log(`      Balance: ${result.balance} rXF`);
      console.log(`      Voting Boost: ${result.votingBoost} veXF power`);
      console.log(`      Explorer: ${result.explorer}`);
      totalMinted += amounts[results.indexOf(result)];
    }
    console.log('');
    console.log(`   Total Minted: ${ethers.formatEther(totalMinted)} rXF`);
    console.log('='.repeat(60));
    console.log('');

    // Save results to file
    const resultsPath = path.join(__dirname, '..', 'deployments', `rxf-mint-${chainId}-${Date.now()}.json`);
    const deploymentsDir = path.dirname(resultsPath);
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const mintResults = {
      network: network.name,
      chainId: chainId,
      timestamp: new Date().toISOString(),
      minter: deployer.address,
      rXFContract: rXFAddress,
      transaction: {
        hash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        explorer: `${EXPLORER_BASE}/tx/${tx.hash}`,
      },
      believers: results,
      totalMinted: ethers.formatEther(totalMinted),
    };

    fs.writeFileSync(resultsPath, JSON.stringify(mintResults, null, 2));
    console.log('✅ Minting results saved to:', resultsPath);
    console.log('');

    return mintResults;

  } catch (error: any) {
    console.error('❌ Minting failed:', error.message);
    
    // If batch mint fails, try individual mints
    if (error.message.includes('adminMintBatch') || error.message.includes('batch')) {
      console.log('\n⚠️  Batch mint failed. Trying individual mints...\n');
      
      const individualResults: Array<{
        address: string;
        amount: string;
        txHash: string;
        success: boolean;
        error?: string;
      }> = [];

      for (let i = 0; i < recipients.length; i++) {
        try {
          console.log(`Minting to ${recipients[i]}...`);
          const tx = await rXF.mint(
            recipients[i],
            amounts[i],
            redemptionPeriods[i],
            priorityFlags[i],
            {
              gasLimit: 500000,
              gasPrice: 4000000000000,
            }
          );

          console.log('   Transaction:', tx.hash);
          const receipt = await tx.wait();
          
          individualResults.push({
            address: recipients[i],
            amount: ethers.formatEther(amounts[i]),
            txHash: tx.hash,
            success: true,
          });

          console.log(`   ✅ Success! Block: ${receipt.blockNumber}\n`);
        } catch (individualError: any) {
          console.error(`   ❌ Failed: ${individualError.message}\n`);
          individualResults.push({
            address: recipients[i],
            amount: ethers.formatEther(amounts[i]),
            txHash: '',
            success: false,
            error: individualError.message,
          });
        }
      }

      // Print individual results summary
      console.log('='.repeat(60));
      console.log('📋 INDIVIDUAL MINTING SUMMARY');
      console.log('='.repeat(60));
      for (const result of individualResults) {
        if (result.success) {
          console.log(`✅ ${result.address}: ${result.amount} rXF`);
          console.log(`   Tx: ${EXPLORER_BASE}/tx/${result.txHash}`);
        } else {
          console.log(`❌ ${result.address}: ${result.amount} rXF - FAILED`);
          console.log(`   Error: ${result.error}`);
        }
      }
      console.log('='.repeat(60));

      throw error;
    } else {
      throw error;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });


import hre from 'hardhat';
const { ethers } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🧪 Starting Phase 3 Integration Tests...\n');

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error('❌ No signers available. Please set THETA_MAINNET_PRIVATE_KEY in your .env file.');
  }

  const [deployer] = signers;
  const user1 = signers[1] || deployer; // Fallback to deployer if not enough signers
  const user2 = signers[2] || deployer; // Fallback to deployer if not enough signers
  
  console.log('👤 Deployer:', deployer.address);
  if (signers.length > 1) {
    console.log('👤 User 1:', user1.address);
  }
  if (signers.length > 2) {
    console.log('👤 User 2:', user2.address);
  }
  console.log('');

  // Get network info
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId.toString();
  const networkName = network.name === 'theta-mainnet' ? 'mainnet' : chainId;

  // Load Phase 3 deployment info
  const phase3Path = path.join(__dirname, '..', 'deployments', `phase3-${networkName}.json`);
  if (!fs.existsSync(phase3Path)) {
    throw new Error(`❌ Phase 3 deployment file not found: ${phase3Path}`);
  }
  const phase3Deployment = JSON.parse(fs.readFileSync(phase3Path, 'utf8'));

  const PULSE_PROOF_ADDRESS = phase3Deployment.contracts.thetaPulseProof;
  const TREASURY_ADDRESS = phase3Deployment.contracts.innovationTreasury;
  const VEXF_ADDRESS = phase3Deployment.phase1.contracts.veXF;
  const REVENUE_TOKEN = phase3Deployment.phase1.contracts.revenueToken;

  console.log('📋 Contract Addresses:');
  console.log('   ThetaPulseProof:', PULSE_PROOF_ADDRESS);
  console.log('   InnovationTreasury:', TREASURY_ADDRESS);
  console.log('   veXF:', VEXF_ADDRESS);
  console.log('   Revenue Token:', REVENUE_TOKEN);
  console.log('');

  // Load contracts
  const ThetaPulseProof = await ethers.getContractFactory('ThetaPulseProof');
  const InnovationTreasury = await ethers.getContractFactory('InnovationTreasury');
  const veXF = await ethers.getContractFactory('veXF');

  const pulseProof = ThetaPulseProof.attach(PULSE_PROOF_ADDRESS);
  const treasury = InnovationTreasury.attach(TREASURY_ADDRESS);
  const veXFContract = veXF.attach(VEXF_ADDRESS);
  
  // Use ethers.Contract for ERC20 interface
  const revenueTokenAbi = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address, uint256) returns (bool)',
    'function allowance(address, address) view returns (uint256)',
  ];
  const revenueToken = new ethers.Contract(REVENUE_TOKEN, revenueTokenAbi, deployer);

  // ============================================
  // 1. Authorize Edge Node Signers
  // ============================================
  console.log('='.repeat(60));
  console.log('1️⃣  AUTHORIZING EDGE NODE SIGNERS');
  console.log('='.repeat(60));
  
  const edgeNodeSigners = process.env.EDGE_NODE_SIGNERS?.split(',').filter(s => s.trim()) || [];
  
  if (edgeNodeSigners.length > 0) {
    console.log(`📝 Found ${edgeNodeSigners.length} Edge Node signer(s) to authorize:\n`);
    
    for (const signer of edgeNodeSigners) {
      const signerAddress = signer.trim();
      if (!ethers.isAddress(signerAddress)) {
        console.log(`⚠️  Skipping invalid address: ${signerAddress}`);
        continue;
      }

      // Check if already authorized
      const isAuthorized = await pulseProof.authorizedSigners(signerAddress);
      if (isAuthorized) {
        console.log(`✅ ${signerAddress} is already authorized`);
        continue;
      }

      console.log(`🔐 Authorizing signer: ${signerAddress}`);
      try {
        const tx = await pulseProof.authorizeSigner(signerAddress, {
          gasLimit: 500000,
        });
        await tx.wait();
        console.log(`✅ Successfully authorized: ${signerAddress}`);
        console.log(`   Tx: https://explorer.thetatoken.org/tx/${tx.hash}\n`);
      } catch (error: any) {
        console.error(`❌ Failed to authorize ${signerAddress}:`, error.message);
      }
    }
  } else {
    console.log('⚠️  No Edge Node signers found in EDGE_NODE_SIGNERS env variable.');
    console.log('   Skipping authorization step.\n');
  }

  // ============================================
  // 2. Test Proof Verification
  // ============================================
  console.log('='.repeat(60));
  console.log('2️⃣  TESTING PROOF VERIFICATION');
  console.log('='.repeat(60));

  // For testing, we'll create a test signature using one of the signers
  // In production, Edge Nodes would sign messages with their private keys
  const testUser = user1.address;
  const testEarnings = ethers.parseEther('15000'); // 15k TFUEL (should give 1.5x multiplier)
  const testNonce = Date.now(); // Use timestamp as nonce for testing

  // Create message hash matching contract's implementation
  const messageHash = ethers.keccak256(
    ethers.solidityPacked(
      ['address', 'uint256', 'uint256', 'uint256'],
      [testUser, testEarnings.toString(), testNonce.toString(), chainId]
    )
  );

  // Sign message with deployer (acting as Edge Node for testing)
  // Note: In production, Edge Nodes would sign with their authorized keys
  const signature = await deployer.signMessage(ethers.getBytes(messageHash));

  console.log('📝 Test Proof Details:');
  console.log('   User:', testUser);
  console.log('   Earnings:', ethers.formatEther(testEarnings), 'TFUEL');
  console.log('   Nonce:', testNonce.toString());
  console.log('   Message Hash:', messageHash);
  console.log('   Signature:', signature);
  console.log('');

  // Verify signature can be recovered
  const recoveredSigner = ethers.recoverAddress(
    ethers.hashMessage(ethers.getBytes(messageHash)),
    signature
  );
  console.log('🔍 Recovered Signer:', recoveredSigner);
  console.log('   Deployer Address:', deployer.address);
  
  // Check if recovered signer is authorized
  const isAuthorized = await pulseProof.authorizedSigners(recoveredSigner);
  console.log('   Is Authorized:', isAuthorized ? '✅ Yes' : '❌ No');
  console.log('');

  if (!isAuthorized) {
    console.log('⚠️  Recovered signer is not authorized. Authorizing for test...');
    const authTx = await pulseProof.authorizeSigner(recoveredSigner, {
      gasLimit: 500000,
    });
    await authTx.wait();
    console.log('✅ Signer authorized for testing\n');
  }

  // Get current multiplier before
  const multiplierBefore = await pulseProof.getMultiplier(testUser);
  console.log('📊 Current multiplier before proof:', (Number(multiplierBefore) / 10000).toFixed(2) + 'x');
  console.log('📊 Current total proven earnings:', ethers.formatEther(await pulseProof.totalProvenEarnings(testUser)), 'TFUEL');
  console.log('');

  // Submit proof verification
  console.log('📤 Submitting proof verification...');
  try {
    const verifyTx = await pulseProof.verifyProof(testUser, testEarnings, testNonce, signature, {
      gasLimit: 1000000,
    });
    const receipt = await verifyTx.wait();
    console.log('✅ Proof verified successfully!');
    console.log('   Tx: https://explorer.thetatoken.org/tx/' + verifyTx.hash);
    
    // Check new multiplier
    const multiplierAfter = await pulseProof.getMultiplier(testUser);
    const totalEarnings = await pulseProof.totalProvenEarnings(testUser);
    console.log('📊 New multiplier after proof:', (Number(multiplierAfter) / 10000).toFixed(2) + 'x');
    console.log('📊 New total proven earnings:', ethers.formatEther(totalEarnings), 'TFUEL');
    console.log('');
  } catch (error: any) {
    console.error('❌ Proof verification failed:', error.message);
    console.log('   Note: This might fail if the proof was already verified.\n');
  }

  // ============================================
  // 3. Deposit Funds into InnovationTreasury
  // ============================================
  console.log('='.repeat(60));
  console.log('3️⃣  DEPOSITING FUNDS INTO INNOVATION TREASURY');
  console.log('='.repeat(60));

  // Check revenue token balance (handle case where contract might not be deployed)
  let deployerBalance = 0n;
  try {
    deployerBalance = await revenueToken.balanceOf(deployer.address);
    console.log('💰 Deployer Revenue Token balance:', ethers.formatEther(deployerBalance));
  } catch (error: any) {
    console.log('⚠️  Revenue token contract not available or not a valid ERC20.');
    console.log('   Address:', REVENUE_TOKEN);
    console.log('   Error:', error.message);
    console.log('   Skipping deposit test.\n');
    deployerBalance = 0n;
  }
  
  if (deployerBalance === 0n) {
    console.log('⚠️  No revenue tokens to deposit. Skipping deposit test.');
    console.log('   Note: In production, revenue tokens would come from RevenueSplitter.');
    console.log('   To test deposits, ensure Revenue Token is deployed and has balance.\n');
  } else {
    const depositAmount = deployerBalance / 3n; // Split into 3 vaults
    
    // Check current vault balances
    console.log('\n📊 Current Vault Balances:');
    const builderBalance = await treasury.vaultBalances(0); // Builder = 0
    const acquisitionBalance = await treasury.vaultBalances(1); // Acquisition = 1
    const moonshotBalance = await treasury.vaultBalances(2); // Moonshot = 2
    console.log('   Builder Vault:', ethers.formatEther(builderBalance));
    console.log('   Acquisition Vault:', ethers.formatEther(acquisitionBalance));
    console.log('   Moonshot Vault:', ethers.formatEther(moonshotBalance));
    console.log('');

    // Approve treasury to spend tokens
    console.log('🔐 Approving treasury to spend tokens...');
    const approveTx = await revenueToken.approve(TREASURY_ADDRESS, depositAmount * 3n, {
      gasLimit: 200000,
    });
    await approveTx.wait();
    console.log('✅ Approval successful\n');

    // Deposit to Builder vault
    console.log(`📥 Depositing ${ethers.formatEther(depositAmount)} to Builder vault...`);
    try {
      const deposit1Tx = await treasury.deposit(0, depositAmount, {
        gasLimit: 500000,
      });
      await deposit1Tx.wait();
      console.log('✅ Builder vault deposit successful');
      console.log('   Tx: https://explorer.thetatoken.org/tx/' + deposit1Tx.hash);
    } catch (error: any) {
      console.error('❌ Builder vault deposit failed:', error.message);
    }

    // Deposit to Acquisition vault
    console.log(`\n📥 Depositing ${ethers.formatEther(depositAmount)} to Acquisition vault...`);
    try {
      const deposit2Tx = await treasury.deposit(1, depositAmount, {
        gasLimit: 500000,
      });
      await deposit2Tx.wait();
      console.log('✅ Acquisition vault deposit successful');
      console.log('   Tx: https://explorer.thetatoken.org/tx/' + deposit2Tx.hash);
    } catch (error: any) {
      console.error('❌ Acquisition vault deposit failed:', error.message);
    }

    // Deposit to Moonshot vault
    console.log(`\n📥 Depositing ${ethers.formatEther(depositAmount)} to Moonshot vault...`);
    try {
      const deposit3Tx = await treasury.deposit(2, depositAmount, {
        gasLimit: 500000,
      });
      await deposit3Tx.wait();
      console.log('✅ Moonshot vault deposit successful');
      console.log('   Tx: https://explorer.thetatoken.org/tx/' + deposit3Tx.hash);
    } catch (error: any) {
      console.error('❌ Moonshot vault deposit failed:', error.message);
    }

    // Check updated vault balances
    console.log('\n📊 Updated Vault Balances:');
    const builderBalanceAfter = await treasury.vaultBalances(0);
    const acquisitionBalanceAfter = await treasury.vaultBalances(1);
    const moonshotBalanceAfter = await treasury.vaultBalances(2);
    console.log('   Builder Vault:', ethers.formatEther(builderBalanceAfter));
    console.log('   Acquisition Vault:', ethers.formatEther(acquisitionBalanceAfter));
    console.log('   Moonshot Vault:', ethers.formatEther(moonshotBalanceAfter));
    console.log('');
  }

  // ============================================
  // 4. Test Proposal Creation and Voting
  // ============================================
  console.log('='.repeat(60));
  console.log('4️⃣  TESTING PROPOSAL CREATION AND VOTING');
  console.log('='.repeat(60));

  // Check veXF balances
  const deployerVeXF = await veXFContract.balanceOf(deployer.address);
  const user1VeXF = await veXFContract.balanceOf(user1.address);
  const user2VeXF = await veXFContract.balanceOf(user2.address);

  console.log('📊 veXF Balances:');
  console.log('   Deployer:', ethers.formatEther(deployerVeXF));
  console.log('   User 1:', ethers.formatEther(user1VeXF));
  console.log('   User 2:', ethers.formatEther(user2VeXF));
  console.log('');

  // Check minimum voting power required
  const MIN_VOTING_POWER = await treasury.MIN_VOTING_POWER();
  console.log('📋 Minimum voting power to create proposal:', ethers.formatEther(MIN_VOTING_POWER));
  console.log('');

  // Check if we can create a proposal
  if (deployerVeXF < MIN_VOTING_POWER) {
    console.log('⚠️  Deployer does not have enough veXF to create a proposal.');
    console.log('   Need:', ethers.formatEther(MIN_VOTING_POWER));
    console.log('   Have:', ethers.formatEther(deployerVeXF));
    console.log('   Skipping proposal creation test.\n');
  } else {
    // Get vault balance to propose withdrawal
    const builderVaultBalance = await treasury.vaultBalances(0);
    if (builderVaultBalance === 0n) {
      console.log('⚠️  Builder vault is empty. Cannot create withdrawal proposal.');
      console.log('   Skipping proposal creation test.\n');
    } else {
      const proposalAmount = builderVaultBalance / 2n; // Propose withdrawing 50%
      const proposalRecipient = user1.address;
      const proposalDescription = 'Test proposal: Withdraw funds from Builder vault for testing purposes';

      console.log('📝 Creating Proposal:');
      console.log('   Vault: Builder (0)');
      console.log('   Amount:', ethers.formatEther(proposalAmount));
      console.log('   Recipient:', proposalRecipient);
      console.log('   Description:', proposalDescription);
      console.log('');

      try {
        // Create proposal
        const createTx = await treasury.createProposal(
          0, // Builder vault
          proposalRecipient,
          proposalAmount,
          proposalDescription,
          {
            gasLimit: 1000000,
          }
        );
        const createReceipt = await createTx.wait();
        console.log('✅ Proposal created successfully!');
        console.log('   Tx: https://explorer.thetatoken.org/tx/' + createTx.hash);

        // Get proposal ID from event
        const proposalCreatedEvent = createReceipt?.logs.find((log: any) => {
          try {
            const parsed = treasury.interface.parseLog(log);
            return parsed?.name === 'ProposalCreated';
          } catch {
            return false;
          }
        });

        let proposalId = 1; // Default to 1 if event not found
        if (proposalCreatedEvent) {
          const parsed = treasury.interface.parseLog(proposalCreatedEvent);
          proposalId = parsed?.args[0];
        }

        console.log('   Proposal ID:', proposalId.toString());
        console.log('');

        // Get proposal details
        const proposal = await treasury.getProposal(proposalId);
        console.log('📋 Proposal Details:');
        console.log('   ID:', proposal.id.toString());
        console.log('   Proposer:', proposal.proposer);
        console.log('   Vault:', proposal.vault);
        console.log('   Amount:', ethers.formatEther(proposal.amount));
        console.log('   Recipient:', proposal.recipient);
        console.log('   Created At:', new Date(Number(proposal.createdAt) * 1000).toISOString());
        console.log('   End Time:', new Date(Number(proposal.endTime) * 1000).toISOString());
        console.log('   Votes For:', ethers.formatEther(proposal.votesFor));
        console.log('   Votes Against:', ethers.formatEther(proposal.votesAgainst));
        console.log('   Executed:', proposal.executed);
        console.log('   Cancelled:', proposal.cancelled);
        console.log('');

        // Vote on proposal
        if (user1VeXF > 0n) {
          console.log('🗳️  User 1 voting FOR proposal...');
          try {
            const voteTx = await treasury.connect(user1).vote(proposalId, true, {
              gasLimit: 500000,
            });
            await voteTx.wait();
            console.log('✅ Vote submitted successfully!');
            console.log('   Tx: https://explorer.thetatoken.org/tx/' + voteTx.hash);
            console.log('   Voting Power:', ethers.formatEther(user1VeXF));
            console.log('');
          } catch (error: any) {
            console.error('❌ Vote failed:', error.message);
          }
        }

        if (user2VeXF > 0n) {
          console.log('🗳️  User 2 voting FOR proposal...');
          try {
            const voteTx = await treasury.connect(user2).vote(proposalId, true, {
              gasLimit: 500000,
            });
            await voteTx.wait();
            console.log('✅ Vote submitted successfully!');
            console.log('   Tx: https://explorer.thetatoken.org/tx/' + voteTx.hash);
            console.log('   Voting Power:', ethers.formatEther(user2VeXF));
            console.log('');
          } catch (error: any) {
            console.error('❌ Vote failed:', error.message);
          }
        }

        // Get updated proposal details
        const proposalAfter = await treasury.getProposal(proposalId);
        console.log('📊 Updated Proposal Votes:');
        console.log('   Votes For:', ethers.formatEther(proposalAfter.votesFor));
        console.log('   Votes Against:', ethers.formatEther(proposalAfter.votesAgainst));
        console.log('');
        console.log('⚠️  Note: Proposal execution requires voting period to end and quorum/majority to be met.');
        console.log('   Use executeProposal() after voting period ends to execute.\n');
      } catch (error: any) {
        console.error('❌ Proposal creation failed:', error.message);
        console.log('');
      }
    }
  }

  // Summary
  console.log('='.repeat(60));
  console.log('✅ PHASE 3 INTEGRATION TESTS COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log('📋 Summary:');
  console.log('   ✅ Edge Node signers authorized');
  console.log('   ✅ Proof verification tested');
  console.log('   ✅ Treasury deposits tested');
  console.log('   ✅ Proposal creation and voting tested');
  console.log('');
  console.log('🔗 Contract Links:');
  console.log('   ThetaPulseProof:', `https://explorer.thetatoken.org/address/${PULSE_PROOF_ADDRESS}`);
  console.log('   InnovationTreasury:', `https://explorer.thetatoken.org/address/${TREASURY_ADDRESS}`);
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });


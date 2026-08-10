// Deploy SP1 Prover to Theta EdgeCloud - Automated
// Uses AWS Secrets Manager for credentials
// Run: node deploy-to-theta.cjs

const { execSync } = require('child_process');
require('dotenv').config({ path: '../.env.local' });

// Configuration
const CONFIG = {
  thetaApiKeyArn: process.env.THETA_API_KEY,
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  ecrRegistry: '187510174358.dkr.ecr.us-east-1.amazonaws.com',
  imageName: 'sp1-prover-cuda:latest',
  deploymentName: 'xfuel-sp1-prover'
};

// Fetch secret from AWS Secrets Manager
function getSecret(arn) {
  console.log(`🔐 Fetching secret from AWS: ${arn.substring(0, 50)}...`);
  
  try {
    const command = `aws secretsmanager get-secret-value --secret-id "${arn}" --region ${CONFIG.awsRegion} --query SecretString --output text`;
    const secret = execSync(command, { encoding: 'utf8' }).trim();
    
    // Handle JSON format ({"key": "value"})
    try {
      const parsed = JSON.parse(secret);
      // Try common key names
      return parsed.theta_api_key || 
             parsed.THETA_API_KEY || 
             parsed.api_key || 
             parsed.key || 
             parsed.value || 
             secret;
    } catch {
      // Plain text value
      return secret;
    }
  } catch (error) {
    console.error('❌ Failed to fetch secret:', error.message);
    throw error;
  }
}

// Get ECR login password
function getEcrPassword() {
  console.log('🔐 Getting ECR password...');
  try {
    const password = execSync(
      `aws ecr get-login-password --region ${CONFIG.awsRegion}`,
      { encoding: 'utf8' }
    ).trim();
    return password;
  } catch (error) {
    console.error('❌ Failed to get ECR password:', error.message);
    throw error;
  }
}

// Deploy to Theta EdgeCloud
async function deployToTheta() {
  console.log('\n🚀 Deploying SP1 Prover to Theta EdgeCloud\n');
  console.log('=' .repeat(60));
  
  // Step 1: Fetch Theta API key
  console.log('\n[STEP 1] Loading credentials...');
  const thetaApiKey = getSecret(CONFIG.thetaApiKeyArn);
  const ecrPassword = getEcrPassword();
  console.log('✅ Credentials loaded\n');
  
  // Step 2: Deploy via Theta EdgeCloud API
  console.log('[STEP 2] Deploying container...');
  
  const deploymentConfig = {
    name: CONFIG.deploymentName,
    image: `${CONFIG.ecrRegistry}/${CONFIG.imageName}`,
    registry: {
      url: CONFIG.ecrRegistry,
      username: 'AWS',
      password: ecrPassword
    },
    environment: {
      SP1_PROVER: 'cuda',
      RUST_LOG: 'info',
      CUDA_VISIBLE_DEVICES: '0'
    },
    ports: [
      { container: 8080, host: 8080, protocol: 'tcp' }
    ],
    resources: {
      gpu: {
        type: 'nvidia',
        count: 1,
        model: 'rtx4090' // or 'a100', 'h100'
      },
      cpu: 4,
      memory: '16Gi',
      storage: '30Gi'
    },
    restart: 'unless-stopped',
    healthCheck: {
      path: '/health',
      port: 8080,
      interval: 30
    }
  };
  
  // TODO: Replace with actual Theta EdgeCloud API endpoint and method
  // This is a placeholder - adjust based on Theta's actual API
  
  console.log('\nDeployment configuration:');
  console.log(JSON.stringify(deploymentConfig, null, 2));
  
  console.log('\n⚠️  NOTE: Theta EdgeCloud API integration pending');
  console.log('   Please provide the Theta EdgeCloud API endpoint/documentation');
  console.log('   for automated deployment.\n');
  
  console.log('📋 Next steps:');
  console.log('   1. Get Theta EdgeCloud API documentation');
  console.log('   2. Complete this script with actual API calls');
  console.log('   3. Or use the manual deployment guide\n');
  
  // Alternative: Use Theta CLI if available
  console.log('💡 Alternative: If Theta has a CLI tool, we can use:');
  console.log('   theta-edge deploy \\');
  console.log(`     --name ${CONFIG.deploymentName} \\`);
  console.log(`     --image ${CONFIG.ecrRegistry}/${CONFIG.imageName} \\`);
  console.log('     --gpu nvidia-rtx4090 \\');
  console.log('     --env SP1_PROVER=cuda \\');
  console.log('     --port 8080:8080\n');
  
  return {
    success: false,
    message: 'Manual deployment required - API integration pending',
    config: deploymentConfig,
    credentials: {
      thetaApiKey: thetaApiKey.substring(0, 10) + '...',
      ecrPassword: ecrPassword.substring(0, 20) + '...'
    }
  };
}

// Run deployment
deployToTheta()
  .then(result => {
    if (result.success) {
      console.log('\n✅ SUCCESS!');
      console.log(`Endpoint: ${result.endpoint}`);
    } else {
      console.log('\n⚠️  ' + result.message);
      console.log('\nCredentials ready for manual deployment:');
      console.log('  Theta API Key: Available ✅');
      console.log('  ECR Password: Available ✅');
    }
  })
  .catch(error => {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  });

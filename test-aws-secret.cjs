const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

async function testAWSSecret() {
  console.log('\n🔍 AWS Secrets Manager Diagnostic Test\n');
  console.log('='.repeat(60));
  
  const secretArn = process.env.DEPLOYER_KEYSTORE_PASSWORD;
  console.log(`Secret ARN: ${secretArn}\n`);
  
  if (!secretArn || !secretArn.startsWith('arn:aws:secretsmanager')) {
    console.log('❌ Not an ARN - using direct password');
    console.log(`Value type: ${typeof secretArn}`);
    console.log(`Value length: ${secretArn ? secretArn.length : 0}`);
    return;
  }
  
  try {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const command = new GetSecretValueCommand({ SecretId: secretArn });
    const response = await client.send(command);
    
    console.log('✅ Successfully fetched from AWS\n');
    console.log('Response details:');
    console.log(`  SecretString exists: ${!!response.SecretString}`);
    console.log(`  SecretBinary exists: ${!!response.SecretBinary}`);
    
    let password = response.SecretString;
    
    console.log('\n📝 Raw password from AWS:');
    console.log(`  Type: ${typeof password}`);
    console.log(`  Length: ${password ? password.length : 0}`);
    console.log(`  First char code: ${password ? password.charCodeAt(0) : 'N/A'}`);
    console.log(`  Last char code: ${password ? password.charCodeAt(password.length - 1) : 'N/A'}`);
    console.log(`  Has leading whitespace: ${password !== password.trimStart()}`);
    console.log(`  Has trailing whitespace: ${password !== password.trimEnd()}`);
    console.log(`  First 5 chars: "${password ? password.substring(0, 5) : ''}..."`);
    console.log(`  Last 5 chars: "...${password ? password.substring(password.length - 5) : ''}"`);
    
    // Try parsing as JSON
    console.log('\n🔍 Checking if it\'s JSON:');
    try {
      const parsed = JSON.parse(password);
      console.log('  ✅ Valid JSON!');
      console.log(`  Type: ${typeof parsed}`);
      console.log(`  Keys: ${Object.keys(parsed).join(', ')}`);
      console.log(`  Structure:`, JSON.stringify(parsed, null, 2));
      
      if (parsed.password) {
        console.log(`\n  Found "password" key!`);
        console.log(`    Length: ${parsed.password.length}`);
        console.log(`    Value: "${parsed.password.substring(0, 5)}...${parsed.password.substring(parsed.password.length - 5)}"`);
      } else if (typeof parsed === 'object') {
        const firstValue = Object.values(parsed)[0];
        console.log(`\n  Using first value from object`);
        console.log(`    Key: ${Object.keys(parsed)[0]}`);
        console.log(`    Length: ${firstValue.length}`);
        console.log(`    Value: "${firstValue.substring(0, 5)}...${firstValue.substring(firstValue.length - 5)}"`);
      }
    } catch (jsonError) {
      console.log('  ❌ Not JSON (plain text)');
    }
    
    // After trimming
    const trimmed = password.trim();
    console.log('\n📝 After trimming:');
    console.log(`  Length: ${trimmed.length}`);
    console.log(`  Changed: ${password.length !== trimmed.length}`);
    if (password.length !== trimmed.length) {
      console.log(`  Removed ${password.length - trimmed.length} whitespace characters`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('\n💡 Now compare this with the password you copied from AWS!');
    console.log('   Check for:');
    console.log('   - Extra quotes around the value');
    console.log('   - JSON structure (like {"password": "value"})');
    console.log('   - Whitespace/newlines');
    console.log('   - Different encoding\n');
    
  } catch (error) {
    console.error('\n❌ Error fetching from AWS:', error.message);
  }
}

testAWSSecret();




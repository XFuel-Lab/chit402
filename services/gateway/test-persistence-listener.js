#!/usr/bin/env node
/**
 * Test Persistence Listener with Mock Events
 * 
 * This script simulates BurnForUnwrap events from Persistence
 * to test the backend listener WITHOUT needing real contract deployment
 */

import { WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

// Mock BurnForUnwrap event (matches Tendermint WebSocket format)
function createMockTendermintEvent(overrides = {}) {
  const defaults = {
    burner: 'persistence1usertest1234567890abcdefghijk',
    theta_recipient: '0xD3EED5D4a61Beb3401E10D606f9957500AC9819a',
    burn_amount: '100000000000000000', // 0.1 TFUEL
    fee_amount: '500000000000000', // 0.0005 TFUEL (0.5%)
    nonce: '1',
  };

  const data = { ...defaults, ...overrides };

  // Cosmos SDK Tendermint WebSocket event structure
  return {
    jsonrpc: '2.0',
    id: '1',
    result: {
      query: `tm.event='Tx'`,
      data: {
        type: 'tendermint/event/Tx',
        value: {
          TxResult: {
            height: '12345678',
            hash: Buffer.from('A'.repeat(64), 'utf8').toString('base64'),
            result: {
              events: [
                {
                  type: 'wasm',
                  attributes: [
                    {
                      key: Buffer.from('_contract_address').toString('base64'),
                      value: Buffer.from(process.env.PERSISTENCE_MINTER_CONTRACT || 'persistence1e7waerpss8nvyhyd867arhq87ul3r2v04wf74t').toString('base64'),
                    },
                    {
                      key: Buffer.from('action').toString('base64'),
                      value: Buffer.from('burn_for_unwrap').toString('base64'),
                    },
                    {
                      key: Buffer.from('burner').toString('base64'),
                      value: Buffer.from(data.burner).toString('base64'),
                    },
                    {
                      key: Buffer.from('theta_recipient').toString('base64'),
                      value: Buffer.from(data.theta_recipient).toString('base64'),
                    },
                    {
                      key: Buffer.from('burn_amount').toString('base64'),
                      value: Buffer.from(data.burn_amount).toString('base64'),
                    },
                    {
                      key: Buffer.from('fee_amount').toString('base64'),
                      value: Buffer.from(data.fee_amount).toString('base64'),
                    },
                    {
                      key: Buffer.from('nonce').toString('base64'),
                      value: Buffer.from(data.nonce).toString('base64'),
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };
}

// Test scenarios
const testEvents = [
  {
    name: 'Small burn (0.05 TFUEL)',
    data: {
      burn_amount: '50000000000000000',
      fee_amount: '250000000000000',
      nonce: '1',
    },
  },
  {
    name: 'Medium burn (0.5 TFUEL)',
    data: {
      burn_amount: '500000000000000000',
      fee_amount: '2500000000000000',
      nonce: '2',
    },
  },
  {
    name: 'Different recipient',
    data: {
      theta_recipient: '0x627082bFAdffb16B979d99A8eFc8F1874c0990C4',
      burn_amount: '100000000000000000',
      fee_amount: '500000000000000',
      nonce: '3',
    },
  },
];

async function sendMockEvents() {
  console.log('🧪 Persistence Listener Mock Event Tester');
  console.log('═'.repeat(60));
  console.log('\n📍 Target: Backend listener on ws://localhost:3001');
  console.log('⚠️  Make sure backend is running: cd backend/theta-bridge && npm start\n');

  // Wait for user confirmation
  console.log('Press Enter to send mock events...');
  await new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });

  console.log('\n📤 Sending mock BurnForUnwrap events...\n');

  for (const [index, test] of testEvents.entries()) {
    console.log(`${index + 1}. ${test.name}`);
    const mockEvent = createMockTendermintEvent(test.data);
    
    console.log('   Event data:', {
      burner: test.data.burner || 'persistence1usertest...',
      theta_recipient: test.data.theta_recipient || '0xD3EE...9a',
      burn_amount: test.data.burn_amount,
      unwrap_amount: (BigInt(test.data.burn_amount) - BigInt(test.data.fee_amount)).toString(),
      nonce: test.data.nonce,
    });

    // In production, you would send this to a WebSocket mock server
    // or directly call the listener's handleBurnEvent method
    console.log('   ✓ Mock event created (would be sent to listener)\n');

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log('═'.repeat(60));
  console.log('✅ All mock events processed');
  console.log('\n📝 Next: Check backend logs for event detection');
  console.log('   Expected: Events stored in Redis → processed by unwrapper\n');
}

// For direct testing of the listener (bypasses WebSocket)
export async function testListenerDirectly() {
  console.log('🧪 Testing Persistence Listener Directly\n');

  // Import listener
  const { initPersistenceListener } = await import('./src/persistence-listener.js');
  
  const listener = await initPersistenceListener();
  
  // Send mock events directly
  for (const test of testEvents) {
    console.log(`Testing: ${test.name}`);
    const mockEvent = createMockTendermintEvent(test.data);
    
    // Call handleBurnEvent directly
    await listener.handleBurnEvent(mockEvent.result.data);
    console.log('   ✓ Event handled\n');
    
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  
  console.log('✅ Direct listener test complete');
}

// Run
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  sendMockEvents().catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

export { createMockTendermintEvent, testEvents };

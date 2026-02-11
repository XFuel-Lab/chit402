#!/usr/bin/env node
/**
 * Direct Test for Persistence Listener
 * Sends mock BurnForUnwrap events directly to the listener
 */

import dotenv from 'dotenv';
import { initPersistenceListener } from './src/persistence-listener.js';

dotenv.config();

// Mock event data
const mockEvents = [
  {
    name: 'Small burn (0.05 TFUEL)',
    value: {
      value: {  // Add this wrapper
        TxResult: {
          height: '12345678',
          hash: Buffer.from('A'.repeat(64), 'utf8').toString('base64'),
          result: {
            events: [
              {
                type: 'wasm',
                attributes: [
                  { key: Buffer.from('_contract_address').toString('base64'), value: Buffer.from(process.env.PERSISTENCE_MINTER_CONTRACT).toString('base64') },
                  { key: Buffer.from('action').toString('base64'), value: Buffer.from('burn_for_unwrap').toString('base64') },
                  { key: Buffer.from('burner').toString('base64'), value: Buffer.from('persistence1usertest1234567890abcdefghijk').toString('base64') },
                  { key: Buffer.from('theta_recipient').toString('base64'), value: Buffer.from('0xD3EED5D4a61Beb3401E10D606f9957500AC9819a').toString('base64') },
                  { key: Buffer.from('burn_amount').toString('base64'), value: Buffer.from('50000000000000000').toString('base64') },
                  { key: Buffer.from('fee_amount').toString('base64'), value: Buffer.from('250000000000000').toString('base64') },
                  { key: Buffer.from('nonce').toString('base64'), value: Buffer.from('1').toString('base64') },
                ],
              },
            ],
          },
        },
      }
    },
  },
];

async function test() {
  console.log('🧪 Testing Persistence Listener Directly\n');
  
  try {
    // Initialize listener
    console.log('Initializing listener...');
    const listener = await initPersistenceListener();
    console.log('✓ Listener initialized\n');
    
    // Process each mock event
    for (const mockEvent of mockEvents) {
      console.log(`📋 Processing: ${mockEvent.name}`);
      
      await listener.handleBurnEvent(mockEvent.value);
      
      console.log('✓ Event handled\n');
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('✅ All tests passed!\n');
    console.log('Check Redis for stored events:');
    console.log('  redis-cli');
    console.log('  KEYS *burn*');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test();

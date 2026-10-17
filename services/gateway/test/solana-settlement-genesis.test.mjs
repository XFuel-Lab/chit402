import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedSolanaGenesis,
  probeConfiguredSettlementRpcs,
  probeSettlementSide,
  resetSettlementRpcForTests,
  settlementRefusal,
  settlementSolanaRpcUrl,
  SOLANA_MAINNET_GENESIS,
  SOLANA_DEVNET_GENESIS,
} from '../src/x402-chain.js';

const PROD_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const PROD_DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PROD_RPC = 'https://api.mainnet-beta.solana.com';

test('solana network names map to the full getGenesisHash', () => {
  assert.equal(SOLANA_MAINNET_GENESIS, PROD_MAINNET_GENESIS);
  assert.equal(SOLANA_DEVNET_GENESIS, PROD_DEVNET_GENESIS);
  for (const name of ['solana', 'solana-mainnet', 'mainnet-beta', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']) {
    assert.equal(expectedSolanaGenesis(name), PROD_MAINNET_GENESIS);
  }
  for (const name of ['solana-devnet', 'devnet', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1']) {
    assert.equal(expectedSolanaGenesis(name), PROD_DEVNET_GENESIS);
  }
  assert.equal(expectedSolanaGenesis('solana-testnet'), null);
});

test('prod env values accept mainnet genesis from api.mainnet-beta.solana.com', async () => {
  resetSettlementRpcForTests();
  const env = {
    X402_SOLANA_NETWORK: 'solana',
    SOLANA_RPC_URL: PROD_RPC,
    SOLANA_ANCHOR_CLUSTER: 'mainnet-beta',
  };
  const cfg = {
    solanaRpcUrl: env.SOLANA_RPC_URL,
    solana: { network: env.X402_SOLANA_NETWORK },
  };
  assert.equal(settlementSolanaRpcUrl(cfg), PROD_RPC);
  const calls = [];
  const probed = await probeConfiguredSettlementRpcs(cfg, {
    request: async (url, method) => {
      calls.push({ url, method });
      return PROD_MAINNET_GENESIS;
    },
  });
  assert.deepEqual(calls, [{ url: PROD_RPC, method: 'getGenesisHash' }]);
  assert.equal(probed.solana.paused, false);
  assert.equal(probed.solana.reason, null);
  assert.equal(settlementRefusal('solana'), null);
  assert.equal(settlementRefusal('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), null);
  resetSettlementRpcForTests();
});

test('a genesis mismatch pauses solana and logs expected, actual, and the host only', async () => {
  resetSettlementRpcForTests();
  const lines = [];
  const url = 'https://user:secret-token@api.mainnet-beta.solana.com/rpc?api-key=hidden-key';
  const state = await probeSettlementSide({
    side: 'solana',
    url,
    expected: expectedSolanaGenesis('solana'),
    request: async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    warn: (obj, msg) => lines.push({ obj, msg }),
  });
  assert.equal(state.paused, true);
  assert.equal(state.reason, 'network_not_accepted');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].msg, 'settlement RPC genesis mismatch');
  assert.equal(lines[0].obj.expected, PROD_MAINNET_GENESIS);
  assert.equal(lines[0].obj.actual, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  assert.equal(lines[0].obj.host, 'api.mainnet-beta.solana.com');
  const logged = JSON.stringify(lines);
  assert.equal(logged.includes('secret-token'), false);
  assert.equal(logged.includes('hidden-key'), false);
  assert.equal(logged.includes('api-key'), false);
  assert.equal(logged.includes(url), false);
  resetSettlementRpcForTests();
});

test('devnet genesis is the full hash and a matching read stays open', async () => {
  resetSettlementRpcForTests();
  const state = await probeSettlementSide({
    side: 'solana',
    url: 'https://api.devnet.solana.com',
    expected: expectedSolanaGenesis('devnet'),
    request: async () => PROD_DEVNET_GENESIS,
  });
  assert.equal(state.paused, false);
  resetSettlementRpcForTests();
});

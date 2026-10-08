/**
 * Test seam for chain confirmation. Kept free of config/logger imports so a
 * test can load the mock facilitator before it sets process env.
 */

let testChainReader = null;

export function setChainReaderForTests(fn) {
  testChainReader = typeof fn === 'function' ? fn : null;
}

export function clearChainReaderForTests() {
  testChainReader = null;
}

export function getChainReaderForTests() {
  return testChainReader;
}

/** Confirm the facilitator fields at the challenge amount. Not a production reader. */
export async function echoChainReader({ challenge, facilitator }) {
  const tx = facilitator?.transaction || facilitator?.txRef || null;
  const payer = facilitator?.payer || null;
  if (!challenge || !tx || !payer) return { ok: false, code: 'settle_unconfirmed' };
  return {
    ok: true,
    confirmed: true,
    amount: String(challenge.amount),
    payer,
    payTo: challenge.payTo,
    transaction: tx,
    network: challenge.network,
    logIndex: 0,
    blockNumber: 1,
    slot: null,
  };
}

export function installEchoChainReader() {
  setChainReaderForTests(echoChainReader);
}

/** User-facing copy for register errors — mirrors gateway messages honestly. */
export function registerErrorCopy(error, message) {
  if (error === 'not_qualifying') {
    return {
      title: 'Receipt does not qualify',
      body: message.includes('demo') || message.includes('unmetered')
        ? 'Demo and unmetered receipts never register. Pay once via POST /v1/chat/completions (USDC collected), then use that task_id.'
        : message || 'Only collected USDC receipts qualify. Demo never writes the book.',
    };
  }
  if (error === 'hmac_invalid') {
    return {
      title: 'HMAC verification failed',
      body: 'The receipt signature did not verify. Use a task_id from a real collected receipt — copy it from verify_url or the x-xfuel headers.',
    };
  }
  if (error === 'duplicate_ref' || error === 'duplicate_task') {
    return {
      title: 'Already registered',
      body: message || 'This payment.ref or task_id was already used to register another agent.',
    };
  }
  if (error === 'invalid_wallet') {
    return {
      title: 'Invalid agent wallet',
      body: message || 'Use a 0x address (plain EOA, AAWP official, or smart account). API keys and secrets are rejected. A detectable EOA also sends wallet_signature.',
    };
  }
  if (error === 'not_found') {
    return {
      title: 'Receipt not found',
      body: 'No receipt for that task_id on the gateway. Copy task_id from verify_url after a paid call.',
    };
  }
  if (error === 'bind_failed') {
    return {
      title: 'Wallet bind failed',
      body: message || 'This wallet or agent_id is already bound to a different identity.',
    };
  }
  if (error === 'validation_error') {
    return {
      title: 'Missing fields',
      body: message || 'agentWallet and task_id are required.',
    };
  }
  if (error === 'network') {
    return { title: 'Network error', body: message };
  }
  return {
    title: 'Registration failed',
    body: message || 'Check agentWallet and task_id, then retry.',
  };
}

# Backend JSON Format Compatibility

## Input Format from Backend (theta-bridge)

The backend's `prover.js` sends data in this format:

```javascript
{
  // Public inputs (verified on-chain)
  "vaultAddress": "12345...789",          // BigInt string
  "netAmount": "10000000000000000000",     // BigInt string (wei)
  "blockNumber": "12345678",               // BigInt string
  "merkleRoot": "98765...432",             // BigInt string
  "identityCommitment": "11111...222",     // BigInt string
  
  // Private inputs
  "senderAddress": "67890...123",          // BigInt string
  "grossAmount": "10050000000000000000",   // BigInt string (wei)
  "feeAmount": "50000000000000000",        // BigInt string (wei)
  "blockHash": "44444...555",              // BigInt string
  "blockTimestamp": "1737331200",          // BigInt string (unix timestamp)
  "txHash": "33333...666",                 // BigInt string
  "txIndex": "42",                         // BigInt string
  "merkleProof": ["111...", "222..."],     // Array of BigInt strings
  "merklePathIndices": ["0", "1", "0"],    // Array of BigInt strings (0 or 1)
  "identitySecret": "777...888",           // BigInt string
  "identityNullifier": "999...000",        // BigInt string
  "identityTrapdoor": "123...456"          // BigInt string
}
```

## SP1 Host Expected Format

The SP1 host (`host/src/main.rs`) expects hex strings:

```json
{
  "vault_address": "0x0000000000000000000000000000000000000001",
  "net_amount": "0x8AC7230489E80000",
  "block_number": 12345678,
  "merkle_root": "0x1234567890abcdef...",
  "identity_commitment": "0xabcdef1234567890...",
  
  "sender_address": "0x0000000000000000000000000000000000000002",
  "gross_amount": "0x8AC7230489E80000",
  "fee_amount": "0x2386F26FC10000",
  "block_hash": "0xfedcba9876543210...",
  "block_timestamp": 1737331200,
  "tx_hash": "0x9876543210fedcba...",
  "tx_index": 42,
  "merkle_proof": ["0x1111...", "0x2222..."],
  "merkle_path_indices": [0, 1, 0, 1],
  "identity_secret": "0xdeadbeef...",
  "identity_nullifier": "0xcafebabe...",
  "identity_trapdoor": "0x01234567..."
}
```

## Conversion Needed

The backend sends **BigInt strings**, but SP1 host expects **hex strings**.

### Option 1: Update Backend (Recommended)
Modify `backend/theta-bridge/src/prover.js` to send hex format.

### Option 2: Update SP1 Host (Alternative)
Add BigInt string parsing to `host/src/main.rs`.

## Recommended Solution

Update the backend to call SP1 prover with hex format since:
1. Hex is standard for Ethereum/Theta
2. Easier to debug
3. More compatible with tools

---

**Status:** Format mismatch identified - needs conversion layer

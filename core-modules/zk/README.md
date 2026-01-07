# ZK Module - Zero-Knowledge Proofs

This module implements zero-knowledge proof verification for secure cross-chain deposits from Theta to Persistence.

## Components

### ZKVerifier.sol
**On-chain Groth16 verifier** for deposit proofs.

**Security Features:**
- Nullifier tracking (prevents replay attacks)
- Merkle root registry (validates block authenticity)
- Identity commitment verification (non-malleability)
- Rate limiting (prevents abuse)
- Circuit breaker (automatic pause on high failure rate)
- Emergency pause mechanism

**Key Functions:**
- `verifyDepositProof()` - Verify a Groth16 proof with public inputs
- `registerMerkleRoot()` - Register Theta block Merkle roots
- `registerIdentity()` - Register identity commitments
- `pause()/unpause()` - Emergency controls

### proof-generator.js
**Off-chain proof generation service** for the Theta bridge.

**Features:**
- Groth16 proof generation using snarkjs
- Mock proof mode for development/testing
- Circuit input preparation
- Local proof verification before submission
- Proof formatting for Solidity verification

**Key Functions:**
- `generateProof(depositData, blockData, txData)` - Generate ZK proof
- `prepareCircuitInputs()` - Format inputs for circuit
- `verifyProof()` - Verify proof locally

### circuits/
**Circom circuit definitions and compiled artifacts.**

**Files:**
- `deposit.circom` - Circuit definition for deposit proofs
- `circuit.wasm` - Compiled WASM for proof generation
- `circuit_final.zkey` - Proving key
- `verification_key.json` - Verification key
- `setup-groth16.sh/bat` - Setup scripts for trusted setup

## IBC Compatibility

This module is designed for **IBC Channel-190** (Theta ↔ Persistence).

## Security Considerations

⚠️ **Critical Security Module**

- All proofs must pass Groth16 verification
- Nullifiers prevent double-spending
- Merkle roots must be pre-registered by trusted oracle
- Rate limiting prevents DoS attacks
- Circuit breaker triggers automatic pause at 10% failure rate

## Integration

Used by:
- `backend/theta-bridge/src/listener.js` - Monitors Theta deposits
- `backend/theta-bridge/src/index.js` - Submits proofs to Persistence

## Testing

Mock proofs available for development:
```javascript
const prover = await initProver();
const mockProof = prover.generateMockProof(depositData, blockData, txData);
```

## Deployment

1. Run trusted setup: `cd circuits && ./setup-groth16.sh`
2. Deploy ZKVerifier.sol to Persistence
3. Register initial Merkle roots
4. Configure proof-generator service with circuit paths

## Version

ZK Module v1.0.0-enhanced-security
Compatible with Groth16, BN254 curve


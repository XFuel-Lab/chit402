# ZK Circuits Directory

This directory should contain the ZK circuit files for proof generation.

## Required Files

- `circuit.wasm` - Compiled circuit WebAssembly
- `circuit_final.zkey` - Circuit proving key
- `verification_key.json` - Verification key

## Development Mode

During development, if these files are not present, the service will run in **MOCK MODE** and generate placeholder proofs.

⚠️ **MOCK MODE IS NOT SECURE** - Only use for development and testing.

## Production Setup

For production deployment, you must:

1. **Design the Circuit**: Create a Circom circuit that proves:
   - Transaction inclusion in a Theta block
   - Deposit to a specific vault address
   - Net amount after fee deduction

2. **Compile the Circuit**:
   ```bash
   circom circuit.circom --r1cs --wasm --sym
   ```

3. **Generate Proving Key**:
   ```bash
   snarkjs groth16 setup circuit.r1cs pot_final.ptau circuit_0000.zkey
   snarkjs zkey contribute circuit_0000.zkey circuit_final.zkey
   ```

4. **Export Verification Key**:
   ```bash
   snarkjs zkey export verificationkey circuit_final.zkey verification_key.json
   ```

5. **Place Files Here**:
   - Copy `circuit.wasm` to this directory
   - Copy `circuit_final.zkey` to this directory
   - Copy `verification_key.json` to this directory

## Example Circuit Structure

```circom
pragma circom 2.0.0;

template DepositProof() {
    // Public inputs
    signal input vaultAddress;
    signal input netAmount;
    signal input blockNumber;
    
    // Private inputs
    signal input senderAddress;
    signal input grossAmount;
    signal input feeAmount;
    signal input blockHash;
    signal input txHash;
    
    // Constraints
    // 1. Verify fee calculation
    signal feeCheck <== grossAmount * 50 / 10000;
    feeCheck === feeAmount;
    
    // 2. Verify net amount
    signal netCheck <== grossAmount - feeAmount;
    netCheck === netAmount;
    
    // 3. Additional constraints for block/tx inclusion
    // ... (implementation specific)
}

component main = DepositProof();
```

## Security Notes

- Keep proving keys secure
- Use trusted setup for production
- Regularly audit circuit logic
- Test thoroughly before mainnet deployment

## Resources

- [Circom Documentation](https://docs.circom.io/)
- [snarkjs Guide](https://github.com/iden3/snarkjs)
- [ZK Proof Systems](https://z.cash/technology/zksnarks/)


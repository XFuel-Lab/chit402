import express from 'express';
import { ethers } from 'ethers';

const router = express.Router();

// Environment variables
const THETA_PULSE_PROOF_ADDRESS = process.env.THETA_PULSE_PROOF_ADDRESS;
const THETA_RPC_URL = process.env.THETA_RPC_URL || 'https://eth-rpc-api-testnet.thetatoken.org/rpc';

/**
 * POST /api/pulse-proof/verify
 * Verify and submit a TPulse message proof to the ThetaPulseProof contract
 * 
 * Body:
 *   - userAddress: string (required) - Address of the user who earned revenue
 *   - earnings: string (required) - Amount of earnings (in wei, typically TFUEL)
 *   - nonce: number (required) - Unique nonce to prevent replay attacks
 *   - signature: string (required) - Signature from authorized Edge Node
 * 
 * Returns:
 *   - success: boolean
 *   - txHash?: string - Transaction hash if successful
 *   - message?: string - Error message if failed
 */
router.post('/verify', async (req, res) => {
  try {
    const { userAddress, earnings, nonce, signature } = req.body;

    // Validation
    if (!userAddress || !earnings || nonce === undefined || !signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userAddress, earnings, nonce, signature'
      });
    }

    // Validate addresses and amounts
    if (!ethers.isAddress(userAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid userAddress'
      });
    }

    let earningsBigInt;
    try {
      earningsBigInt = BigInt(earnings);
      if (earningsBigInt <= 0n) {
        throw new Error('Earnings must be positive');
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid earnings amount'
      });
    }

    if (!THETA_PULSE_PROOF_ADDRESS) {
      return res.status(500).json({
        success: false,
        message: 'ThetaPulseProof contract address not configured'
      });
    }

    // Connect to Theta network
    const provider = new ethers.JsonRpcProvider(THETA_RPC_URL);
    
    // Load contract ABI (simplified - in production, load from artifacts)
    const contractABI = [
      'function verifyProof(address user, uint256 earnings, uint256 nonce, bytes memory signature) external'
    ];
    
    const contract = new ethers.Contract(
      THETA_PULSE_PROOF_ADDRESS,
      contractABI,
      provider
    );

    // For now, we'll return the data needed for the frontend to submit
    // In production, you might want to use a relayer wallet to submit the transaction
    // or require the user to submit it directly from their wallet

    // Verify signature format (65 bytes = 130 hex chars + "0x" = 132 chars total)
    if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid signature format (expected 65-byte signature)'
      });
    }

    // Return success with calldata for frontend submission
    // Frontend will need to call the contract directly
    const calldata = contract.interface.encodeFunctionData('verifyProof', [
      userAddress,
      earningsBigInt.toString(),
      nonce,
      signature
    ]);

    return res.json({
      success: true,
      contractAddress: THETA_PULSE_PROOF_ADDRESS,
      calldata,
      message: 'Proof verified. Submit transaction to contract.'
    });

  } catch (error) {
    console.error('Pulse proof verification error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * GET /api/pulse-proof/verify-signature
 * Verify a signature without submitting to chain (for validation only)
 * 
 * Query params:
 *   - userAddress: string (required)
 *   - earnings: string (required)
 *   - nonce: number (required)
 *   - signature: string (required)
 * 
 * Returns:
 *   - success: boolean
 *   - signer?: string - Recovered signer address
 *   - valid?: boolean - Whether signature is valid
 *   - message?: string - Error message if failed
 */
router.get('/verify-signature', async (req, res) => {
  try {
    const { userAddress, earnings, nonce, signature } = req.query;

    if (!userAddress || !earnings || !nonce || !signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing required query parameters: userAddress, earnings, nonce, signature'
      });
    }

    // Get chain ID from provider
    const provider = new ethers.JsonRpcProvider(THETA_RPC_URL);
    const network = await provider.getNetwork();
    const chainId = network.chainId;

    // Create message hash matching contract's implementation
    const messageHash = ethers.keccak256(
      ethers.solidityPacked(
        ['address', 'uint256', 'uint256', 'uint256'],
        [userAddress, earnings, nonce, chainId]
      )
    );

    // Convert to Ethereum signed message hash (matches contract's toEthSignedMessageHash)
    // The contract uses MessageHashUtils.toEthSignedMessageHash() which adds
    // "\x19Ethereum Signed Message:\n32" prefix to the bytes32 hash
    const messageHashBytes = ethers.getBytes(messageHash);
    const ethSignedMessageHash = ethers.hashMessage(messageHashBytes);

    // Recover signer from signature
    let recoveredSigner;
    try {
      recoveredSigner = ethers.recoverAddress(ethSignedMessageHash, signature);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid signature',
        valid: false
      });
    }

    return res.json({
      success: true,
      signer: recoveredSigner,
      valid: true,
      messageHash,
      ethSignedMessageHash
    });

  } catch (error) {
    console.error('Signature verification error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

export default router;


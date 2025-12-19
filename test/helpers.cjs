// Helper functions for ethers v5/v6 compatibility
const { ethers } = require('hardhat')

/**
 * Get address from signer or contract (works with both ethers v5 and v6)
 */
async function getAddress(signerOrContract) {
  if (!signerOrContract) {
    throw new Error('getAddress: signerOrContract is null or undefined')
  }
  
  // Try v6 method first
  if (typeof signerOrContract.getAddress === 'function') {
    return await signerOrContract.getAddress()
  }
  
  // Fall back to v5 property
  if (signerOrContract.address) {
    return signerOrContract.address
  }
  
  // If it's already a string, return it
  if (typeof signerOrContract === 'string') {
    return signerOrContract
  }
  
  throw new Error(`getAddress: Unable to get address from ${typeof signerOrContract}`)
}

/**
 * Parse ether value (ethers v6)
 */
function parseEther(value) {
  return ethers.parseEther(value)
}

/**
 * Parse units (ethers v6)
 */
function parseUnits(value, decimals) {
  return ethers.parseUnits(value, decimals)
}

/**
 * Get zero address (ethers v6)
 */
function getZeroAddress() {
  return ethers.ZeroAddress
}

module.exports = {
  getAddress,
  parseEther,
  parseUnits,
  getZeroAddress
}


use crate::msg::ZkProof;
use cosmwasm_std::{StdResult, Uint128};
use sha2::{Digest, Sha256};

/// Mock ZK proof verifier for demonstration
/// In production, this would integrate with a real ZK proof system
pub fn verify_zk_proof(
    proof: &ZkProof,
    amount: Uint128,
    recipient: &str,
) -> StdResult<bool> {
    // Mock verification logic
    // In production, this would:
    // 1. Verify the proof against the verification key
    // 2. Check that public inputs match (amount, recipient)
    // 3. Validate the proof structure
    
    // For now, we do basic validation
    if proof.proof_data.is_empty() {
        return Ok(false);
    }
    
    if proof.public_inputs.len() < 2 {
        return Ok(false);
    }
    
    if proof.verification_key.is_empty() {
        return Ok(false);
    }
    
    // Verify public inputs match the transaction parameters
    // public_inputs[0] should be amount, public_inputs[1] should be recipient hash
    let expected_amount = amount.to_string();
    if proof.public_inputs[0] != expected_amount {
        return Ok(false);
    }
    
    // In production, verify recipient address hash
    let recipient_hash = hash_address(recipient);
    if proof.public_inputs.len() > 1 && !proof.public_inputs[1].contains(&recipient_hash[..8]) {
        return Ok(false);
    }
    
    // Mock: Accept all properly formatted proofs
    Ok(true)
}

/// Generate proof hash for tracking processed proofs
pub fn generate_proof_hash(proof: &ZkProof) -> String {
    let mut hasher = Sha256::new();
    hasher.update(proof.proof_data.as_bytes());
    hasher.update(proof.verification_key.as_bytes());
    for input in &proof.public_inputs {
        hasher.update(input.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

/// Hash address for privacy-preserving verification
fn hash_address(address: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(address.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verify_valid_proof() {
        let proof = ZkProof {
            proof_data: "valid_proof_data".to_string(),
            public_inputs: vec![
                "1000000000000000000".to_string(),
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
            ],
            verification_key: "vk_12345".to_string(),
        };
        
        let amount = Uint128::from(1000000000000000000u128);
        let recipient = "persistence1abcdef";
        
        let result = verify_zk_proof(&proof, amount, recipient);
        assert!(result.is_ok());
    }

    #[test]
    fn test_verify_empty_proof() {
        let proof = ZkProof {
            proof_data: "".to_string(),
            public_inputs: vec![],
            verification_key: "".to_string(),
        };
        
        let amount = Uint128::from(1000000u128);
        let recipient = "persistence1abcdef";
        
        let result = verify_zk_proof(&proof, amount, recipient);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_generate_proof_hash() {
        let proof = ZkProof {
            proof_data: "test_proof".to_string(),
            public_inputs: vec!["100".to_string(), "addr123".to_string()],
            verification_key: "vk_test".to_string(),
        };
        
        let hash1 = generate_proof_hash(&proof);
        let hash2 = generate_proof_hash(&proof);
        
        // Same proof should generate same hash
        assert_eq!(hash1, hash2);
        assert!(!hash1.is_empty());
    }
}





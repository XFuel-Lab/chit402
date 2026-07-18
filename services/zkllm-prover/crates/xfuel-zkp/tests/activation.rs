//! Tests for the quantized activation lookup table (SiLU/GeLU).

use xfuel_zkp::activation::{encode_i64, ActKind, ActivationTable};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

#[test]
fn silu_table_is_deterministic_and_shaped() {
    let a = ActivationTable::new(ActKind::Silu, 256, 0.25);
    let b = ActivationTable::new(ActKind::Silu, 256, 0.25);
    assert_eq!(a.in_codes, b.in_codes);
    assert_eq!(a.out_codes, b.out_codes);
    assert_eq!(a.in_codes.len(), 256);
    // SiLU(0)=0: the code for signed 0 (index domain/2) maps to 0.
    assert_eq!(a.out_codes[128], Fr::from(0u64));
}

#[test]
fn honest_activation_lookup_verifies() {
    for kind in [ActKind::Silu, ActKind::Gelu] {
        let table = ActivationTable::new(kind, 64, 0.5);
        // Query every code once.
        let input: Vec<Fr> = (0..64u64).map(Fr::from).collect();
        let output = table.apply(&input);
        let proof = table.prove(&input, &output, &mut Transcript::new(b"act"));
        assert!(
            table.verify(&input, &output, &proof, &mut Transcript::new(b"act")),
            "honest {kind:?} activation lookup should verify"
        );
    }
}

#[test]
fn wrong_activation_output_is_rejected() {
    let table = ActivationTable::new(ActKind::Silu, 64, 0.5);
    let input: Vec<Fr> = (0..64u64).map(Fr::from).collect();
    let mut output = table.apply(&input);
    output[10] = encode_i64(31); // not silu(input[10])
    let proof = table.prove(&input, &output, &mut Transcript::new(b"act"));
    assert!(
        !table.verify(&input, &output, &proof, &mut Transcript::new(b"act")),
        "wrong activation output must be rejected"
    );
}

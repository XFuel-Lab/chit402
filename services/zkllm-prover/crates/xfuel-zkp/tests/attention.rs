//! Soundness/completeness tests for the causal self-attention sub-block (projections + Q·Kᵀ +
//! softmax-via-lookup + P·V + output projection + residual).

use xfuel_zkp::attention::{prove_attention, verify_attention, AttnConfig};
use xfuel_zkp::ffn::NormParams;
use xfuel_zkp::norm::RsqrtTable;
use xfuel_zkp::table::ScalarTable;
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

/// `d × d` row-major identity.
fn identity(d: usize) -> Vec<Fr> {
    let mut m = vec![Fr::from(0u64); d * d];
    for i in 0..d {
        m[i * d + i] = Fr::from(1u64);
    }
    m
}

fn cfg(seq: usize, d: usize) -> AttnConfig {
    AttnConfig { seq, d_model: d, d_head: d, norm_name: "rmsnorm" }
}

/// Softmax-numerator table: `f(0)=0` (the causal-mask sentinel), `f(c)=c` otherwise — a monotone
/// positive stand-in; the gadget accepts any canonical table (a real `exp` table in production).
fn exp_table() -> ScalarTable {
    ScalarTable::new(16, |c| c as i64)
}

/// Row-sum reciprocal table (fixed-point `round(64/r)`, `r=0 → 0`).
fn recip_table() -> ScalarTable {
    ScalarTable::new(64, |r| if r == 0 { 0 } else { 64 / r as i64 })
}

/// Fully-controlled small fixture: `x = 1`, identity projections ⇒ Q=K=V=1, scores = d_head,
/// diagonal positive so every causal row-sum is nonzero, everything inside the table domains.
#[allow(clippy::type_complexity)]
fn fixture(seq: usize, d: usize) -> (Vec<Fr>, Vec<Fr>, Vec<Fr>, Vec<Fr>, Vec<Fr>) {
    let x = vec![Fr::from(1u64); seq * d];
    (x, identity(d), identity(d), identity(d), identity(d))
}

#[test]
fn honest_attention_verifies() {
    let (seq, d) = (4, 4);
    let c = cfg(seq, d);
    let (x, wq, wk, wv, wo) = fixture(seq, d);
    let (exp, recip) = (exp_table(), recip_table());

    let (proof, out) = prove_attention(
        &c, &x, &wq, &wk, &wv, &wo, &exp, &recip, None, &mut Transcript::new(b"attn"),
    );
    // Placeholder norm: only the norm obligation is pending.
    assert_eq!(proof.obligations.len(), 1);
    assert_eq!(proof.obligations[0].op, "rmsnorm");
    assert!(
        verify_attention(
            &c, &x, &wq, &wk, &wv, &wo, &out, &proof, &exp, &recip, None,
            &mut Transcript::new(b"attn")
        ),
        "honest attention must verify"
    );
}

#[test]
fn quantized_attention_has_zero_obligations() {
    let (seq, d) = (4, 4);
    let c = cfg(seq, d);
    let (x, wq, wk, wv, wo) = fixture(seq, d);
    let (exp, recip) = (exp_table(), recip_table());
    // Identity RMSNorm: ss = d = 4, inv_rms(4) = 1 with out_scale = sqrt(4); w_norm = 1 ⇒ xn = x.
    let rsqrt = RsqrtTable::new(64, (d as f64).sqrt(), 0.0);
    assert_eq!(rsqrt.apply(&[Fr::from(d as u64)])[0], Fr::from(1u64));
    let w_norm = vec![Fr::from(1u64); d];
    let np = NormParams { weight: &w_norm, table: &rsqrt };

    let (proof, out) = prove_attention(
        &c, &x, &wq, &wk, &wv, &wo, &exp, &recip, Some(&np), &mut Transcript::new(b"attn"),
    );
    assert!(proof.p_norm.is_some());
    assert!(proof.obligations.is_empty(), "quantized attention must have zero pending obligations");
    assert!(
        verify_attention(
            &c, &x, &wq, &wk, &wv, &wo, &out, &proof, &exp, &recip, Some(&np),
            &mut Transcript::new(b"attn")
        ),
        "honest quantized attention must verify"
    );
}

#[test]
fn tampered_scores_are_rejected() {
    let (seq, d) = (4, 4);
    let c = cfg(seq, d);
    let (x, wq, wk, wv, wo) = fixture(seq, d);
    let (exp, recip) = (exp_table(), recip_table());
    let (mut proof, out) = prove_attention(
        &c, &x, &wq, &wk, &wv, &wo, &exp, &recip, None, &mut Transcript::new(b"attn"),
    );
    proof.scores[0] += Fr::from(1u64);
    assert!(
        !verify_attention(
            &c, &x, &wq, &wk, &wv, &wo, &out, &proof, &exp, &recip, None,
            &mut Transcript::new(b"attn")
        ),
        "tampered scores must be rejected"
    );
}

#[test]
fn tampered_softmax_prob_is_rejected() {
    let (seq, d) = (4, 4);
    let c = cfg(seq, d);
    let (x, wq, wk, wv, wo) = fixture(seq, d);
    let (exp, recip) = (exp_table(), recip_table());
    let (mut proof, out) = prove_attention(
        &c, &x, &wq, &wk, &wv, &wo, &exp, &recip, None, &mut Transcript::new(b"attn"),
    );
    // Break the normalization P = E ⊙ r — the Hadamard proof must reject.
    proof.probs[0] += Fr::from(1u64);
    assert!(
        !verify_attention(
            &c, &x, &wq, &wk, &wv, &wo, &out, &proof, &exp, &recip, None,
            &mut Transcript::new(b"attn")
        ),
        "tampered softmax probability must be rejected"
    );
}

#[test]
fn tampered_context_is_rejected() {
    let (seq, d) = (4, 4);
    let c = cfg(seq, d);
    let (x, wq, wk, wv, wo) = fixture(seq, d);
    let (exp, recip) = (exp_table(), recip_table());
    let (mut proof, out) = prove_attention(
        &c, &x, &wq, &wk, &wv, &wo, &exp, &recip, None, &mut Transcript::new(b"attn"),
    );
    proof.ctx[1] += Fr::from(3u64);
    assert!(
        !verify_attention(
            &c, &x, &wq, &wk, &wv, &wo, &out, &proof, &exp, &recip, None,
            &mut Transcript::new(b"attn")
        ),
        "tampered attention context must be rejected"
    );
}

#[test]
fn wrong_exp_table_is_rejected() {
    let (seq, d) = (4, 4);
    let c = cfg(seq, d);
    let (x, wq, wk, wv, wo) = fixture(seq, d);
    let recip = recip_table();
    let exp_prove = ScalarTable::new(16, |c| c as i64);
    let exp_verify = ScalarTable::new(16, |c| 2 * c as i64); // different softmax numerator (still f(0)=0)
    let (proof, out) = prove_attention(
        &c, &x, &wq, &wk, &wv, &wo, &exp_prove, &recip, None, &mut Transcript::new(b"attn"),
    );
    assert!(
        !verify_attention(
            &c, &x, &wq, &wk, &wv, &wo, &out, &proof, &exp_verify, &recip, None,
            &mut Transcript::new(b"attn")
        ),
        "an E from a different exp table must be rejected"
    );
}

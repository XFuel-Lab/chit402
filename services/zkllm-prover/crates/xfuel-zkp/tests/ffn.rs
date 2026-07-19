//! Composition tests for the SwiGLU FFN sub-block (matmul core + Hadamard gadget + obligations).

use ark_std::rand::Rng;
use ark_std::{test_rng, UniformRand};
use xfuel_zkp::ffn::{
    prove_committed_ffn, prove_ffn, verify_committed_ffn, verify_ffn, FfnConfig, NormParams,
};
use xfuel_zkp::manifest::{ActType, ModelManifest, NormType, PosType};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{pcs, Fr};

fn rand_vec(len: usize, rng: &mut impl Rng) -> Vec<Fr> {
    (0..len).map(|_| Fr::rand(rng)).collect()
}

fn llama_like(d_model: u32, d_ff: u32) -> ModelManifest {
    ModelManifest {
        family: "llama-test".into(),
        n_layers: 1,
        d_model,
        n_heads: 4,
        n_kv_heads: 2,
        d_ff,
        vocab_size: 256,
        norm: NormType::RmsNorm,
        act: ActType::SwiGLU,
        pos: PosType::Rope,
        quant: "q8_0".into(),
    }
}

struct Fixture {
    cfg: FfnConfig,
    x: Vec<Fr>,
    wgate: Vec<Fr>,
    wup: Vec<Fr>,
    wdown: Vec<Fr>,
}

fn fixture(seq: usize, d_model: u32, d_ff: u32) -> Fixture {
    let mut rng = test_rng();
    let m = llama_like(d_model, d_ff);
    let cfg = FfnConfig::from_manifest(&m, seq);
    Fixture {
        x: rand_vec(seq * d_model as usize, &mut rng),
        wgate: rand_vec((d_model * d_ff) as usize, &mut rng),
        wup: rand_vec((d_model * d_ff) as usize, &mut rng),
        wdown: rand_vec((d_ff * d_model) as usize, &mut rng),
        cfg,
    }
}

#[test]
fn honest_ffn_verifies_and_lists_obligations() {
    for &(seq, d_model, d_ff) in &[(2usize, 4u32, 8u32), (4, 8, 16), (1, 2, 4)] {
        let f = fixture(seq, d_model, d_ff);
        let (proof, out) = prove_ffn(
            &f.cfg, &f.x, &f.wgate, &f.wup, &f.wdown, None, None, None, &mut Transcript::new(b"ffn"),
        );
        assert!(
            verify_ffn(
                &f.cfg, &f.x, &f.wgate, &f.wup, &f.wdown, &out, &proof, None, None, None,
                &mut Transcript::new(b"ffn")
            ),
            "honest FFN seq={seq} d_model={d_model} d_ff={d_ff} should verify"
        );
        // Placeholder path: norm + activation remain pending obligations.
        assert_eq!(proof.obligations.len(), 2);
        assert_eq!(proof.obligations[0].op, "rmsnorm");
        assert_eq!(proof.obligations[1].op, "silu");
        assert!(proof.p_norm.is_none());
        assert!(proof.act_lookup.is_none());
    }
}

#[test]
fn tampered_output_is_rejected() {
    let f = fixture(4, 8, 16);
    let (proof, mut out) = prove_ffn(
        &f.cfg, &f.x, &f.wgate, &f.wup, &f.wdown, None, None, None, &mut Transcript::new(b"ffn"),
    );
    out[0] += Fr::from(1u64);
    assert!(
        !verify_ffn(
            &f.cfg, &f.x, &f.wgate, &f.wup, &f.wdown, &out, &proof, None, None, None,
            &mut Transcript::new(b"ffn")
        ),
        "tampered residual output must be rejected"
    );
}

#[test]
fn tampered_gating_is_rejected() {
    let f = fixture(4, 8, 16);
    let (mut proof, out) = prove_ffn(
        &f.cfg, &f.x, &f.wgate, &f.wup, &f.wdown, None, None, None, &mut Transcript::new(b"ffn"),
    );
    // Corrupt the gated hidden state h — the Hadamard proof must reject.
    proof.h[3] += Fr::from(5u64);
    assert!(
        !verify_ffn(
            &f.cfg, &f.x, &f.wgate, &f.wup, &f.wdown, &out, &proof, None, None, None,
            &mut Transcript::new(b"ffn")
        ),
        "tampered gated hidden state must be rejected"
    );
}

#[test]
fn tampered_projection_is_rejected() {
    let f = fixture(4, 8, 16);
    let (mut proof, out) = prove_ffn(
        &f.cfg, &f.x, &f.wgate, &f.wup, &f.wdown, None, None, None, &mut Transcript::new(b"ffn"),
    );
    // Corrupt the gate projection output — its matmul proof must reject.
    proof.gate[2] += Fr::from(9u64);
    assert!(
        !verify_ffn(
            &f.cfg, &f.x, &f.wgate, &f.wup, &f.wdown, &out, &proof, None, None, None,
            &mut Transcript::new(b"ffn")
        ),
        "tampered gate projection must be rejected"
    );
}

// ─── Quantized mode: activation obligation discharged by a sound lookup ────────

use xfuel_zkp::activation::{encode_i64, ActKind, ActivationTable};
use xfuel_zkp::ffn::RequantParams;
use xfuel_zkp::norm::RsqrtTable;
use xfuel_zkp::range::RangeTable;

/// Small-code fixture: gate = xn·Wgate must land inside the activation domain, so xn and Wgate are
/// built from tiny non-negative integers.
fn quant_fixture(seq: usize, d_model: usize, d_ff: usize, domain: usize) -> (FfnConfig, Vec<Fr>, Vec<Fr>, Vec<Fr>, Vec<Fr>) {
    let m = llama_like(d_model as u32, d_ff as u32);
    let cfg = FfnConfig::from_manifest(&m, seq);
    // xn entries in {0,1}, Wgate/Wup entries in {0,1} → gate,up in 0..=d_model < domain.
    let x = vec![Fr::from(1u64); seq * d_model];
    let mut wgate = vec![Fr::from(0u64); d_model * d_ff];
    let mut wup = vec![Fr::from(0u64); d_model * d_ff];
    // Make each gate/up column a small distinct count of ones (< domain).
    for col in 0..d_ff {
        let ones = (col % (d_model.min(domain - 1) + 1)).min(d_model);
        for row in 0..ones {
            wgate[row * d_ff + col] = Fr::from(1u64);
            wup[row * d_ff + col] = Fr::from(1u64);
        }
    }
    let wdown = vec![encode_i64(1); d_ff * d_model];
    (cfg, x, wgate, wup, wdown)
}

#[test]
fn quantized_ffn_discharges_activation_via_lookup() {
    let domain = 16;
    let table = ActivationTable::new(ActKind::Silu, domain, 0.5);
    let (cfg, x, wgate, wup, wdown) = quant_fixture(2, 4, 8, domain);

    let (proof, out) = prove_ffn(
        &cfg, &x, &wgate, &wup, &wdown, Some(&table), None, None, &mut Transcript::new(b"qffn"),
    );
    assert!(proof.act_lookup.is_some(), "quantized mode must produce an activation lookup");
    // Only the norm obligation remains — the activation is now soundly proven.
    assert_eq!(proof.obligations.len(), 1);
    assert_eq!(proof.obligations[0].op, "rmsnorm");

    assert!(
        verify_ffn(
            &cfg, &x, &wgate, &wup, &wdown, &out, &proof, Some(&table), None, None,
            &mut Transcript::new(b"qffn")
        ),
        "honest quantized FFN must verify"
    );
}

#[test]
fn quantized_ffn_rejects_tampered_activation() {
    let domain = 16;
    let table = ActivationTable::new(ActKind::Silu, domain, 0.5);
    let (cfg, x, wgate, wup, wdown) = quant_fixture(2, 4, 8, domain);

    let (mut proof, out) = prove_ffn(
        &cfg, &x, &wgate, &wup, &wdown, Some(&table), None, None, &mut Transcript::new(b"qffn"),
    );
    // Forge an activation output that is not act(gate): the lookup must reject.
    proof.act[0] = encode_i64(7);
    assert!(
        !verify_ffn(
            &cfg, &x, &wgate, &wup, &wdown, &out, &proof, Some(&table), None, None,
            &mut Transcript::new(b"qffn")
        ),
        "tampered activation output must be rejected by the lookup"
    );
}

#[test]
fn quantized_proof_rejected_by_placeholder_verify() {
    let domain = 16;
    let table = ActivationTable::new(ActKind::Silu, domain, 0.5);
    let (cfg, x, wgate, wup, wdown) = quant_fixture(2, 4, 8, domain);
    let (proof, out) = prove_ffn(
        &cfg, &x, &wgate, &wup, &wdown, Some(&table), None, None, &mut Transcript::new(b"qffn"),
    );
    // Mode mismatch: verifying a quantized (activation) proof without the table must fail.
    assert!(
        !verify_ffn(&cfg, &x, &wgate, &wup, &wdown, &out, &proof, None, None, None, &mut Transcript::new(b"qffn")),
        "activation mode mismatch must be rejected"
    );
}

// ─── Quantized mode + sound RMSNorm: a full FFN block with zero pending obligations ────

/// RMSNorm parameters chosen so `inv_rms = 1` for the fixture's `ss = d_model`, i.e. `xn = x`,
/// keeping the projection outputs inside the activation domain.
fn identity_rsqrt(d_model: usize) -> RsqrtTable {
    // out_code(s) = round(out_scale / sqrt(s + eps)); pick out_scale = sqrt(d_model), eps = 0 →
    // out_code(d_model) = round(sqrt(d_model)/sqrt(d_model)) = 1.
    RsqrtTable::new(64, (d_model as f64).sqrt(), 0.0)
}

#[test]
fn quantized_ffn_with_norm_has_zero_obligations() {
    let act_domain = 16;
    let table_act = ActivationTable::new(ActKind::Silu, act_domain, 0.5);
    let rsqrt = identity_rsqrt(4);
    // Sanity: inv_rms for ss = d_model = 4 must be 1 so xn = x.
    assert_eq!(rsqrt.apply(&[Fr::from(4u64)])[0], Fr::from(1u64));

    let (cfg, x, wgate, wup, wdown) = quant_fixture(2, 4, 8, act_domain);
    let w_norm = vec![Fr::from(1u64); 4];
    let np = NormParams { weight: &w_norm, table: &rsqrt };

    let (proof, out) = prove_ffn(
        &cfg, &x, &wgate, &wup, &wdown, Some(&table_act), None, Some(&np), &mut Transcript::new(b"qffn"),
    );
    assert!(proof.p_norm.is_some(), "quantized norm must produce an RMSNorm proof");
    assert!(proof.act_lookup.is_some(), "quantized mode must produce an activation lookup");
    assert!(
        proof.obligations.is_empty(),
        "a quantized FFN with sound norm + activation has zero pending obligations"
    );

    assert!(
        verify_ffn(
            &cfg, &x, &wgate, &wup, &wdown, &out, &proof, Some(&table_act), None, Some(&np),
            &mut Transcript::new(b"qffn")
        ),
        "honest quantized FFN (norm + activation) must verify"
    );
}

#[test]
fn quantized_ffn_rejects_tampered_norm() {
    let act_domain = 16;
    let table_act = ActivationTable::new(ActKind::Silu, act_domain, 0.5);
    let rsqrt = identity_rsqrt(4);
    let (cfg, x, wgate, wup, wdown) = quant_fixture(2, 4, 8, act_domain);
    let w_norm = vec![Fr::from(1u64); 4];
    let np = NormParams { weight: &w_norm, table: &rsqrt };

    let (mut proof, out) = prove_ffn(
        &cfg, &x, &wgate, &wup, &wdown, Some(&table_act), None, Some(&np), &mut Transcript::new(b"qffn"),
    );
    // Forge the norm's inv_rms advice — the RMSNorm gadget (lookup + scaling Hadamard) must reject.
    proof.p_norm.as_mut().unwrap().inv_rms[0] += Fr::from(1u64);
    assert!(
        !verify_ffn(
            &cfg, &x, &wgate, &wup, &wdown, &out, &proof, Some(&table_act), None, Some(&np),
            &mut Transcript::new(b"qffn")
        ),
        "tampered RMSNorm advice must be rejected"
    );
}

// ─── M5.3: wide gate accumulator → proven requant → activation → zero obligations ────

/// A fixture whose gate projection yields a **wide** accumulator (values up to `q_bound·D`), so the
/// activation cannot run on it directly — it must be requantized into `[0, q_bound)` first. `xn = x`
/// (identity RMSNorm), `up = 1`, and each gate column `j` carries the single wide code `wide[j]`
/// (row 0 of `Wgate`; since `xn = 1`, `gate[.,j] = wide[j]`).
fn wide_gate_fixture(
    seq: usize,
    d_model: usize,
    d_ff: usize,
    wide: &[u64],
) -> (FfnConfig, Vec<Fr>, Vec<Fr>, Vec<Fr>, Vec<Fr>) {
    assert_eq!(wide.len(), d_ff);
    let m = llama_like(d_model as u32, d_ff as u32);
    let cfg = FfnConfig::from_manifest(&m, seq);
    let x = vec![Fr::from(1u64); seq * d_model];
    let mut wgate = vec![Fr::from(0u64); d_model * d_ff];
    let mut wup = vec![Fr::from(0u64); d_model * d_ff];
    for j in 0..d_ff {
        wgate[j] = Fr::from(wide[j]); // row 0, col j
        wup[j] = Fr::from(1u64); //     up[.,j] = 1
    }
    let wdown = vec![encode_i64(1); d_ff * d_model];
    (cfg, x, wgate, wup, wdown)
}

#[test]
fn quantized_ffn_requant_bridges_wide_gate_to_activation() {
    // The full M5.3 closure: gate = xn·Wgate is a wide integer accumulator; the requant gadget
    // proves gate_q = ⌊gate/4⌋ ∈ [0,16), the activation lookup runs on gate_q, and the RMSNorm is
    // sound — so the FFN has ZERO pending obligations with a real wide→code hop proven.
    let (divisor, q_bound) = (4usize, 16usize);
    let (r_table, q_table) = (RangeTable::new(divisor), RangeTable::new(q_bound));
    let rp = RequantParams { bias: Fr::from(0u64), divisor, r_table: &r_table, q_table: &q_table };

    let act = ActivationTable::new(ActKind::Silu, q_bound, 0.5);
    let rsqrt = identity_rsqrt(4);
    let w_norm = vec![Fr::from(1u64); 4];
    let np = NormParams { weight: &w_norm, table: &rsqrt };

    // Wide gate codes in [0,64): requant ⌊·/4⌋ → [0,16).
    let wide = [3u64, 12, 60, 40, 8, 44, 16, 28];
    let (cfg, x, wgate, wup, wdown) = wide_gate_fixture(2, 4, 8, &wide);

    let (proof, out) = prove_ffn(
        &cfg, &x, &wgate, &wup, &wdown, Some(&act), Some(&rp), Some(&np),
        &mut Transcript::new(b"wide"),
    );
    assert!(proof.p_requant.is_some(), "the wide→code requant hop must be proven");
    // gate_q = ⌊wide/4⌋, repeated per row.
    let per_row: Vec<Fr> = wide.iter().map(|&w| Fr::from(w / 4)).collect();
    let expect_q: Vec<Fr> = (0..2).flat_map(|_| per_row.clone()).collect();
    assert_eq!(proof.gate_q.as_ref().unwrap(), &expect_q, "gate_q must be ⌊gate/D⌋");
    assert!(
        proof.obligations.is_empty(),
        "a proven wide→code requant + sound norm + activation ⇒ zero pending obligations"
    );

    assert!(
        verify_ffn(
            &cfg, &x, &wgate, &wup, &wdown, &out, &proof, Some(&act), Some(&rp), Some(&np),
            &mut Transcript::new(b"wide")
        ),
        "fully-quantized FFN with a proven wide→code requant hop must verify"
    );
}

#[test]
fn requant_mode_mismatch_is_rejected() {
    // A requant-proven FFN must not verify when the verifier omits the requant params (and vice
    // versa) — the wide→code hop is part of the statement.
    let (divisor, q_bound) = (4usize, 16usize);
    let (r_table, q_table) = (RangeTable::new(divisor), RangeTable::new(q_bound));
    let rp = RequantParams { bias: Fr::from(0u64), divisor, r_table: &r_table, q_table: &q_table };
    let act = ActivationTable::new(ActKind::Silu, q_bound, 0.5);
    let rsqrt = identity_rsqrt(4);
    let w_norm = vec![Fr::from(1u64); 4];
    let np = NormParams { weight: &w_norm, table: &rsqrt };
    let wide = [3u64, 12, 60, 40, 8, 44, 16, 28];
    let (cfg, x, wgate, wup, wdown) = wide_gate_fixture(2, 4, 8, &wide);

    let (proof, out) = prove_ffn(
        &cfg, &x, &wgate, &wup, &wdown, Some(&act), Some(&rp), Some(&np),
        &mut Transcript::new(b"wide"),
    );
    assert!(
        !verify_ffn(
            &cfg, &x, &wgate, &wup, &wdown, &out, &proof, Some(&act), None, Some(&np),
            &mut Transcript::new(b"wide")
        ),
        "verifying a requant-proven FFN without requant params must be rejected"
    );
}

#[test]
fn norm_mode_mismatch_is_rejected() {
    let act_domain = 16;
    let table_act = ActivationTable::new(ActKind::Silu, act_domain, 0.5);
    let rsqrt = identity_rsqrt(4);
    let (cfg, x, wgate, wup, wdown) = quant_fixture(2, 4, 8, act_domain);
    let w_norm = vec![Fr::from(1u64); 4];
    let np = NormParams { weight: &w_norm, table: &rsqrt };

    let (proof, out) = prove_ffn(
        &cfg, &x, &wgate, &wup, &wdown, Some(&table_act), None, Some(&np), &mut Transcript::new(b"qffn"),
    );
    // Verifying a norm-proven proof without norm params (or vice versa) must fail.
    assert!(
        !verify_ffn(
            &cfg, &x, &wgate, &wup, &wdown, &out, &proof, Some(&table_act), None, None,
            &mut Transcript::new(b"qffn")
        ),
        "norm mode mismatch must be rejected"
    );
}

// ─── Committed (succinct) FFN — M5.4b ─────────────────────────────────────────

/// SRS large enough for every FFN tensor width: the rsqrt table domain (64 → 6 vars) dominates the
/// (2,4,8) fixture.
fn ffn_srs() -> pcs::Params {
    pcs::setup(6, &mut test_rng())
}

/// The fully-quantized committed FFN inputs: a wide gate accumulator + requant into [0,16), an
/// identity RMSNorm (`xn = x`), and a SiLU activation table. Mirrors the wide-gate plain fixture.
#[allow(clippy::type_complexity)]
fn committed_ffn_inputs() -> (
    FfnConfig,
    Vec<Fr>,
    Vec<Fr>,
    Vec<Fr>,
    Vec<Fr>,
    RangeTable,
    RangeTable,
    ActivationTable,
    RsqrtTable,
    Vec<Fr>,
) {
    let (divisor, q_bound) = (4usize, 16usize);
    let (r_table, q_table) = (RangeTable::new(divisor), RangeTable::new(q_bound));
    let act = ActivationTable::new(ActKind::Silu, q_bound, 0.5);
    let rsqrt = identity_rsqrt(4);
    let w_norm = vec![Fr::from(1u64); 4];
    let wide = [3u64, 12, 60, 40, 8, 44, 16, 28];
    let (cfg, x, wgate, wup, wdown) = wide_gate_fixture(2, 4, 8, &wide);
    (cfg, x, wgate, wup, wdown, r_table, q_table, act, rsqrt, w_norm)
}

#[test]
fn committed_ffn_verifies() {
    let (cfg, x, wgate, wup, wdown, r_table, q_table, act, rsqrt, w_norm) = committed_ffn_inputs();
    let rp = RequantParams { bias: Fr::from(0u64), divisor: 4, r_table: &r_table, q_table: &q_table };
    let np = NormParams { weight: &w_norm, table: &rsqrt };
    let params = ffn_srs();

    let (proof, comm_x, comm_out, _out) = prove_committed_ffn(
        &cfg, &x, &wgate, &wup, &wdown, &act, &rp, &np, &params, &mut Transcript::new(b"cffn"),
    );
    assert!(
        verify_committed_ffn(
            &cfg, &wgate, &wup, &wdown, &act, &rp, &np, &comm_x, &comm_out, &proof, &params,
            &mut Transcript::new(b"cffn"),
        ),
        "honest committed FFN (norm → gate/up → requant → act → gate ⊙ up → down → residual) must verify"
    );
}

#[test]
fn committed_ffn_wrong_output_commitment_is_rejected() {
    let (cfg, x, wgate, wup, wdown, r_table, q_table, act, rsqrt, w_norm) = committed_ffn_inputs();
    let rp = RequantParams { bias: Fr::from(0u64), divisor: 4, r_table: &r_table, q_table: &q_table };
    let np = NormParams { weight: &w_norm, table: &rsqrt };
    let params = ffn_srs();

    let (proof, comm_x, _comm_out, out) = prove_committed_ffn(
        &cfg, &x, &wgate, &wup, &wdown, &act, &rp, &np, &params, &mut Transcript::new(b"cffn"),
    );
    let (ck_a, _vk) = pcs::keys(&params, 3); // seq*d_model = 2*4 = 8 → 3 vars
    let mut bad = out.clone();
    bad[0] += Fr::from(1u64);
    let bad_comm_out = pcs::commit(&ck_a, &bad);
    assert!(
        !verify_committed_ffn(
            &cfg, &wgate, &wup, &wdown, &act, &rp, &np, &comm_x, &bad_comm_out, &proof, &params,
            &mut Transcript::new(b"cffn"),
        ),
        "a wrong output commitment must be rejected"
    );
}

#[test]
fn committed_ffn_forged_weight_is_rejected() {
    let (cfg, x, wgate, wup, wdown, r_table, q_table, act, rsqrt, w_norm) = committed_ffn_inputs();
    let rp = RequantParams { bias: Fr::from(0u64), divisor: 4, r_table: &r_table, q_table: &q_table };
    let np = NormParams { weight: &w_norm, table: &rsqrt };
    let params = ffn_srs();

    let (proof, comm_x, comm_out, _out) = prove_committed_ffn(
        &cfg, &x, &wgate, &wup, &wdown, &act, &rp, &np, &params, &mut Transcript::new(b"cffn"),
    );
    // A different Wdown: its recomputed commitment won't match the proof's opening.
    let mut wdown_bad = wdown.clone();
    wdown_bad[0] += Fr::from(1u64);
    assert!(
        !verify_committed_ffn(
            &cfg, &wgate, &wup, &wdown_bad, &act, &rp, &np, &comm_x, &comm_out, &proof, &params,
            &mut Transcript::new(b"cffn"),
        ),
        "a forged Wdown must be rejected"
    );
}

#[test]
fn committed_ffn_tampered_gate_commitment_is_rejected() {
    let (cfg, x, wgate, wup, wdown, r_table, q_table, act, rsqrt, w_norm) = committed_ffn_inputs();
    let rp = RequantParams { bias: Fr::from(0u64), divisor: 4, r_table: &r_table, q_table: &q_table };
    let np = NormParams { weight: &w_norm, table: &rsqrt };
    let params = ffn_srs();

    let (mut proof, comm_x, comm_out, _out) = prove_committed_ffn(
        &cfg, &x, &wgate, &wup, &wdown, &act, &rp, &np, &params, &mut Transcript::new(b"cffn"),
    );
    // The gate commitment is both the gate matmul output and the requant accumulator: swapping it
    // for unrelated data breaks both the projection opening and the requant division identity.
    let (ck_f, _vk) = pcs::keys(&params, 4); // seq*d_ff = 2*8 = 16 → 4 vars
    proof.comm_gate = pcs::commit(&ck_f, &vec![Fr::from(5u64); 16]);
    assert!(
        !verify_committed_ffn(
            &cfg, &wgate, &wup, &wdown, &act, &rp, &np, &comm_x, &comm_out, &proof, &params,
            &mut Transcript::new(b"cffn"),
        ),
        "a tampered gate commitment must be rejected"
    );
}

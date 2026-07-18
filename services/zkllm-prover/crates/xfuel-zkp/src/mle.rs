//! Multilinear-extension (MLE) utilities.
//!
//! A table of `2^d` field values defines a unique multilinear polynomial over `{0,1}^d`; these
//! helpers evaluate it at an arbitrary point and build the `eq` weight vector used throughout the
//! matmul argument.
//!
//! Index/variable convention: a point `r` is ordered **most-significant variable first**, matching
//! row-major index decomposition (a matrix's row bits are the high bits, column bits the low bits).

use crate::Fr;
use ark_ff::{One, Zero};

/// `eq` weights over `{0,1}^n` for a point `r` (len `n`):
/// `eq_weights(r)[i] = Π_b ( r_b if bit_b(i)==1 else 1-r_b )`, with `r[0]` the most-significant bit.
pub fn eq_weights(r: &[Fr]) -> Vec<Fr> {
    let mut cur = vec![Fr::one()];
    for &rv in r {
        let one_minus = Fr::one() - rv;
        let mut next = Vec::with_capacity(cur.len() * 2);
        for &c in &cur {
            next.push(c * one_minus); // this variable's bit = 0
            next.push(c * rv); //        this variable's bit = 1
        }
        cur = next;
    }
    cur
}

/// Inner product of two equal-length field slices.
pub fn inner_product(a: &[Fr], b: &[Fr]) -> Fr {
    debug_assert_eq!(a.len(), b.len());
    let mut acc = Fr::zero();
    for (x, y) in a.iter().zip(b.iter()) {
        acc += *x * *y;
    }
    acc
}

/// Evaluate the MLE of `table` (len `2^point.len()`) at `point`.
pub fn mle_eval(table: &[Fr], point: &[Fr]) -> Fr {
    assert_eq!(table.len(), 1usize << point.len(), "table length must be 2^|point|");
    inner_product(&eq_weights(point), table)
}

/// `eq(r, x) = Π_i ( r_i·x_i + (1-r_i)(1-x_i) )` — the multilinear `eq` polynomial at two points.
pub fn eq_eval(r: &[Fr], x: &[Fr]) -> Fr {
    debug_assert_eq!(r.len(), x.len());
    let mut acc = Fr::one();
    for (ri, xi) in r.iter().zip(x.iter()) {
        acc *= *ri * *xi + (Fr::one() - *ri) * (Fr::one() - *xi);
    }
    acc
}

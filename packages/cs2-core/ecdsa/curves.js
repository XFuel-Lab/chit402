/**
 * Curve orders are parameters. The secp256k1 path receives SECP256K1
 * and never reads P256.order. P-256's order lives only on P256.
 *
 * Both primes are 3 mod 4, so a square root is a^((p+1)/4). Cofactor is 1.
 */

export const P256 = Object.freeze({
  name: 'P-256',
  // FIPS 186-4 P-256. a = -3 mod p.
  p: BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF'),
  a: BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC'),
  b: BigInt('0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B'),
  order: BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551'),
  G: Object.freeze({
    x: BigInt('0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296'),
    y: BigInt('0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5'),
  }),
});

export const SECP256K1 = Object.freeze({
  name: 'secp256k1',
  p: BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F'),
  a: 0n,
  b: 7n,
  order: BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'),
  G: Object.freeze({
    x: BigInt('0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798'),
    y: BigInt('0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8'),
  }),
});

export function curveByName(name) {
  if (name === 'P-256' || name === 'p256') return P256;
  if (name === 'secp256k1' || name === 'k1') return SECP256K1;
  const err = new Error(`unknown curve ${name}`);
  err.code = 'bad_curve';
  throw err;
}

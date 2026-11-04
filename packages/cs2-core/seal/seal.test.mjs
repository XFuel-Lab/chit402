/**
 * HPKE line sealing. RFC 8439 and RFC 9180 vectors, the constant-size
 * blob, and the privacy checks (no plaintext, key, or length in errors).
 * Expected hashes come from the RFCs, from node:crypto, or from the
 * committed vector file. They are not copied out of a passing run of the
 * same assertion.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitments, encodeLine, HEADER_BYTE_0, HEADER_BYTE_1, LINE_BYTES, USED_BYTES } from '../line/index.mjs';
import { SAMPLE } from '../line/sample.mjs';
import { chacha20 } from '@noble/ciphers/chacha.js';
import { poly1305 } from '@noble/ciphers/_poly1305.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { readAeadCalls, readOpenAttempts, resetProbes } from './probe.js';
import {
  DUMMY_RECIPIENT_PK,
  DK_BYTES,
  HEADER_BYTE_0 as sealHeader0,
  HEADER_BYTE_1 as sealHeader1,
  LINE_BYTES as sealLineBytes,
  LINE_CT_BYTES,
  REASONS,
  SEALED_BYTES,
  SLOT_BYTES,
  SLOT_COUNT,
  USED_BYTES as sealUsedBytes,
  dkCommitment,
  lineLeaf,
  lineLeafFromCommitment,
  openLine,
  openLineAny,
  sealLine,
  sealedCommitment,
} from './index.js';
import {
  MODE_AUTH,
  MODE_AUTH_PSK,
  MODE_BASE,
  MODE_PSK,
  aeadOpen,
  aeadSeal,
  computeNonce,
  contextExport,
  contextOpen,
  contextSeal,
  deriveKeyPair,
  releaseContext,
  sealBase,
  setupR,
  setupS,
  zeroDhRejected,
} from './hpke.js';
import { sealLineWithSeed } from './vector.js';
import * as sealApi from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function fromHex(value) {
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

const x25519Public = (sk) => x25519.getPublicKey(sk);
const x25519Mul = (scalar, u) => x25519.scalarMult(scalar, u);

function hmacSha256(key, msg) {
  return hmac(sha256, key, msg);
}

function hkdfExtract(salt, ikm) {
  return extract(sha256, ikm, salt.length === 0 ? undefined : salt);
}

function hkdfExpand(prk, info, length) {
  return expand(sha256, prk, info, length);
}

function chacha20Block(key, counter, nonce) {
  return chacha20(key, nonce, new Uint8Array(64), undefined, counter);
}

function nodeSha256(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function assertClosed(result, reason) {
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
  assert.ok(REASONS.includes(reason));
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'reason']);
  assert.equal(JSON.stringify(result), `{"ok":false,"reason":"${reason}"}`);
}

function assertNoMaterial(result, parts) {
  const text = JSON.stringify(result);
  for (const part of parts) {
    if (!part || part.length < 8) continue;
    assert.equal(text.includes(hex(part)), false);
  }
}

function sampleLine() {
  const encoded = encodeLine(SAMPLE);
  assert.equal(encoded.ok, true);
  return encoded.line;
}

function otherLine() {
  const content = { ...SAMPLE.content, uriPrefix: 'https://example.test/v2' };
  const encoded = encodeLine({ ...SAMPLE, content });
  assert.equal(encoded.ok, true);
  return encoded.line;
}

const BOOK_SK = fromHex('20'.repeat(32));
const RECOVERY_SK = fromHex('30'.repeat(32));
const DK = fromHex('40'.repeat(32));
const ESK = [fromHex('50'.repeat(32)), fromHex('60'.repeat(32))];

function repeatSeal(line, recoverySk = RECOVERY_SK) {
  const bookPk = x25519Public(BOOK_SK);
  const recoveryPk = recoverySk ? x25519Public(recoverySk) : null;
  return sealLineWithSeed(line, bookPk, recoveryPk, { dk: DK.slice(), esk: [ESK[0].slice(), ESK[1].slice()] });
}

test('sha256 and hkdf match the published digests', () => {
  assert.equal(hex(sha256(new Uint8Array())), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex(sha256(new TextEncoder().encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const wide = new Uint8Array(1024);
  for (let i = 0; i < wide.length; i += 1) wide[i] = i & 0xff;
  assert.equal(hex(sha256(wide)), hex(nodeSha256(wide)));

  const mac = hmacSha256(new Uint8Array(20).fill(0x0b), new TextEncoder().encode('Hi There'));
  assert.equal(hex(mac), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');

  const ikm = new Uint8Array(22).fill(0x0b);
  const salt = fromHex('000102030405060708090a0b0c');
  const info = fromHex('f0f1f2f3f4f5f6f7f8f9');
  const prk = hkdfExtract(salt, ikm);
  assert.equal(hex(prk), '077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5');
  assert.equal(
    hex(hkdfExpand(prk, info, 42)),
    '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
  );
  const emptyPrk = hkdfExtract(new Uint8Array(0), ikm);
  assert.equal(hex(emptyPrk), '19ef24a32c717b167f33a91d6f648bdf96596776afdb6377ac434c1c293ccb04');
  assert.equal(
    hex(hkdfExpand(emptyPrk, new Uint8Array(0), 42)),
    '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
  );
});

test('RFC 8439 ChaCha20, Poly1305, and AEAD vectors', () => {
  const key = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const nonce = fromHex('000000000000004a00000000');
  const pt = new TextEncoder().encode("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
  const block = chacha20Block(key, 1, nonce);
  assert.equal(hex(block.subarray(0, 64)), [
    '224f51f3401bd9e12fde276fb8631ded8c131f823d2c06e27e4fcaec9ef3cf78',
    '8a3b0aa372600a92b57974cded2b9334794cba40c63e34cdea212c4cf07d41b7',
  ].join(''));
  const stream = new Uint8Array(pt.length);
  for (let i = 0; i < pt.length; i += 1) stream[i] = pt[i] ^ block[i];
  const second = chacha20Block(key, 2, nonce);
  for (let i = 64; i < pt.length; i += 1) stream[i] = pt[i] ^ second[i - 64];
  assert.equal(hex(stream), [
    '6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0b',
    'f91b65c5524733ab8f593dabcd62b3571639d624e65152ab8f530c359f0861d8',
    '07ca0dbf500d6a6156a38e088a22b65e52bc514d16ccf806818ce91ab7793736',
    '5af90bbf74a35be6b40b8eedf2785e42874d',
  ].join(''));

  const polyKey = fromHex('85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b');
  const msg = new TextEncoder().encode('Cryptographic Forum Research Group');
  assert.equal(hex(poly1305(msg, polyKey)), 'a8061dc1305136c6c22b8baf0c0127a9');

  const macKey = fromHex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
  const macNonce = fromHex('000000000001020304050607');
  assert.equal(
    hex(chacha20Block(macKey, 0, macNonce).subarray(0, 32)),
    '8ad5a08b905f81cc815040274ab29471a833b637e3fd0da508dbb8e2fdd1a646',
  );

  const aeadNonce = fromHex('070000004041424344454647');
  const aad = fromHex('50515253c0c1c2c3c4c5c6c7');
  const sealed = aeadSeal(macKey, aeadNonce, aad, pt);
  assert.equal(hex(sealed.subarray(0, pt.length)), [
    'd31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6',
    '3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b36',
    '92ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc',
    '3ff4def08e4b7a9de576d26586cec64b6116',
  ].join(''));
  assert.equal(hex(sealed.subarray(pt.length)), '1ae10b594f09e26a7e902ecbd0600691');
  const opened = aeadOpen(macKey, aeadNonce, aad, sealed);
  assert.equal(hex(opened), hex(pt));
  const flipped = sealed.slice();
  flipped[flipped.length - 1] ^= 0x01;
  const rejected = aeadOpen(macKey, aeadNonce, aad, flipped);
  assert.equal(rejected, null);
  const wrongAad = aeadOpen(macKey, aeadNonce, fromHex('50515253c0c1c2c3c4c5c6c8'), sealed);
  assert.equal(wrongAad, null);
});

test('RFC 7748 X25519 vectors', () => {
  const alice = fromHex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const bob = fromHex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  assert.equal(hex(x25519Public(alice)), '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
  assert.equal(hex(x25519Public(bob)), 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
  assert.equal(hex(x25519Mul(alice, x25519Public(bob))), '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
  assert.equal(hex(x25519Mul(bob, x25519Public(alice))), '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');

  const pairs = [
    [
      'a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4',
      'e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c',
      'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552',
    ],
    [
      '4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d',
      'e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493',
      '95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957',
    ],
  ];
  for (const [scalar, u, out] of pairs) {
    assert.equal(hex(x25519Mul(fromHex(scalar), fromHex(u))), out);
  }

  let k = fromHex(`09${'00'.repeat(31)}`);
  let u = fromHex(`09${'00'.repeat(31)}`);
  for (let i = 0; i < 1000; i += 1) {
    const next = x25519Mul(k, u);
    if (i === 0) {
      assert.equal(hex(next), '422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079');
    }
    u = k;
    k = next;
  }
  assert.equal(hex(k), '684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51');
});

test('RFC 9180 X25519 HKDF-SHA256 ChaCha20-Poly1305 vectors', () => {
  const doc = JSON.parse(readFileSync(join(HERE, 'vectors/rfc9180-a2.json'), 'utf8'));
  assert.equal(doc.schema, 'chit402.cs2.seal.rfc9180.v1');
  assert.equal(doc.aead_id, 3);
  assert.equal(doc.vectors.length, 4);
  const modes = new Set(doc.vectors.map((row) => row.mode));
  assert.deepEqual([...modes].sort(), [MODE_BASE, MODE_PSK, MODE_AUTH, MODE_AUTH_PSK]);

  for (const vec of doc.vectors) {
    const eph = deriveKeyPair(fromHex(vec.ikmE));
    const recip = deriveKeyPair(fromHex(vec.ikmR));
    assert.equal(eph.ok && hex(eph.sk), vec.skEm, `skE mode ${vec.mode}`);
    assert.equal(eph.ok && hex(eph.pk), vec.pkEm, `pkE mode ${vec.mode}`);
    assert.equal(recip.ok && hex(recip.sk), vec.skRm, `skR mode ${vec.mode}`);
    assert.equal(recip.ok && hex(recip.pk), vec.pkRm, `pkR mode ${vec.mode}`);
    let sender = null;
    if (vec.ikmS) {
      sender = deriveKeyPair(fromHex(vec.ikmS));
      assert.equal(hex(sender.sk), vec.skSm);
      assert.equal(hex(sender.pk), vec.pkSm);
    }
    const info = fromHex(vec.info);
    const psk = vec.psk ? fromHex(vec.psk) : undefined;
    const pskId = vec.psk_id ? fromHex(vec.psk_id) : undefined;
    const send = setupS({
      mode: vec.mode,
      pkR: recip.pk,
      skE: eph.sk,
      skS: sender ? sender.sk : undefined,
      info,
      psk,
      pskId,
    });
    const recv = setupR({
      mode: vec.mode,
      enc: fromHex(vec.enc),
      skR: recip.sk,
      pkS: sender ? sender.pk : undefined,
      info,
      psk,
      pskId,
    });
    try {
      assert.equal(send.ok, true, `setupS ${vec.mode} ${send.reason || ''}`);
      assert.equal(hex(send.enc), vec.enc, `enc ${vec.mode}`);
      assert.equal(hex(send.sharedSecret), vec.shared_secret, `ss ${vec.mode}`);
      assert.equal(hex(send.keyScheduleContext), vec.key_schedule_context, `ksc ${vec.mode}`);
      assert.equal(hex(send.secret), vec.secret, `secret ${vec.mode}`);
      assert.equal(hex(send.key), vec.key, `key ${vec.mode}`);
      assert.equal(hex(send.baseNonce), vec.base_nonce, `nonce ${vec.mode}`);
      assert.equal(hex(send.exporterSecret), vec.exporter_secret, `exp ${vec.mode}`);
      assert.equal(recv.ok, true, `setupR ${vec.mode}`);
      assert.equal(hex(recv.key), vec.key);

      assert.equal(vec.encryptions.length, 257);
      for (let i = 0; i < vec.encryptions.length; i += 1) {
        const row = vec.encryptions[i];
        const aad = fromHex(row.aad);
        const pt = fromHex(row.pt);
        assert.equal(hex(computeNonce(send.baseNonce, i)), row.nonce, `nonce ${vec.mode}:${i}`);
        const ct = contextSeal(send, aad, pt);
        assert.equal(ct.ok, true);
        assert.equal(hex(ct.ct), row.ct, `ct ${vec.mode}:${i}`);
        const flipped = fromHex(row.ct);
        flipped[0] ^= 0x01;
        const rejected = contextOpen(recv, aad, flipped);
        assert.equal(JSON.stringify(rejected), '{"ok":false,"reason":"open_failed"}');
        const back = contextOpen(recv, aad, fromHex(row.ct));
        assert.equal(back.ok, true);
        assert.equal(hex(back.pt), row.pt);
      }
      for (const row of vec.exports) {
        const exported = contextExport(recv, fromHex(row.exporter_context), row.L);
        assert.equal(exported.ok, true);
        assert.equal(hex(exported.bytes), row.exported_value, `export ${vec.mode}`);
      }
    } finally {
      releaseContext(send);
      releaseContext(recv);
      eph.sk.fill(0);
      recip.sk.fill(0);
      if (sender) sender.sk.fill(0);
    }
  }

  const probe = deriveKeyPair(fromHex('09'.repeat(32)));
  const inconsistent = setupS({
    mode: MODE_BASE,
    pkR: probe.pk,
    skE: probe.sk,
    psk: new Uint8Array(32).fill(2),
    pskId: new Uint8Array(0),
  });
  assertClosed(inconsistent, 'bad_key');
  const baseWithPsk = setupS({
    mode: MODE_BASE,
    pkR: probe.pk,
    skE: probe.sk,
    psk: new Uint8Array(32).fill(2),
    pskId: Uint8Array.of(1),
  });
  assertClosed(baseWithPsk, 'bad_key');
  const missing = setupS({ mode: MODE_PSK, pkR: probe.pk, skE: probe.sk });
  assertClosed(missing, 'bad_key');
  const zeroPk = setupS({ mode: MODE_BASE, pkR: new Uint8Array(32), skE: probe.sk });
  assertClosed(zeroPk, 'bad_key');
  assertNoMaterial(zeroPk, [probe.sk]);
});

const PINNED_TARBALLS = Object.freeze({
  '@noble/ciphers': '4a398bcc280c8742d474f9162f6d3c153e52ab1078e8ab592b4720410fb3c3e9',
  '@noble/curves': '55279c71b0201d6c0e58d0206d15825359e02a3932f326ba7b7909ac2d334aa9',
  '@noble/hashes': 'e1946149b780017b2564fcc092cb01c04e1d7f20627d0296c17da8868f4436dc',
});

const PINNED_FILES = Object.freeze([
  'node_modules/@noble/ciphers/LICENSE',
  'node_modules/@noble/ciphers/_arx.js',
  'node_modules/@noble/ciphers/_poly1305.js',
  'node_modules/@noble/ciphers/chacha.js',
  'node_modules/@noble/ciphers/package.json',
  'node_modules/@noble/ciphers/utils.js',
  'node_modules/@noble/curves/LICENSE',
  'node_modules/@noble/curves/abstract/curve.js',
  'node_modules/@noble/curves/abstract/edwards.js',
  'node_modules/@noble/curves/abstract/fft.js',
  'node_modules/@noble/curves/abstract/frost.js',
  'node_modules/@noble/curves/abstract/hash-to-curve.js',
  'node_modules/@noble/curves/abstract/modular.js',
  'node_modules/@noble/curves/abstract/montgomery.js',
  'node_modules/@noble/curves/abstract/oprf.js',
  'node_modules/@noble/curves/ed25519.js',
  'node_modules/@noble/curves/package.json',
  'node_modules/@noble/curves/utils.js',
  'node_modules/@noble/hashes/LICENSE',
  'node_modules/@noble/hashes/_md.js',
  'node_modules/@noble/hashes/_u64.js',
  'node_modules/@noble/hashes/hkdf.js',
  'node_modules/@noble/hashes/hmac.js',
  'node_modules/@noble/hashes/package.json',
  'node_modules/@noble/hashes/sha2.js',
  'node_modules/@noble/hashes/utils.js',
]);

const PINS_SHA256 = '67854087de05eecdd299d8dc94a340f6c3cebad669f5350944fc421efc7b8201';

function walkFiles(dir, prefix) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs, rel));
    else out.push(rel);
  }
  return out;
}

test('vendored primitives are hash-pinned and free of Node-only crypto', () => {
  const pinsPath = join(HERE, 'vendor/PINS.json');
  const pinsBytes = new Uint8Array(readFileSync(pinsPath));
  assert.equal(hex(sha256(pinsBytes)), PINS_SHA256);
  const pins = JSON.parse(new TextDecoder().decode(pinsBytes));
  assert.equal(pins.schema, 'chit402.cs2.seal.vendor-pins.v1');
  assert.equal(pins.alg, 'sha256');
  const packages = [...pins.packages].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(packages.map((pkg) => `${pkg.name}@${pkg.version}`), [
    '@noble/ciphers@2.4.0',
    '@noble/curves@2.4.0',
    '@noble/hashes@2.4.0',
  ]);
  for (const pkg of packages) {
    assert.equal(pkg.tarball_sha256, PINNED_TARBALLS[pkg.name], pkg.name);
    assert.match(pkg.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
  }
  const names = Object.keys(pins.files).sort();
  assert.deepEqual(names, [...PINNED_FILES]);
  const onDisk = walkFiles(join(HERE, 'node_modules/@noble'), 'node_modules/@noble').sort();
  assert.deepEqual(onDisk, names);
  for (const name of names) {
    const bytes = new Uint8Array(readFileSync(join(HERE, name)));
    assert.equal(hex(sha256(bytes)), pins.files[name], name);
    const text = new TextDecoder().decode(bytes);
    assert.equal(/from\s+['"]node:/.test(text), false, name);
    assert.equal(/require\s*\(/.test(text), false, name);
  }
  const glue = ['index.js', 'core.js', 'hpke.js', 'vector.js'];
  const banned = [
    /node:/,
    /require\s*\(/,
    /from\s+['"]crypto['"]/,
    /\bBuffer\b/,
    /\bprocess\b/,
    /\bconsole\b/,
    /Math\.random/,
    /\.\.\/line/,
    /\.\.\/merkle/,
    /\.\.\/ecdsa/,
    /\.\.\/smt/,
  ];
  for (const file of glue) {
    const text = readFileSync(join(HERE, file), 'utf8');
    for (const pattern of banned) assert.equal(pattern.test(text), false, `${file} ${pattern}`);
  }
  assert.equal(readdirSync(join(HERE, 'vendor')).includes('PINS.json'), true);
});

test('seal constants match the line codec layout', () => {
  assert.equal(LINE_BYTES, 1024);
  assert.equal(sealLineBytes, LINE_BYTES);
  assert.equal(sealHeader0, HEADER_BYTE_0);
  assert.equal(sealHeader1, HEADER_BYTE_1);
  assert.equal(sealUsedBytes, USED_BYTES);
  assert.equal(HEADER_BYTE_0, 0x63);
  assert.equal(HEADER_BYTE_1, 0x32);
  assert.equal(USED_BYTES, 803);
  assert.equal(SEALED_BYTES, 1200);
  assert.equal(LINE_CT_BYTES, 1040);
  assert.equal(SLOT_BYTES, 80);
  assert.equal(SLOT_COUNT, 2);
  assert.equal(DK_BYTES, 32);
  assert.equal((1040 + (2 * 80)), 1200);
});

test('golden seal vectors open and match the committed blob', () => {
  const doc = JSON.parse(readFileSync(join(HERE, 'vectors/seal.json'), 'utf8'));
  assert.equal(doc.schema, 'chit402.cs2.seal.v1');
  assert.equal(doc.aead, 'ChaCha20-Poly1305');
  assert.equal(doc.sealed_bytes, 1200);
  const line = sampleLine();
  assert.equal(hex(line), doc.line_hex);
  for (const row of doc.cases) {
    const bookPk = x25519Public(fromHex(row.book_sk));
    assert.equal(hex(bookPk), row.book_pk);
    const recoveryPk = row.recovery_sk ? x25519Public(fromHex(row.recovery_sk)) : null;
    if (recoveryPk) assert.equal(hex(recoveryPk), row.recovery_pk);
    const sealed = sealLineWithSeed(line, bookPk, recoveryPk, {
      dk: fromHex(row.dk),
      esk: [fromHex(row.esk0), fromHex(row.esk1)],
    });
    assert.equal(sealed.ok, true, sealed.reason);
    assert.equal(sealed.sealed.length, 1200);
    assert.equal(hex(sealed.sealed), row.sealed);
    assert.equal(hex(sealed.dkCommitment), row.dk_commitment);
    assert.equal(hex(sealed.sealedCommitment), row.sealed_commitment);
    assert.deepEqual(Object.keys(sealed).sort(), ['dkCommitment', 'ok', 'sealed', 'sealedCommitment']);
    const opened = openLine(sealed.sealed, fromHex(row.book_sk), 0);
    assert.equal(opened.ok, true);
    assert.equal(hex(opened.line), hex(line));
    const again = sealLineWithSeed(line, bookPk, recoveryPk, {
      dk: fromHex(row.dk),
      esk: [fromHex(row.esk0), fromHex(row.esk1)],
    });
    assert.equal(hex(again.sealed), row.sealed);
  }
});

test('the sealed blob is a constant 1,200 bytes', () => {
  const first = repeatSeal(sampleLine());
  const second = repeatSeal(otherLine());
  const dummy = repeatSeal(sampleLine(), null);
  assert.equal(first.ok && second.ok && dummy.ok, true);
  assert.equal(first.sealed.length, 1200);
  assert.equal(second.sealed.length, 1200);
  assert.equal(dummy.sealed.length, 1200);
  assert.notEqual(hex(first.sealed), hex(second.sealed));
  assert.notEqual(hex(first.sealed), hex(dummy.sealed));
  const randomA = sealLine(sampleLine(), x25519Public(BOOK_SK), x25519Public(RECOVERY_SK));
  const randomB = sealLine(sampleLine(), x25519Public(BOOK_SK), x25519Public(RECOVERY_SK));
  assert.equal(randomA.sealed.length, 1200);
  assert.equal(randomB.sealed.length, 1200);
  assert.notEqual(hex(randomA.sealed), hex(randomB.sealed));
  assert.equal(openLine(randomA.sealed, BOOK_SK, 0).ok, true);
  assert.equal(openLine(randomB.sealed, RECOVERY_SK, 1).ok, true);
});

test('wrong key, swapped slot, swapped ciphertext, and truncated blob fail closed', () => {
  const line = sampleLine();
  const sealed = repeatSeal(line);
  const other = sealLineWithSeed(otherLine(), x25519Public(BOOK_SK), x25519Public(RECOVERY_SK), {
    dk: fromHex('45'.repeat(32)),
    esk: [fromHex('55'.repeat(32)), fromHex('65'.repeat(32))],
  });
  assert.equal(sealed.ok && other.ok, true);
  const wrong = openLine(sealed.sealed, fromHex('71'.repeat(32)), 0);
  assertClosed(wrong, 'open_failed');
  const shortKey = openLine(sealed.sealed, fromHex('71'.repeat(31)), 0);
  assertClosed(shortKey, 'bad_key');

  const swappedSlots = sealed.sealed.slice();
  const slot0 = swappedSlots.slice(1040, 1120);
  const slot1 = swappedSlots.slice(1120, 1200);
  swappedSlots.set(slot1, 1040);
  swappedSlots.set(slot0, 1120);
  assertClosed(openLine(swappedSlots, BOOK_SK, 0), 'open_failed');
  assertClosed(openLine(swappedSlots, RECOVERY_SK, 1), 'open_failed');
  assertClosed(openLine(swappedSlots, BOOK_SK, 1), 'open_failed');
  assertClosed(openLine(swappedSlots, RECOVERY_SK, 0), 'open_failed');

  const swappedCt = sealed.sealed.slice();
  swappedCt.set(other.sealed.subarray(0, 1040), 0);
  assertClosed(openLine(swappedCt, BOOK_SK, 0), 'open_failed');
  assertClosed(openLine(swappedCt, RECOVERY_SK, 1), 'open_failed');

  const lengths = [0, 1, 80, 1040, 1199, 1201, 2400];
  const texts = lengths.map((n) => {
    const buf = new Uint8Array(n);
    buf.set(sealed.sealed.subarray(0, Math.min(n, sealed.sealed.length)));
    const result = openLine(buf, BOOK_SK, 0);
    assertClosed(result, 'bad_length');
    assert.equal(JSON.stringify(result).includes(String(n)), false);
    return JSON.stringify(result);
  });
  assert.equal(new Set(texts).size, 1);
  assert.equal(texts[0], texts[lengths.indexOf(1199)]);
});

test('a different dk label in the line AAD does not open', () => {
  const line = sampleLine();
  const sealed = repeatSeal(line);
  assert.equal(sealed.ok, true);
  const commit = dkCommitment(DK);
  assert.equal(commit.ok, true);
  assert.equal(hex(commit.bytes), hex(nodeSha256(Buffer.from('dk'), DK)));
  assert.equal(hex(sealed.dkCommitment), hex(commit.bytes));
  const ct = sealed.sealed.subarray(0, 1040);
  const opened = aeadOpen(DK, new Uint8Array(12), commit.bytes, ct);
  assert.equal(hex(opened), hex(line));
  const wrongLabel = nodeSha256(Buffer.from('dx'), DK);
  assert.equal(aeadOpen(DK, new Uint8Array(12), wrongLabel, ct), null);
  const flipped = commit.bytes.slice();
  flipped[0] ^= 0x01;
  assert.equal(aeadOpen(DK, new Uint8Array(12), flipped, ct), null);

  const blob = sealed.sealed.slice();
  const otherDk = fromHex('42'.repeat(32));
  const wrapped = sealBase(
    x25519Public(BOOK_SK),
    new TextEncoder().encode('chit402-seal-v1'),
    Uint8Array.of(0),
    otherDk,
    fromHex('53'.repeat(32)),
  );
  assert.equal(wrapped.ok, true);
  blob.set(wrapped.enc, 1040);
  blob.set(wrapped.ct, 1072);
  const rejected = openLine(blob, BOOK_SK, 0);
  assertClosed(rejected, 'open_failed');
  assertNoMaterial(rejected, [line, DK, otherDk, BOOK_SK]);
});

test('errors and logs carry no plaintext, key, or length', () => {
  const line = sampleLine();
  const sealed = repeatSeal(line);
  const calls = [];
  const names = ['log', 'info', 'warn', 'error', 'debug'];
  const previous = {};
  for (const name of names) {
    previous[name] = console[name];
    console[name] = (...args) => { calls.push([name, args]); };
  }
  try {
    const failures = [
      openLine(sealed.sealed, fromHex('81'.repeat(32)), 0),
      openLine(sealed.sealed.subarray(0, 1199), BOOK_SK, 0),
      openLine(sealed.sealed, BOOK_SK, 2),
      sealLine(line.subarray(0, 100), x25519Public(BOOK_SK), null),
      sealLine('line', x25519Public(BOOK_SK), null),
      sealLine(line, new Uint8Array(32), null),
    ];
    for (const result of failures) {
      assert.equal(result.ok, false);
      assert.match(JSON.stringify(result), /^\{"ok":false,"reason":"[a-z_]+"\}$/);
      assertNoMaterial(result, [line, DK, BOOK_SK, RECOVERY_SK, sealed.sealed]);
    }
    assert.equal(calls.length, 0);
  } finally {
    for (const name of names) console[name] = previous[name];
  }

  const fresh = sealLineWithSeed(line, x25519Public(BOOK_SK), x25519Public(RECOVERY_SK), {
    dk: DK.slice(),
    esk: [ESK[0].slice(), ESK[1].slice()],
  });
  assert.equal(includesBytes(fresh.sealed, line), false);
  assert.equal(includesBytes(fresh.sealed, DK), false);
  assert.equal(includesBytes(fresh.sealed, BOOK_SK), false);
  assert.equal(includesBytes(fresh.sealed, RECOVERY_SK), false);
});

function includesBytes(hay, needle) {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i <= hay.length - needle.length; i += 1) {
    let same = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }
  return false;
}

test('a missing recovery key still uses two slots and the dummy recipient', () => {
  const line = sampleLine();
  const dummyOracle = nodeSha256(Buffer.from('chit402-dummy-x25519-v1'));
  dummyOracle[31] &= 0x7f;
  assert.equal(hex(DUMMY_RECIPIENT_PK), hex(dummyOracle));
  assert.equal(DUMMY_RECIPIENT_PK[31] & 0x80, 0);

  const sealed = repeatSeal(line, null);
  assert.equal(sealed.ok, true);
  assert.equal(sealed.sealed.length, 1200);
  const book = openLine(sealed.sealed, BOOK_SK, 0);
  assert.equal(book.ok, true);
  assert.equal(hex(book.line), hex(line));
  assertClosed(openLine(sealed.sealed, BOOK_SK, 1), 'open_failed');
  assertClosed(openLine(sealed.sealed, RECOVERY_SK, 1), 'open_failed');
  assertClosed(openLine(sealed.sealed, fromHex('11'.repeat(32)), 1), 'open_failed');
  const any = openLineAny(sealed.sealed, BOOK_SK);
  assert.equal(any.ok, true);
  assert.equal(any.slot, 0);
  assert.equal(hex(any.line), hex(line));
  assertClosed(openLineAny(sealed.sealed, fromHex('12'.repeat(32))), 'open_failed');

  const real = repeatSeal(line, RECOVERY_SK);
  const asRecovery = openLineAny(real.sealed, RECOVERY_SK);
  assert.equal(asRecovery.ok, true);
  assert.equal(asRecovery.slot, 1);
  assert.equal(hex(asRecovery.line), hex(line));
  assertClosed(openLine(real.sealed, RECOVERY_SK, 0), 'open_failed');
  assertClosed(openLine(real.sealed, BOOK_SK, 1), 'open_failed');
});

test('slot index is bound into the wrap, so identical recipients cannot be swapped', () => {
  const line = sampleLine();
  const bookPk = x25519Public(BOOK_SK);
  const sealed = sealLineWithSeed(line, bookPk, bookPk, {
    dk: DK.slice(),
    esk: [ESK[0].slice(), ESK[1].slice()],
  });
  assert.equal(sealed.ok, true);
  assert.equal(openLine(sealed.sealed, BOOK_SK, 0).ok, true);
  assert.equal(openLine(sealed.sealed, BOOK_SK, 1).ok, true);
  const swapped = sealed.sealed.slice();
  const a = swapped.slice(1040, 1120);
  const b = swapped.slice(1120, 1200);
  swapped.set(b, 1040);
  swapped.set(a, 1120);
  assertClosed(openLine(swapped, BOOK_SK, 0), 'open_failed');
  assertClosed(openLine(swapped, BOOK_SK, 1), 'open_failed');
});

test('a line that is not the fixed layout is rejected without echoing it', () => {
  const line = sampleLine();
  const bookPk = x25519Public(BOOK_SK);
  const badHeader = line.slice();
  badHeader[0] = 0;
  const header = sealLineWithSeed(badHeader, bookPk, null, { dk: DK.slice(), esk: [ESK[0].slice(), ESK[1].slice()] });
  assertClosed(header, 'bad_header');
  assertNoMaterial(header, [badHeader, DK]);
  const badSecond = line.slice();
  badSecond[1] = 0;
  assertClosed(sealLineWithSeed(badSecond, bookPk, null, { dk: DK.slice(), esk: [ESK[0].slice(), ESK[1].slice()] }), 'bad_header');

  const badPad = line.slice();
  badPad[900] = 1;
  const pad = sealLineWithSeed(badPad, bookPk, null, { dk: DK.slice(), esk: [ESK[0].slice(), ESK[1].slice()] });
  assertClosed(pad, 'bad_padding');
  assert.equal(JSON.stringify(pad).includes('900'), false);

  const dk = fromHex('43'.repeat(32));
  const aad = nodeSha256(Buffer.from('dk'), dk);
  const junk = new Uint8Array(1024);
  junk[0] = 0x63;
  junk[1] = 0x32;
  junk[900] = 9;
  const lineCt = aeadSeal(dk, new Uint8Array(12), aad, junk);
  const slot0 = sealBase(bookPk, new TextEncoder().encode('chit402-seal-v1'), Uint8Array.of(0), dk, ESK[0]);
  const slot1 = sealBase(DUMMY_RECIPIENT_PK, new TextEncoder().encode('chit402-seal-v1'), Uint8Array.of(1), dk, ESK[1]);
  assert.equal(slot0.ok && slot1.ok, true);
  const blob = new Uint8Array(1200);
  blob.set(lineCt, 0);
  blob.set(slot0.enc, 1040);
  blob.set(slot0.ct, 1072);
  blob.set(slot1.enc, 1120);
  blob.set(slot1.ct, 1152);
  const opened = openLine(blob, BOOK_SK, 0);
  assertClosed(opened, 'open_failed');
  assert.equal(Object.hasOwn(opened, 'line'), false);
  assertNoMaterial(opened, [junk, dk]);
});

test('the leaf binds C, the dk commitment, and the sealed blob', () => {
  const line = sampleLine();
  const sealed = repeatSeal(line);
  assert.equal(sealed.ok, true);
  const commit = commitments(line);
  assert.equal(commit.ok, true);
  const leaf = lineLeaf(commit.C, sealed.sealed, DK);
  assert.equal(leaf.ok, true);
  assert.equal(hex(leaf.dkCommitment), hex(sealed.dkCommitment));
  assert.equal(hex(leaf.sealedCommitment), hex(nodeSha256(sealed.sealed)));
  const oracle = nodeSha256(
    Buffer.from([0x00]),
    Buffer.from('line'),
    commit.C,
    nodeSha256(Buffer.from('dk'), DK),
    nodeSha256(sealed.sealed),
  );
  assert.equal(hex(leaf.bytes), hex(oracle));
  const doc = JSON.parse(readFileSync(join(HERE, 'vectors/seal.json'), 'utf8'));
  assert.equal(hex(leaf.bytes), doc.cases[0].leaf);
  const fromOpened = lineLeafFromCommitment(commit.C, sealed.sealed, sealed.dkCommitment);
  assert.equal(fromOpened.ok, true);
  assert.equal(hex(fromOpened.bytes), doc.cases[0].leaf);
  assert.equal(hex(lineLeaf(commit.C, sealed.sealed, DK).bytes), hex(fromOpened.bytes));
  assertClosed(lineLeaf(commit.C, sealed.sealed, new Uint8Array(31)), 'bad_key');
  assertClosed(lineLeafFromCommitment(commit.C, sealed.sealed, new Uint8Array(31)), 'bad_key');
  assertClosed(lineLeafFromCommitment(commit.C, sealed.sealed, 'nope'), 'bad_type');
  assertClosed(lineLeafFromCommitment(new Uint8Array(31), sealed.sealed, sealed.dkCommitment), 'bad_key');
  const callerCommitment = sealed.dkCommitment.slice();
  const aliased = lineLeafFromCommitment(commit.C, sealed.sealed, callerCommitment);
  const kept = aliased.dkCommitment[0];
  callerCommitment[0] ^= 0xff;
  assert.equal(aliased.dkCommitment[0], kept);
  const otherC = commit.C.slice();
  otherC[0] ^= 0x01;
  assert.notEqual(hex(lineLeaf(otherC, sealed.sealed, DK).bytes), hex(leaf.bytes));
  const otherDk = fromHex('44'.repeat(32));
  assert.notEqual(hex(lineLeaf(commit.C, sealed.sealed, otherDk).bytes), hex(leaf.bytes));
  assert.deepEqual(Object.keys(leaf).sort(), ['bytes', 'dkCommitment', 'ok', 'sealedCommitment']);
});

test('bad inputs stay inside the fixed reason set', () => {
  const line = sampleLine();
  const bookPk = x25519Public(BOOK_SK);
  assertClosed(sealLine(null, bookPk, null), 'bad_type');
  assertClosed(sealLine(line.subarray(0, 100), bookPk, null), 'bad_length');
  assertClosed(sealLine(new Uint8Array(1200), bookPk, null), 'bad_length');
  assertClosed(sealLine(line, bookPk, fromHex('aa')), 'bad_key');
  assertClosed(sealLine(line, bookPk, null, null), 'bad_type');
  assertClosed(sealLine(line, bookPk, null, { dk: DK.slice(), esk: [ESK[0].slice(), ESK[1].slice()] }), 'bad_type');
  assertClosed(sealLineWithSeed(line, bookPk, null, { dk: new Uint8Array(32), esk: [ESK[0].slice(), ESK[1].slice()] }), 'bad_key');
  assertClosed(sealLineWithSeed(line, bookPk, null, { dk: DK.slice(), esk: [ESK[0]] }), 'bad_type');
  assertClosed(openLine(new Uint8Array(1200), BOOK_SK, 0), 'open_failed');
  assertClosed(openLine(new Uint8Array(1200), BOOK_SK, 2), 'bad_type');
  assertClosed(openLine('blob', BOOK_SK, 0), 'bad_type');
  assertClosed(dkCommitment(fromHex('aa')), 'bad_key');
  assertClosed(sealedCommitment(new Uint8Array(1199)), 'bad_length');
  assertClosed(lineLeaf(new Uint8Array(31), new Uint8Array(1200), DK), 'bad_key');
  assert.equal(Object.hasOwn(sealApi, 'sealLineWithSeed'), false);
  assert.equal(Object.hasOwn(sealApi, 'readOpenAttempts'), false);
});

function xorBytes(a, b) {
  const out = new Uint8Array(Math.min(a.length, b.length));
  for (let i = 0; i < out.length; i += 1) out[i] = a[i] ^ b[i];
  return out;
}

function encAt(sealed, slot) {
  const at = 1040 + (slot * 80);
  return sealed.slice(at, at + 32);
}

test('fresh seals do not reuse dk, ephemeral keys, or keystream', () => {
  const bookPk = x25519Public(BOOK_SK);
  const recoveryPk = x25519Public(RECOVERY_SK);
  const line = sampleLine();
  const first = sealLine(line, bookPk, recoveryPk);
  const second = sealLine(line, bookPk, recoveryPk);
  assert.equal(first.ok && second.ok, true);
  assert.equal(first.sealed.length, 1200);
  assert.notEqual(hex(first.sealed.subarray(0, 1040)), hex(second.sealed.subarray(0, 1040)));
  assert.notEqual(hex(first.dkCommitment), hex(second.dkCommitment));
  const encs = [encAt(first.sealed, 0), encAt(first.sealed, 1), encAt(second.sealed, 0), encAt(second.sealed, 1)];
  const distinct = new Set(encs.map(hex));
  assert.equal(distinct.size, 4);
  assert.notEqual(hex(encs[0]), hex(encs[1]));
  assert.notEqual(hex(encs[2]), hex(encs[3]));
  const opened = openLine(first.sealed, BOOK_SK, 0);
  assert.equal(opened.ok, true);
  assert.equal(hex(opened.dkCommitment), hex(first.dkCommitment));
  assert.equal(Object.hasOwn(opened, 'line'), true);

  const other = sealLine(otherLine(), bookPk, recoveryPk);
  assert.equal(other.ok, true);
  const ctXor = xorBytes(first.sealed.subarray(0, 1024), other.sealed.subarray(0, 1024));
  const lineXor = xorBytes(line, otherLine());
  assert.notEqual(hex(ctXor), hex(lineXor));

  const cryptoObj = globalThis.crypto;
  const saved = cryptoObj.getRandomValues;
  cryptoObj.getRandomValues = (buf) => {
    buf.fill(7);
    return buf;
  };
  try {
    const left = sealLine(line, bookPk, recoveryPk);
    const right = sealLine(line, bookPk, recoveryPk);
    assert.equal(left.ok && right.ok, true);
    assert.equal(hex(left.sealed), hex(right.sealed));
    assert.equal(hex(encAt(left.sealed, 0)), hex(encAt(left.sealed, 1)));
  } finally {
    cryptoObj.getRandomValues = saved;
  }
});

test('openLineAny always opens both slots', () => {
  const sealed = sealLine(sampleLine(), x25519Public(BOOK_SK), x25519Public(RECOVERY_SK));
  assert.equal(sealed.ok, true);
  resetProbes();
  const opened = openLineAny(sealed.sealed, BOOK_SK);
  assert.equal(opened.ok, true);
  assert.equal(opened.slot, 0);
  assert.equal(hex(opened.dkCommitment), hex(sealed.dkCommitment));
  assert.equal(readOpenAttempts(), 2);
  resetProbes();
  const recovery = openLineAny(sealed.sealed, RECOVERY_SK);
  assert.equal(recovery.ok, true);
  assert.equal(recovery.slot, 1);
  assert.equal(readOpenAttempts(), 2);
});

test('receiver-side zero-DH check refuses low-order encapsulated keys', () => {
  assert.equal(zeroDhRejected(new Uint8Array(32)), true);
  assert.equal(zeroDhRejected(null), true);
  assert.equal(zeroDhRejected(Uint8Array.of(1)), false);
  const probe = deriveKeyPair(fromHex('09'.repeat(32)));
  assert.equal(probe.ok, true);
  const P = (1n << 255n) - 19n;
  const points = [
    0n,
    1n,
    P - 1n,
    325606250916557431795983626356110631294008115727848805560023387167927233504n,
    39382357235489614581723060781553021112529911719440698176882885853963445705823n,
    P,
    P + 1n,
  ];
  for (const point of points) {
    const enc = new Uint8Array(32);
    let value = point;
    for (let i = 0; i < 32; i += 1) {
      enc[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    let result;
    assert.doesNotThrow(() => {
      result = setupR({ mode: MODE_BASE, enc, skR: probe.sk, info: new Uint8Array(0) });
    });
    assertClosed(result, 'open_failed');
    assertNoMaterial(result, [probe.sk, enc]);
  }
});

function dkLabelHash(dk) {
  const labeled = new Uint8Array(2 + dk.length);
  labeled[0] = 0x64;
  labeled[1] = 0x6b;
  labeled.set(dk, 2);
  return sha256(labeled);
}

function blobUnderRetiredFallback(line) {
  const dk = new Uint8Array(32).fill(0x11);
  const ct = aeadSeal(dk, new Uint8Array(12), dkLabelHash(dk), line);
  dk.fill(0);
  assert.ok(ct);
  assert.equal(ct.length, LINE_CT_BYTES);
  const blob = new Uint8Array(SEALED_BYTES);
  blob.set(ct, 0);
  globalThis.crypto.getRandomValues(blob.subarray(LINE_CT_BYTES));
  return blob;
}

test('decryption is not authenticity; only the leaf binds the blob to the book', () => {
  const bookPk = x25519Public(BOOK_SK);
  const line = sampleLine();
  const other = otherLine();
  const commit = commitments(line);
  assert.equal(commit.ok, true);
  const honest = sealLineWithSeed(line, bookPk, x25519Public(RECOVERY_SK), {
    dk: DK.slice(),
    esk: [ESK[0].slice(), ESK[1].slice()],
  });
  assert.equal(honest.ok, true);
  const doc = JSON.parse(readFileSync(join(HERE, 'vectors/seal.json'), 'utf8'));
  const bookLeaf = lineLeafFromCommitment(commit.C, honest.sealed, honest.dkCommitment);
  assert.equal(bookLeaf.ok, true);
  assert.equal(hex(bookLeaf.bytes), doc.cases[0].leaf);
  const openedHonest = openLine(honest.sealed, BOOK_SK, 0);
  assert.equal(openedHonest.ok, true);
  assert.equal(
    hex(lineLeafFromCommitment(commit.C, honest.sealed, openedHonest.dkCommitment).bytes),
    doc.cases[0].leaf,
  );

  const pasted = sealLineWithSeed(other, bookPk, null, {
    dk: fromHex('45'.repeat(32)),
    esk: [fromHex('52'.repeat(32)), fromHex('62'.repeat(32))],
  });
  assert.equal(pasted.ok, true);
  const spliced = honest.sealed.slice();
  spliced.set(pasted.sealed.subarray(0, LINE_CT_BYTES), 0);
  assertClosed(openLine(spliced, BOOK_SK, 0), 'open_failed');

  const tampered = honest.sealed.slice();
  tampered[LINE_CT_BYTES + SLOT_BYTES] ^= 0x01;
  const openedTampered = openLine(tampered, BOOK_SK, 0);
  assert.equal(openedTampered.ok, true);
  assert.equal(hex(openedTampered.line), hex(line));
  const tamperedLeaf = lineLeafFromCommitment(commit.C, tampered, openedTampered.dkCommitment);
  assert.equal(tamperedLeaf.ok, true);
  assert.notEqual(hex(tamperedLeaf.bytes), hex(bookLeaf.bytes));

  const strangerDk = fromHex('46'.repeat(32));
  const forged = sealLineWithSeed(other, bookPk, null, {
    dk: strangerDk,
    esk: [fromHex('53'.repeat(32)), fromHex('63'.repeat(32))],
  });
  assert.equal(forged.ok, true);
  const forgedOpen = openLine(forged.sealed, BOOK_SK, 0);
  assert.equal(forgedOpen.ok, true);
  assert.equal(hex(forgedOpen.line), hex(other));
  assert.equal(Object.hasOwn(forgedOpen, 'line'), true);
  const otherCommit = commitments(other);
  assert.equal(otherCommit.ok, true);
  const forgedLeaf = lineLeafFromCommitment(otherCommit.C, forged.sealed, forgedOpen.dkCommitment);
  assert.equal(forgedLeaf.ok, true);
  assert.equal(hex(forgedLeaf.bytes), hex(lineLeaf(otherCommit.C, forged.sealed, strangerDk).bytes));
  assert.notEqual(hex(forgedLeaf.bytes), hex(bookLeaf.bytes));
});

test('a line sealed under the retired public fallback key does not open', () => {
  const line = sampleLine();
  const blob = blobUnderRetiredFallback(line);
  const key = new Uint8Array(32);
  globalThis.crypto.getRandomValues(key);
  assertClosed(openLine(blob, key, 0), 'open_failed');
  assertClosed(openLine(blob, key, 1), 'open_failed');
  assertClosed(openLineAny(blob, key), 'open_failed');
  assertClosed(openLine(blob, BOOK_SK, 0), 'open_failed');
  key.fill(0);
});

test('a failed unwrap cannot return a line sealed under the fallback draw', () => {
  const line = sampleLine();
  const blob = blobUnderRetiredFallback(line);
  const key = new Uint8Array(32);
  globalThis.crypto.getRandomValues(key);
  const cryptoObj = globalThis.crypto;
  const saved = cryptoObj.getRandomValues;
  cryptoObj.getRandomValues = (buf) => {
    buf.fill(0x11);
    return buf;
  };
  try {
    const opened = openLine(blob, key, 0);
    assertClosed(opened, 'open_failed');
    assert.equal(Object.hasOwn(opened, 'line'), false);
    assertClosed(openLine(blob, key, 1), 'open_failed');
    assertClosed(openLineAny(blob, key), 'open_failed');
  } finally {
    cryptoObj.getRandomValues = saved;
    key.fill(0);
  }
});

test('a failed slot unwrap still runs the line AEAD', () => {
  const sealed = sealLine(sampleLine(), x25519Public(BOOK_SK), x25519Public(RECOVERY_SK));
  assert.equal(sealed.ok, true);
  const wrong = new Uint8Array(32).fill(0x5a);
  resetProbes();
  assertClosed(openLine(sealed.sealed, wrong, 0), 'open_failed');
  assert.equal(readAeadCalls(), 1);
  resetProbes();
  assertClosed(openLine(sealed.sealed, wrong, 1), 'open_failed');
  assert.equal(readAeadCalls(), 1);
});

test('the seed entry and the probe counters are not imported outside tests and vector.js', () => {
  const repo = join(HERE, '../../..');
  const seedName = 'sealLine' + 'WithSeed';
  const fromSeed = 'seal' + 'FromSeed';
  const retired = 'FALLBACK' + '_DK';
  const allowSeedName = new Set([
    'packages/cs2-core/seal/vector.js',
    'packages/cs2-core/seal/seal.test.mjs',
  ]);
  const allowFromSeed = new Set([
    'packages/cs2-core/seal/core.js',
    'packages/cs2-core/seal/vector.js',
  ]);
  const allowProbe = new Set([
    'packages/cs2-core/seal/core.js',
    'packages/cs2-core/seal/probe.js',
    'packages/cs2-core/seal/seal.test.mjs',
  ]);
  const allowCoreImport = new Set([
    'packages/cs2-core/seal/index.js',
    'packages/cs2-core/seal/vector.js',
  ]);
  const files = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'coverage']);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(js|mjs|cjs|ts|tsx)$/.test(name)) files.push(abs);
    }
  };
  walk(repo);
  assert.ok(files.length > 10);
  for (const abs of files) {
    const rel = abs.slice(repo.length + 1).replaceAll('\\', '/');
    const src = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    if (src.includes(seedName)) assert.ok(allowSeedName.has(rel), rel);
    if (src.includes(fromSeed)) assert.ok(allowFromSeed.has(rel), rel);
    if (src.includes(retired)) assert.fail(rel);
    if (rel === 'packages/cs2-core/seal/core.js') {
      assert.equal(/fill\(0x11\)/.test(src), false);
    }
    if (/from\s+['"][^'"]*probe\.js['"]/.test(src)) assert.ok(allowProbe.has(rel), rel);
    if (/from\s+['"][^'"]*vector\.js['"]/.test(src)) {
      assert.equal(rel, 'packages/cs2-core/seal/seal.test.mjs');
    }
    if (rel.startsWith('packages/cs2-core/seal/') && /from\s+['"]\.\/core\.js['"]/.test(src)) {
      assert.ok(allowCoreImport.has(rel), rel);
    }
    if (!rel.startsWith('packages/cs2-core/seal/') && /seal\/core\.js/.test(src)) {
      assert.fail(rel);
    }
    const readsCounters = /readOpenAttempts|readAeadCalls|resetProbes|resetOpenAttempts/.test(src);
    if (readsCounters) {
      assert.ok(
        rel === 'packages/cs2-core/seal/probe.js' || rel === 'packages/cs2-core/seal/seal.test.mjs',
        rel,
      );
    }
  }
});

test('a full-length two-dk collision opens one slot and fails the other on padding', () => {
  const doc = JSON.parse(readFileSync(join(HERE, 'vectors/aead-collision.json'), 'utf8'));
  assert.equal(doc.schema, 'chit402.cs2.seal.aead-collision.v1');
  const sealed = fromHex(doc.sealed);
  const dk1 = fromHex(doc.dk1);
  const dk2 = fromHex(doc.dk2);
  const nonce = fromHex(doc.nonce);
  const lineCt = sealed.subarray(0, LINE_CT_BYTES);
  assert.equal(lineCt.length, 1040);
  assert.equal(sealed.length, SEALED_BYTES);
  const aad1 = sha256(Buffer.concat([Buffer.from('dk'), dk1]));
  const aad2 = sha256(Buffer.concat([Buffer.from('dk'), dk2]));
  const pt1 = aeadOpen(dk1, nonce, aad1, lineCt);
  const pt2 = aeadOpen(dk2, nonce, aad2, lineCt);
  assert.ok(pt1 && pt2);
  assert.equal(hex(pt1), doc.pt1);
  assert.equal(hex(pt2), doc.pt2);
  assert.equal(pt1[0], 0x63);
  assert.equal(pt1[1], 0x32);
  assert.equal(pt2[0], 0x63);
  assert.equal(pt2[1], 0x32);
  assert.equal(pt1.subarray(USED_BYTES).every((b) => b === 0), true);
  assert.equal(pt2.subarray(USED_BYTES).some((b) => b !== 0), true);
  assert.equal(aeadOpen(dk1, nonce, aad2, lineCt), null);
  const book = openLine(sealed, fromHex(doc.book_sk), 0);
  assert.equal(book.ok, true);
  assert.equal(hex(book.line), doc.pt1);
  const commit = commitments(book.line);
  assert.equal(commit.ok, true);
  const leaf = lineLeafFromCommitment(commit.C, sealed, book.dkCommitment);
  assert.equal(leaf.ok, true);
  assert.equal(hex(leaf.bytes), hex(lineLeaf(commit.C, sealed, dk1).bytes));
  assertClosed(openLine(sealed, fromHex(doc.recovery_sk), 1), 'open_failed');
  const any = openLineAny(sealed, fromHex(doc.book_sk));
  assert.equal(any.ok, true);
  assert.equal(any.slot, 0);
  assert.equal(hex(any.line), doc.pt1);
  assertClosed(openLineAny(sealed, fromHex(doc.recovery_sk)), 'open_failed');
});

test('the HPKE context refuses a reused sequence and an invalid mode', () => {
  const probe = deriveKeyPair(fromHex('09'.repeat(32)));
  assert.equal(probe.ok, true);
  for (const mode of [4, 7, 9, -1, 0.5, 256]) {
    assertClosed(setupS({ mode, pkR: probe.pk, skE: probe.sk }), 'bad_key', `mode ${mode}`);
  }
  const badPskMode = setupS({
    mode: 9,
    pkR: probe.pk,
    skE: probe.sk,
    psk: new Uint8Array(32).fill(2),
    pskId: Uint8Array.of(1),
  });
  assertClosed(badPskMode, 'bad_key');
  const info = new Uint8Array(0);
  const aad = new Uint8Array(0);
  const pt = Uint8Array.of(1, 2, 3, 4);
  const send = setupS({ mode: MODE_BASE, pkR: probe.pk, skE: fromHex('11'.repeat(32)), info });
  const recvFresh = setupR({ mode: MODE_BASE, enc: send.enc, skR: probe.sk, info });
  assert.equal(send.ok, true);
  assert.equal(recvFresh.ok, true);
  let freshCt;
  assert.doesNotThrow(() => {
    freshCt = contextSeal(send, aad, pt);
  });
  assert.equal(freshCt.ok, true);
  assert.ok(freshCt.ct instanceof Uint8Array);
  let freshOpen;
  assert.doesNotThrow(() => {
    freshOpen = contextOpen(recvFresh, aad, freshCt.ct);
  });
  assert.equal(freshOpen.ok, true);
  assert.equal(hex(freshOpen.pt), hex(pt));
  const sendB = setupS({ mode: MODE_BASE, pkR: probe.pk, skE: fromHex('13'.repeat(32)), info });
  const recvB = setupR({ mode: MODE_BASE, enc: sendB.enc, skR: probe.sk, info });
  assertClosed(contextSeal(sendB, aad, 'not-bytes'), 'open_failed');
  const afterFail = contextSeal(sendB, aad, pt);
  assert.equal(afterFail.ok, true);
  const openedAtZero = contextOpen(recvB, aad, afterFail.ct);
  assert.equal(openedAtZero.ok, true);
  assert.equal(hex(openedAtZero.pt), hex(pt));
  const copy = { ...sendB };
  assert.throws(() => contextSeal(copy, aad, Uint8Array.of(1)), /closed context/);
  const sendC = setupS({ mode: MODE_BASE, pkR: probe.pk, skE: fromHex('14'.repeat(32)), info });
  const first = contextSeal(sendC, aad, Uint8Array.of(1, 2, 3, 4));
  const second = contextSeal(sendC, aad, Uint8Array.of(5, 6, 7, 8));
  assert.equal(first.ok && second.ok, true);
  assert.notEqual(hex(first.ct), hex(second.ct));
  assert.throws(() => contextSeal(copy, aad, Uint8Array.of(1)), /closed context/);
  const recv = setupR({ mode: MODE_BASE, enc: sendC.enc, skR: probe.sk, info });
  assert.equal(recv.ok, true);
  assertClosed(contextOpen(recv, aad, second.ct), 'open_failed');
  const opened = contextOpen(recv, aad, first.ct);
  assert.equal(opened.ok, true);
  assert.equal(hex(opened.pt), hex(Uint8Array.of(1, 2, 3, 4)));
  assertClosed(contextOpen(recv, aad, first.ct), 'open_failed');
  const flipped = second.ct.slice();
  flipped[0] ^= 0x01;
  assertClosed(contextOpen(recv, aad, flipped), 'open_failed');
  const retry = contextOpen(recv, aad, second.ct);
  assert.equal(retry.ok, true);
  assert.equal(hex(retry.pt), hex(Uint8Array.of(5, 6, 7, 8)));
  assertClosed(contextExport(recv, new Uint8Array(0), (255 * 32) + 1), 'open_failed');
  assertClosed(contextExport(recv, new Uint8Array(0), -1), 'open_failed');
  assertClosed(contextExport(recv, new Uint8Array(0), 1.5), 'open_failed');
  assertClosed(contextExport(recv, 'nope', 16), 'bad_type');
  releaseContext(sendC);
  releaseContext(recv);
  assert.throws(() => contextSeal(sendC, aad, Uint8Array.of(9)), /closed context/);
  assert.throws(() => contextOpen(recv, aad, first.ct), /closed context/);
  assert.throws(() => contextExport(recv, new Uint8Array(0), 16), /closed context/);
  assert.equal(sendC.key, undefined);
  assert.equal(sendC.baseNonce, undefined);
  releaseContext(send);
  releaseContext(sendB);
  releaseContext(recvFresh);
  releaseContext(recvB);
  probe.sk.fill(0);
});

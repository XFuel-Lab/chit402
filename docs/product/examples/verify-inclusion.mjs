// node verify-inclusion.mjs <receipt_id> [base]   Node 18+, no dependencies, GET only. Prints one JSON line.
import { createHash } from 'node:crypto';
const [id, base = 'https://api.chit402.com'] = process.argv.slice(2);
const done = (o) => { console.log(JSON.stringify({ id, ...o })); process.exit(o.ok ? 0 : 1); };
const fail = (reason, extra = {}) => done({ ok: false, reason, ...extra });
const get = async (p) => { const r = await fetch(base + p); const b = await r.json().catch(() => ({})); if (!r.ok) fail(b.error || b.status || `http_${r.status}`, { path: p }); return b; };
const H = (...b) => createHash('sha256').update(Buffer.concat(b)).digest();
const node = (l, r) => H(Buffer.from([0x01]), l, r); // leaf would be H(0x00 || "task_id|row_hash")
const hex = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
try {
  const inc = await get(`/v1/receipts/${id}/inclusion`), shell = await get(`/receipt/${id}?format=json`);
  if (!Array.isArray(inc.proof)) fail(inc.status || 'no_proof');
  const { leaf_index: i, tree_size: n, leaf, root } = inc;
  if (!Number.isSafeInteger(i) || !Number.isSafeInteger(n) || i < 0 || i >= n) fail('bad_index');
  if (!hex(leaf) || !hex(root) || !inc.proof.every((s) => hex(s?.hash))) fail('bad_hash');
  if (!shell.inclusion?.leaf_hash) fail('shell_missing_leaf_hash');
  if (shell.inclusion.leaf_hash !== leaf) fail('shell_leaf_mismatch');
  let h = Buffer.from(leaf, 'hex'), fn = i, sn = n - 1; // RFC 9162 inclusion check
  for (const s of inc.proof) {
    if (sn === 0) fail('extra_proof_steps');
    const left = fn % 2 === 1 || fn === sn, sib = Buffer.from(s.hash, 'hex');
    if (s.position !== (left ? 'left' : 'right')) fail('position_mismatch');
    h = left ? node(sib, h) : node(h, sib);
    if (left) while (fn % 2 === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
    fn >>= 1; sn >>= 1;
  }
  const computed = h.toString('hex'), ok = sn === 0 && computed === root;
  done({ ok, ...(ok ? {} : { reason: sn !== 0 ? 'short_proof' : 'root_mismatch' }), task_id: inc.task_id, leaf_index: i, tree_size: n, leaf, computed_root: computed, published_root: root, anchor_tx: inc.anchor_tx ?? null });
} catch (e) { fail('error', { message: String(e?.message || e) }); }

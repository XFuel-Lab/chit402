// node verify-inclusion.mjs <receipt_id> [base]   Node 18+, no dependencies, GET only.
import { createHash } from 'node:crypto';
const [id, base = 'https://api.chit402.com'] = process.argv.slice(2);
const get = async (p) => { const r = await fetch(base + p); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };
const H = (...b) => createHash('sha256').update(Buffer.concat(b)).digest();
const node = (l, r) => H(Buffer.from([0x01]), l, r); // leaf would be H(0x00 || "task_id|row_hash")
const shell = await get(`/receipt/${id}?format=json`);
const inc = await get(`/v1/receipts/${id}/inclusion`);
if (inc.status !== 'anchored' && !inc.proof) throw new Error(`no proof: ${inc.status}`);
if (shell.inclusion?.leaf_hash && shell.inclusion.leaf_hash !== inc.leaf) throw new Error('shell leaf != inclusion leaf');
let h = Buffer.from(inc.leaf, 'hex'), fn = inc.leaf_index, sn = inc.tree_size - 1; // RFC 9162 inclusion check
for (const s of inc.proof) {
  const left = fn % 2 === 1 || fn === sn, sib = Buffer.from(s.hash, 'hex');
  if (s.position !== (left ? 'left' : 'right')) throw new Error('position label disagrees with index');
  h = left ? node(sib, h) : node(h, sib);
  if (left) while (fn % 2 === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
  fn >>= 1; sn >>= 1;
}
const ok = sn === 0 && h.toString('hex') === inc.root;
console.log(JSON.stringify({ id, task_id: inc.task_id, leaf_index: inc.leaf_index, tree_size: inc.tree_size, leaf: inc.leaf, computed_root: h.toString('hex'), published_root: inc.root, anchor_tx: inc.anchor_tx ?? null, ok }));
process.exit(ok ? 0 : 1);

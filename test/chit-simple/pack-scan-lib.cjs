const { readdirSync, readFileSync, statSync } = require('fs');
const path = require('path');

const PACK = path.join(__dirname, '../../deploy/chit-simple/sepolia-pack');
const FIXTURES = path.join(__dirname, 'fixtures/key-scan');
const SKIP = new Set(['out', 'cache', 'broadcast']);

// Pinned hashes and topic0 values. A 64-hex string outside this set is rejected.
const ALLOW_64 = [
  'cd66271f37f16d9a2b526a63c539875ed3b56904cd2014ba0e1cd4aa33a0e080',
  'bc37f50aefd1f20e30781db115c88ea4bb3263e504eb6e61653fb9e4f1b7b75e',
  '95d3ad0e28a557ff091289f350472166359808c1308277737cd6cc7cacc4e8b3',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  '1ec6130d39d03ed3b8bce8139d615ffe17377a1cf2cab8f4b7bf98f45dda27b0',
];

const allowAlt = ALLOW_64.join('|');
// 0x + 64 digits, or a bare 64-digit run. The prefix is not part of the run,
// so a pinned hash written as 0x<hash> is not a second, unlisted run.
const RAW_HEX = new RegExp(
  '(?<![0-9a-fA-F])(?:0x(?!' + allowAlt + ')[0-9a-fA-F]{64}(?![0-9a-fA-F])|(?!0x)(?!' + allowAlt + ')[0-9a-fA-F]{64}(?![0-9a-fA-F]))',
  'i',
);

const PATTERNS = [
  { id: 'raw-hex', re: RAW_HEX, msg: 'raw 64-hex outside the allowlist' },
  { id: 'private-key', re: /--private-key\b/, msg: '--private-key' },
  { id: 'mnemonic', re: /--mnemonic\b/, msg: '--mnemonic' },
  { id: 'mnemonics', re: /--mnemonics\b/, msg: '--mnemonics' },
  { id: 'interactive', re: /--interactive\b/, msg: '--interactive' },
  { id: 'interactives', re: /--interactives\b/, msg: '--interactives' },
  { id: 'password', re: /--password\b/, msg: '--password' },
  { id: 'pk-suffix', re: /\b[A-Za-z][A-Za-z0-9]*_PK\b/, msg: '*_PK' },
  { id: 'deployer-pk', re: /\bDEPLOYER_PK\b/, msg: 'DEPLOYER_PK' },
  { id: 'eth-private-key', re: /\bETH_PRIVATE_KEY\b/, msg: 'ETH_PRIVATE_KEY' },
  { id: 'private-env', re: /\bPRIVATE_KEY\b/, msg: 'PRIVATE_KEY' },
  { id: 'env-uint', re: /\bvm\s*\.\s*envUint\b/, msg: 'vm.envUint' },
  { id: 'broadcast-key', re: /\bvm\s*\.\s*startBroadcast\s*\(\s*[^)\s]/, msg: 'vm.startBroadcast( with an argument' },
];

function loadFixture(id) {
  return readFileSync(path.join(FIXTURES, `${id}.txt`), 'utf8');
}

function packFiles() {
  const acc = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) acc.push(full);
    }
  };
  walk(PACK);
  return acc;
}

function keptSources() {
  return {
    'pinned-hash': `0x${ALLOW_64[0]}`,
    'empty-broadcast': 'vm.startBroadcast();',
  };
}

module.exports = { PATTERNS, ALLOW_64, loadFixture, packFiles, keptSources, PACK };

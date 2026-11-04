# Line sealing

`seal/index.js` seals a fixed-size line to two HPKE recipient slots. Node resolves `@noble/hashes`, `@noble/ciphers`, and `@noble/curves` from `seal/node_modules`.

A browser page does not resolve those bare specifiers on its own. Load the module through an import map or a bundler that maps `@noble/*` to the same files. The glue and the pinned packages use `globalThis.crypto` and do not use Node built-ins.

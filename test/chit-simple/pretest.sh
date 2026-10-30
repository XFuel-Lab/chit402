#!/bin/sh
# Prepare files forge test reads. Does not broadcast and does not take a key.
set -eu
cd "$(dirname "$0")"
mkdir -p cache
node pack-consistency.mjs cache/consistency.bin
node ../../deploy/chit-simple/sepolia-pack/print-runtime.mjs \
  0x1111111111111111111111111111111111111111 \
  0 \
  0x2222222222222222222222222222222222222222 \
  > cache/pack-preview.txt
node --test pack-scan.test.mjs

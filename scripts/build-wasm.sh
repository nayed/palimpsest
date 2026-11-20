#!/usr/bin/env bash
# Builds the core for the browser: web/src/wasm/pkg/ (not committed).
# Needs the wasm32-unknown-unknown target and wasm-bindgen-cli at the same
# version as the wasm-bindgen crate (0.2.130). wasm-opt is used if present.
set -euo pipefail
cd "$(dirname "$0")/.."

cargo build --release --quiet --target wasm32-unknown-unknown -p palimpsest-wasm
out=web/src/wasm/pkg
rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" target/wasm32-unknown-unknown/release/palimpsest_wasm.wasm
if command -v wasm-opt >/dev/null; then
    wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int "$out/palimpsest_wasm_bg.wasm" -o "$out/palimpsest_wasm_bg.wasm"
fi
ls -l "$out"/*.wasm | awk '{ printf "%s: %.1f MB\n", $NF, $5 / 1e6 }'

#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "Cloudflare build requires curl to install the Rust toolchain." >&2
  exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable
fi

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1 || ! command -v rustup >/dev/null 2>&1; then
  echo "Rust and Cargo are required to build Market Pulse." >&2
  exit 1
fi

rustup toolchain install stable --profile minimal
rustup target add wasm32-unknown-unknown --toolchain stable
rustup default stable

if ! command -v wasm-pack >/dev/null 2>&1 \
  || [[ "$(wasm-pack --version)" != "wasm-pack 0.15.0" ]]; then
  cargo install wasm-pack --version 0.15.0 --locked --force
fi

cargo test --manifest-path wasm/Cargo.toml
npm test -- --watch=false
wasm-pack build wasm --target web
npm run build -- --configuration production

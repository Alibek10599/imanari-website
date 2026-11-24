#!/bin/sh
set -eu
repo=$(cd "$1" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
build=$here/playground/build
version=$(sed -n 's/^version = "\(.*\)"/\1/p' "$repo/Cargo.toml" | head -1)
mkdir -p "$build/src" "$here/../play"
for module in diag fmt ir semantic syntax; do
  cp "$repo/src/$module.rs" "$build/src/$module.rs"
done
cp "$here/playground/lib.rs" "$build/src/lib.rs"
cp "$repo/rust-toolchain.toml" "$build/rust-toolchain.toml"
cat > "$build/Cargo.toml" <<TOML
[package]
name = "nari-playground"
version = "$version"
edition = "2024"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true

[workspace]
TOML
cp "$repo/Cargo.lock" "$build/Cargo.lock"
(cd "$build" && rustup target add wasm32-unknown-unknown >/dev/null 2>&1 && cargo build --release --target wasm32-unknown-unknown)
cp "$build/target/wasm32-unknown-unknown/release/nari_playground.wasm" "$here/../play/nari.wasm"
cp "$repo/src/web/app.js" "$repo/src/web/app.css" "$here/../play/"
echo "wrote play/nari.wasm ($(wc -c < "$here/../play/nari.wasm") bytes, nari $version), play/app.js and play/app.css"

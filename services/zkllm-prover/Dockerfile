# XFuel zkLLM prover — CPU-only, container-portable (ADR 0004).
# Model-scale runs (M5.3+) are RAM-bound: size the host/instance memory, not GPU.

# ── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1.83-slim AS build
WORKDIR /build
# Cache deps first
COPY Cargo.toml ./
COPY crates/xfuel-zkp/Cargo.toml crates/xfuel-zkp/Cargo.toml
RUN mkdir -p crates/xfuel-zkp/src && echo "fn main() {}" > crates/xfuel-zkp/src/lib.rs
RUN cargo build --release || true
# Real sources
COPY . .
RUN cargo build --release --example prove_block

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN useradd -m -u 10001 prover
COPY --from=build /build/target/release/examples/prove_block /usr/local/bin/prove_block
USER prover
# Default: prove one 256x256 block (override args: e.g. `docker run <img> 512 512 512`)
ENTRYPOINT ["prove_block"]
CMD ["256", "256", "256"]

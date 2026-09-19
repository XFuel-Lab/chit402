FROM ubuntu:22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies (including AWS CLI and jq for secrets loading)
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    libssl-dev \
    pkg-config \
    git \
    clang \
    cmake \
    protobuf-compiler \
    jq \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI v2 for Secrets Manager access
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws

# Install Rust with stable 1.88+ for SP1 SDK 5.2.x edition2024 support
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

# Update to latest stable (should be 1.88+)
RUN rustup update stable && rustup default stable

# Install SP1 CLI via cargo (sp1up method)
RUN curl -L https://sp1up.succinct.xyz | bash && \
    /root/.sp1/bin/sp1up

# Add SP1 to PATH
ENV PATH="/root/.sp1/bin:${PATH}"

# Install SP1 toolchain
RUN cargo prove install-toolchain

# Verify installation
RUN cargo prove --version && \
    rustup toolchain list

# Set working directory
WORKDIR /app

# Build context is the REPO ROOT (not services/sp1-prover/). Cargo workspace members
# must live under the workspace root (/app); vendor hooks in-tree and rewrite paths
# in the copied Cargo.toml only (source tree unchanged).
# Build from repo root:
#   docker build -f services/sp1-prover/Dockerfile -t xfuel-sp1-prover:guest-v51 .
COPY services/sp1-prover/Cargo.toml /app/Cargo.toml
COPY services/sp1-prover/rust-toolchain.toml /app/rust-toolchain.toml
COPY services/sp1-prover/program /app/program
COPY services/sp1-prover/host /app/host
COPY core-layer/sp1-hooks /app/core-layer/sp1-hooks
RUN sed -i 's|\.\./core-layer/sp1-hooks|core-layer/sp1-hooks|g' /app/Cargo.toml

# Build the guest program first (uses SP1 toolchain)
RUN cd /app/program && \
    cargo prove build

# Build the host program
RUN cd /app && \
    cargo build --release --package deposit-proof-host

# Copy entrypoint script for AWS Secrets Manager integration
COPY services/sp1-prover/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose port for HTTP API
EXPOSE 8080

# Use entrypoint for AWS Secrets loading
ENTRYPOINT ["/app/entrypoint.sh"]

# Alternative: Direct command (if not using AWS Secrets)
# CMD ["/app/target/release/prove", "serve", "--port", "8080"]

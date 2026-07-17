# zkGPT Prover Integration (Phase 1 — ZKG-1)

> Scaffolding for integrating the [zkGPT](https://eprint.iacr.org/2025/1184) prover into XFuel's inference pipeline. When a task is submitted with `proof_system: zkgpt`, the gateway (`services/gateway`) can route proof generation here instead of SP1. Settlement home is **Base** (ADR 0002); EdgeCloud is an optional run host for the prover image, not product identity.

> ⚠️ **STATUS: Tier-3 zkGPT proof-of-inference is ROADMAP / BLOCKED on GPU capacity.**
> It is **not** a live or demo path today. The bundled mock server/wrapper is **DEV-ONLY**
> (stub proofs for E2E plumbing) and must never be presented as a live/demo proof. The live
> verifiable-compute tiers are **Tier-1 signed receipt** and **Tier-2 SP1 ZK settlement
> proof** (see [`docs/RUNTIME_STATE.md`](../../docs/RUNTIME_STATE.md)).

## Upstream

- **Paper:** [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184) — zkGPT: An Efficient Non-interactive Zero-knowledge Proof Framework for LLM Inference
- **Code:** [github.com/security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt) (C++, Hyrax + Lasso)
- **Proof system:** GKR + Lasso (not Groth16/PLONK). Proof size ~101 KB; BN254.

## Build and run upstream prover ([security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt))

**Requirements (from upstream):** C++14, cmake ≥ 3.10, GMP. **Clone and build** are standard — laptop is fine (same as the other prover). The upstream **200GB RAM / 16+ cores** recommendation is for **running** the prover (circuit init + proving), not for the build. Build locally; use a big server or EdgeCloud when you actually run proof generation.

**Windows:** The upstream uses bash and apt (Linux). Use **WSL**: open a WSL terminal, `cd` to your repo (e.g. `cd /mnt/c/Users/seeha/xfuel-protocol/services/gateway/zkgpt`), then run the install and build steps below (apt, build.sh). PowerShell cannot run `build.sh` and has no `apt`.

- **EdgeCloud** is used to **run** the prover (we already deploy the mock there). You deploy a **pre-built** Docker image via the [Theta EdgeCloud dashboard](https://www.thetaedgecloud.com/dashboard); EdgeCloud does not provide a general “build server” or SSH. So: build the image somewhere with enough RAM, then deploy that image to EdgeCloud (same flow as the current zkGPT mock).
- **Recommended flow:**
  1. **Laptop:** Develop and run the DEV-ONLY mock, run `.\scripts\test-task-zkgpt.ps1` against a mock `ZKGPT_PROVER_URL` (plumbing only — not a live proof).
  2. **Build** on your laptop (steps below or `Dockerfile.build`). **Run** the demo locally or deploy the binary in an image to EdgeCloud; 200GB is for running the prover, not for the build.
  3. **EdgeCloud:** Deploy the new image as your zkGPT prover endpoint; point `ZKGPT_PROVER_URL` at it and run real proof tests from your laptop.

If Theta adds a “run custom job” or Jupyter with large RAM, you could run the clone+build there instead of a separate cloud VM; until then, a rented high-RAM instance is the practical option.

**Optional — `Dockerfile.build`** (from repo root):

```bash
docker build -f services/zkgpt-prover/Dockerfile.build -t xfuel-zkgpt-built .
```

Extract the binary: `docker create --name ex xfuel-zkgpt-built && docker cp ex:/zkgpt/cmake-build-release/src/demo_llm_run ./demo_llm_run && docker rm ex`. Then add it to a runtime image with the wrapper and deploy to EdgeCloud.

---

1. **Clone with submodules** (mcl is a submodule):
   ```bash
   git clone --recurse-submodules https://github.com/security-Anonymous/zkgpt.git
   cd zkgpt
   ```
   If you already cloned without `--recurse-submodules`, run `git submodule update --init --recursive`.

2. **Install GMP:**
   ```bash
   sudo apt install libgmp-dev
   ```

3. **Build:** Upstream uses `build.sh` (Debug or Release). The `llm.sh` script builds and runs the demo:
   ```bash
   ./build.sh Release
   # Binary: cmake-build-release/src/demo_llm_run
   ```

4. **Run the demo:**
   ```bash
   ./llm.sh
   ```
   This builds (if needed) and runs `demo_llm_run`. Circuit init can take minutes (CPU single-thread); proving uses 32 threads. Paper: prover time &lt;25 s for GPT-2-small; proof ~101 KB.

### Upstream interface vs XFuel adapter

The upstream **demo** (`main_demo_llm.cpp`) has **no JSON or HTTP API**: it runs a fixed GPT-2 inference proof with hardcoded dimensions (12 layers, 12 heads, seq len 30, etc.) and no stdin/stdout contract. To use it with XFuel’s wrapper:

- **Option A — Run demo only:** Use the steps above to confirm the repo builds and produces a proof. Compare the proof format with [ZKG2_VERIFIER_SPEC.md](../docs/ZKG2_VERIFIER_SPEC.md) for verifier implementation. No E2E with our M2M API yet.
- **Option B — Adapter for E2E:** Implement a small **adapter** that the wrapper can invoke via `ZKGPT_PROVER_CMD`. The adapter must:
  1. Read a single JSON object from **stdin** (same fields as the [Expected HTTP API](#expected-http-api-for-a-wrapper-service) request: `task_id`, `output_hash`, `net_amount`, etc.).
  2. Run the upstream binary (or a modified build that accepts config/inputs) and capture the proof output (file or stdout, depending on what the code exposes).
  3. Write a single JSON object to **stdout**: `proof` (hex), `public_inputs`, `nullifier`, `proving_time_ms`.

  Then run: `ZKGPT_PROVER_CMD="/path/to/adapter" node zkgpt-prover/wrapper-template.cjs` (or set in the Theta EdgeCloud container).

## XFuel integration (target)

1. **Inputs** (from inference task): model commitment, input embedding (or hash), output.
2. **Outputs:** `proofBytes` (~101 KB), `publicValues` (ABI-encoded for `ZKVerifierZkGPT.verifyProof`).
3. **Backend:** When `task.intent.proofSystem === 'zkgpt'`, the backend (`services/gateway`) calls the zkGPT prover via `zkgpt-prover-client.js` if `ZKGPT_PROVER_URL` is set; otherwise falls back to SP1 with a warning.

### Expected HTTP API (for a wrapper service)

The backend client (`services/gateway/src/zkgpt-prover-client.js`) POSTs to `{ZKGPT_PROVER_URL}/prove` with JSON body:

- `task_id`, `net_amount`, `block_number`, `merkle_root`, `identity_commitment`, `output_hash`, `task_type`, `source_chain`

Expected response (JSON):

- `proof` or `proof_bytes` — proof bytes (base64 or hex)
- `public_inputs` or `publicInputs` — object for on-chain public values
- `nullifier` or `nullifier_hex` — 0x-prefixed hex or raw hex
- `proving_time_ms` or `provingTimeMs` — number

Optional: `GET /health` → 200 when the prover is ready.

## Mock server (E2E testing) — DEV-ONLY

> ⚠️ **DEV-ONLY.** This mock returns **stub proofs** purely to exercise the M2M/gateway
> plumbing. It is **never** a demo or live proof path, and on-chain settlement still reverts
> with `ProofFailed` until ZKG-2 (real verifier). Tier-3 zkGPT is roadmap/blocked on GPU.

A mock HTTP server is included so you can test the full flow without building the C++ prover:

```bash
# From repo root
node zkgpt-prover/mock-server.cjs
# Listens on http://localhost:81 (or ZKGPT_PROVER_PORT)
```

Then set `ZKGPT_PROVER_URL=http://localhost:81` in `services/gateway/.env` (or core-layer). Submit a task with `proof_system: "zkgpt"`; the gateway will call the mock and receive a stub proof (~101 KB), nullifier, and public inputs. On-chain settlement will still revert with `ProofFailed` until ZKG-2 (real verifier) is implemented.

Optional env for mock: `ZKGPT_PROVER_PORT` (default 81), `ZKGPT_MOCK_DELAY_MS` (default 500, simulates proving time).

**Smoke test:** Run `npm run test:zkgpt-mock` (or `node zkgpt-prover/smoke-test.cjs`) to spawn the mock server, hit GET /health and POST /prove, and assert the response shape. Uses port 8099 by default (set `ZKGPT_SMOKE_PORT` to override).

**E2E prover test:** Run `npm run test:zkgpt-e2e` (or `node zkgpt-prover/e2e-prover-test.cjs`) to spawn the wrapper-template (same service used on Theta EdgeCloud), send a proof request in the exact shape the backend sends, and assert the response. Confirms the prover is E2E-ready.

## Adapter (stdin/stdout ↔ demo_llm_run)

`adapter.cjs` bridges the wrapper and the upstream binary: it reads one JSON object from stdin (task_id, output_hash, …), runs `demo_llm_run`, parses stdout for `time: X.X`, and writes one JSON object to stdout (proof, public_inputs, nullifier, proving_time_ms). The upstream demo does not emit proof bytes yet, so the adapter returns a stub proof and the real proving time. Env: `ZKGPT_DEMO_BINARY` (default `/app/demo_llm_run`), `ZKGPT_PROVER_TIMEOUT_MS` (default 300000).

Use it with the wrapper: `ZKGPT_PROVER_CMD="node adapter.cjs" node wrapper-template.cjs`.

## Wrapper template (real C++ prover)

Use `wrapper-template.cjs` when you have a prover binary or adapter that reads JSON from stdin and writes JSON (proof, public_inputs, nullifier, proving_time_ms) to stdout:

```bash
# With adapter (wraps demo_llm_run)
ZKGPT_PROVER_CMD="node adapter.cjs" ZKGPT_DEMO_BINARY=/path/to/demo_llm_run node zkgpt-prover/wrapper-template.cjs
```

If `ZKGPT_PROVER_CMD` is not set, the wrapper runs in mock mode (same as mock-server.cjs). Env: `ZKGPT_PROVER_PORT`, `ZKGPT_PROVER_TIMEOUT_MS` (default 120000), `ZKGPT_MOCK_DELAY_MS`.

**Run locally:** `npm run run:zkgpt-prover` (or `node zkgpt-prover/wrapper-template.cjs`). Listens on port 81.

**Docker — mock only (current):** Build and run the wrapper in mock mode (no C++ binary):

```bash
# From repo root; build context is zkgpt-prover/
docker build -t xfuel-zkgpt-prover zkgpt-prover
docker run -p 81:81 -e ZKGPT_PROVER_PORT=81 xfuel-zkgpt-prover
```

**Docker — full (C++ prover + adapter, for Theta GPU node):** Multi-stage build: compile upstream zkGPT, then run Node wrapper + adapter. Build from **repo root** (takes a while). **No full zkGPT prover is currently running** — the `xfuel/xfuel-zkgpt-prover:full-v4` image is not deployed while Tier-3 is blocked on GPU capacity. When capacity is available, build a new tag (e.g. full-v5) and set the Theta template to that tag.

```bash
docker build -f services/zkgpt-prover/Dockerfile.full --platform linux/amd64 -t xfuel/xfuel-zkgpt-prover:full-v5 .
docker push xfuel/xfuel-zkgpt-prover:full-v5
docker run -p 81:81 -e ZKGPT_PROVER_PORT=81 xfuel/xfuel-zkgpt-prover:full-v5
```

Push and deploy to Theta EdgeCloud per [zkgpt-prover/THETA-EDGECLOUD-DEPLOY.md](THETA-EDGECLOUD-DEPLOY.md). If you get 0/20 or 0/22, set **Container Argument** in the template to `["/usr/local/bin/node", "/app/wrapper-template.cjs"]` (see that doc). Set `ZKGPT_PROVER_URL` in the backend to the deployment URL.

Do **not** add a custom start command (e.g. ulimit) to fix deploy — that caused 0/20. Only if you get 1/1 and then see `failed to create fsnotify watcher: too many open files` in logs when proving and you do **not** see `[zkgpt-entrypoint] ulimit -n:` in the logs, the platform is not using the image’s entrypoint (it starts the container with `node wrapper-template.cjs` directly). **Fix:** In the Theta EdgeCloud deployment, set the container **start command** to this exact value so `ulimit` runs before Node:
Try container start command: `sh -c "ulimit -n 65536 2>/dev/null || true; exec node /app/wrapper-template.cjs"`. If the platform allows setting container ulimits (e.g. `nofile=65536`), you can use that instead. If you *do* see `[zkgpt-entrypoint] ulimit -n: 65536` but still get `failed to create fsnotify watcher: too many open files`, the limit is **kernel inotify** (`fs.inotify.max_user_watches` / `max_user_instances`). The entrypoint tries to raise these when the container can write `/proc/sys/fs/inotify/`; if not, the host/platform must set them (e.g. host: `sysctl -w fs.inotify.max_user_watches=524288` and `fs.inotify.max_user_instances=512`; in Theta/Kubernetes use the deployment’s sysctl option if available).

**Note:** The C++ prover can use a lot of RAM (range phase ~38s then GKR). If the container has limited memory, `demo_llm_run` may be OOM-killed and the backend will see `proof_outcome: regenerable` and `sp1_proof.error: 502`. A real deployment needs a node with more memory (blocked on GPU capacity today). The DEV-ONLY mock image only exercises E2E plumbing (stub proof) — it is not a live proof.

## Current status

- [x] Mock HTTP server for E2E (`zkgpt-prover/mock-server.cjs`) and smoke test (`zkgpt-prover/smoke-test.cjs`).
- [x] Wrapper template (`zkgpt-prover/wrapper-template.cjs`) to plug in a real prover via `ZKGPT_PROVER_CMD` (stdin/stdout JSON).
- [x] Adapter (`zkgpt-prover/adapter.cjs`) — runs `demo_llm_run`, returns JSON (stub proof + real proving time from stdout).
- [x] Full Docker image (`Dockerfile.full`) — multi-stage: build upstream zkGPT + Node wrapper + adapter; ready to deploy to Theta GPU node.
- [x] Backend and core-layer route to zkGPT prover when `proof_system === 'zkgpt'` (see `zkgpt-prover-client.js`, `core-layer/ai-listener.js`).
- [ ] Upstream demo emits proof bytes in a parseable way (adapter currently returns stub proof; ZKG-2 verifier still stub).
- [ ] Ensure `publicValues` encoding matches what `ZKVerifierZkGPT` expects once ZKG-2 verifier is implemented.

## References

- [docs/REFERENCES-AND-ATTRIBUTION.md](../docs/REFERENCES-AND-ATTRIBUTION.md) — formal attribution and citation for zkGPT (eprint 2025/1184; security-Anonymous/zkgpt)
- [docs/PHASE1_KICKOFF.md](../docs/PHASE1_KICKOFF.md) — ZKG-1 through ZKG-5
- [docs/research/zkGPT-feasibility-memo.md](../docs/research/zkGPT-feasibility-memo.md) — proof format, verifier requirements
- [contracts/core/ZKVerifierZkGPT.sol](../contracts/core/ZKVerifierZkGPT.sol) — stub verifier (replace with real GKR+Lasso in ZKG-2)
- [docs/ZKG2_VERIFIER_SPEC.md](../docs/ZKG2_VERIFIER_SPEC.md) — on-chain verifier implementation spec for ZKG-2

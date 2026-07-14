# zkGPT Prover — Fresh Run (Local + Theta)

Step-by-step to run the zkGPT flow from a clean state: local prover, M2M server, test script, then optional Theta deploy.

---

## Prerequisites

- Docker (prover image built and/or pulled)
- Node 18+ (for theta-bridge)
- Repo at `xfuel-protocol` root; terminal in `backend/theta-bridge` unless noted

---

## Part 1: Local run (no Theta)

### 1. Set environment (theta-bridge)

In `backend/theta-bridge/.env` ensure the zkGPT prover URL points at your **local** prover:

```env
ZKGPT_PROVER_URL=http://localhost:81
```

Optional: `ZKGPT_PROVER_TIMEOUT_MS=300000` (5 min). Leave other vars as needed for your setup.

### 2. Start the zkGPT prover (Docker)

From **repo root** (so the image name resolves):

```powershell
cd c:\Users\seeha\xfuel-protocol
docker run --rm -p 81:81 -e LD_LIBRARY_PATH=/app/lib xfuel/xfuel-zkgpt-prover:full
```

Leave this terminal open. You should see:

- `[zkgpt-entrypoint] start`
- `[zkgpt-wrapper] Listening on http://localhost:81`
- `[zkgpt-wrapper] Prover command: node adapter.cjs`

If port 81 is already in use, use another host port, e.g. `-p 8082:81`, and set `ZKGPT_PROVER_URL=http://localhost:8082` in `.env`.

### 3. Health check — prover

In a **new** PowerShell:

```powershell
(Invoke-WebRequest -Uri "http://localhost:81/health" -UseBasicParsing).Content
```

Expected: JSON with `"status": "ok"`, `"service": "zkgpt-wrapper"`, and optionally `"wrapper_version": "2"`.

### 4. Start the M2M server (theta-bridge)

In a **new** PowerShell:

```powershell
cd c:\Users\seeha\xfuel-protocol\backend\theta-bridge
npm install
npm run m2m-server
```

Leave this running. Default port is **3002** (`M2M_API_PORT` in .env overrides). You should see the server listening and (if configured) AI listener / zkGPT client init.

### 5. Health check — M2M server

In another PowerShell:

```powershell
(Invoke-WebRequest -Uri "http://localhost:3002/health" -UseBasicParsing).Content
```

Expected: JSON with server and (if enabled) `ai_listener` status.

### 6. Run the zkGPT test script

Same machine, same `backend\theta-bridge` dir:

```powershell
cd c:\Users\seeha\xfuel-protocol\backend\theta-bridge
.\scripts\test-task-zkgpt.ps1
```

Default base URL is `http://localhost:3002`. To override:

```powershell
.\scripts\test-task-zkgpt.ps1 "http://localhost:3002"
```

**Success (real proof):** Response has `proof_outcome: valid`, **`sp1_proof.has_proof: true`**, and **`sp1_proof.proving_time_ms`** (e.g. ~38000). That means the zkGPT prover was called and returned a proof.

**Mock result vs proof:** The **`result`** block (e.g. `result.mock: true`, `provider: "theta-edge-mock"`) is the *inference* result (LLM output). For this test it is always mock. The **`sp1_proof`** block is separate: it is the ZK proof from the prover. If `has_proof: false` and `proving_time_ms: null`, the prover was not used or did not return a proof (e.g. backend called Theta and got 502, or `ZKGPT_PROVER_URL` was not set so the prover was never called).

**Failure:** You may see `proof_outcome: regenerable`, `sp1_proof.error: 502`, `prover_error: ...`. Check that the prover container is running and that `ZKGPT_PROVER_URL` in `.env` matches the prover (localhost:81 for local, or your Theta URL for Theta).

### 7. Optional — one-off POST to prover (no M2M)

To hit the prover directly (e.g. to confirm it returns 200 and a proof):

```powershell
$body = '{"task_id":"test-1","output_hash":"0xab","net_amount":"0","block_number":1,"merkle_root":"0x00","identity_commitment":"0x00"}'
Invoke-WebRequest -Uri "http://localhost:81/prove" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
```

Expected: `StatusCode 200`, `Content` with `proof`, `nullifier`, `proving_time_ms`.

---

## Part 2: Deploy to Theta EdgeCloud (one path — no churn)

We use **one** image, **one** tag, **one** template. No optional overrides unless deployment fails; then one fallback only.

### 1. Build and push (once)

From **repo root**:

```powershell
cd c:\Users\seeha\xfuel-protocol
docker build -f zkgpt-prover/Dockerfile.full --platform linux/amd64 -t xfuel/xfuel-zkgpt-prover:full .
docker push xfuel/xfuel-zkgpt-prover:full
```

(Log in to your registry first if required.)

### 2. Create/update the Theta custom template

In Theta EdgeCloud dashboard:

| Field | Value |
|-------|--------|
| **Container Image URL** | `xfuel/xfuel-zkgpt-prover:full` |
| **Container Port** | `81` |
| **Replicas** | `1` |
| **Container Arguments** | **Leave empty** so the image runs its built-in ENTRYPOINT + CMD. |
| **Environment Variables** | Leave empty (image has defaults). |

Save, then deploy.

**If deployment stays 0/24 with no logs:** Set **Container Arguments** to exactly (one line, valid JSON):

```json
["sh", "-c", "ulimit -n 65536 2>/dev/null || true; exec node /app/wrapper-template.cjs"]
```

Redeploy once. If it still 0/24, do not add more options — use the diagnostic image (see Troubleshooting) or contact Theta support.

### 3. Deploy the service

Use the template to deploy a new service. Note the public URL (e.g. `https://xxx.tec-s20.onthetaedgecloud.com`).

### 4. Point theta-bridge at Theta

In `backend/theta-bridge/.env` set:

```env
ZKGPT_PROVER_URL=https://YOUR_THETA_PROVER_URL
```

(No trailing slash. Example: `https://xfuelzkgptqc5x8q6cfo-6uucdjdbxyqzj1iyqxaf2e6tarj4.tec-s20.onthetaedgecloud.com`.)

### 5. Health check — Theta prover

```powershell
(Invoke-WebRequest -Uri "https://YOUR_THETA_PROVER_URL/health" -UseBasicParsing).Content
```

Expected: `"status": "ok"`, and ideally `"wrapper_version": "2"` so you know the new image is running.

### 6. Run the test against Theta

M2M server must be running locally with the updated `.env` (so it calls the Theta prover URL):

```powershell
cd c:\Users\seeha\xfuel-protocol\backend\theta-bridge
npm run m2m-server
```

In another terminal:

```powershell
cd c:\Users\seeha\xfuel-protocol\backend\theta-bridge
.\scripts\test-task-zkgpt.ps1
```

If you still get 502 and `prover_response` only has `"error": "Prover exited 127: "`, the node is likely running an old image — use a new tag (e.g. `full-v5`), push, set the template to that tag, enable “Always pull” if available, and redeploy.

---

## Understanding the output and Theta logs

- **`result.mock: true` / `provider: "theta-edge-mock"`** — The *inference* part of the test is always mock (no real LLM run). That is expected.
- **`sp1_proof.has_proof` and `proving_time_ms`** — These come from the **zkGPT prover**. If `has_proof: false` and `proving_time_ms: null`, then either:
  - **Prover not called:** `ZKGPT_PROVER_URL` in `.env` is unset or wrong, so the backend never POSTs to the prover (it may fall back to SP1 or skip proof). Set `ZKGPT_PROVER_URL=http://localhost:81` for local, or your Theta URL for Theta.
  - **Prover called but failed:** e.g. Theta returns 502 (exit 127); then you’d see `sp1_proof.error` and `prover_error` set.
- **Theta logs:** If you only see startup lines (`[zkgpt-entrypoint]`, `[zkgpt-wrapper] Listening`, `failed to create fsnotify watcher`) and **no** `[zkgpt-wrapper] POST /prove received`, then **requests are not reaching the Theta prover**. Confirm `backend/theta-bridge/.env` has `ZKGPT_PROVER_URL` set to the Theta deployment URL (not localhost) when you run the test against Theta. The repeated startup lines are from multiple replicas/containers starting; proof requests would log one line per POST.

---

## Troubleshooting

### 1. `failed to create fsnotify watcher: too many open files` (Theta logs repeating, no `POST /prove received`)

This is usually **kernel inotify limits**, not the process `nofile` limit. You already see `ulimit -n: 65536`, so the entrypoint ran; the host’s `fs.inotify.max_user_watches` / `max_user_instances` are likely too low.

**Do this:**

1. **Single replica** — Deploy with **1 replica** so only one Node process + one adapter child run. That often stays under default inotify limits.
2. **Start command** — In the Theta custom template, set the container **start command** to:
   ```text
   sh -c "ulimit -n 65536 2>/dev/null || true; exec node /app/wrapper-template.cjs"
   ```
   so the platform doesn’t skip the image entrypoint.
3. **Host inotify (if you control the node)** — On the host:
   ```bash
   sudo sysctl -w fs.inotify.max_user_watches=524288
   sudo sysctl -w fs.inotify.max_user_instances=512
   ```
   If Theta provides a way to set pod/container sysctls (e.g. Kubernetes `securityContext.sysctl`), use that.
4. **Rebuild and redeploy** — After updating `entrypoint.sh`, rebuild the image, push a new tag (e.g. `full-v5`), point the template at it, enable “Always pull” if available, and redeploy. New logs will show `inotify max_user_watches=... max_user_instances=...` so you can confirm host values.

If the container still restarts in a loop, check Theta’s health probe (readiness/liveness). The prover may be slow to respond; increase the probe’s initial delay or timeout so the platform doesn’t kill the pod before the first `/health` succeeds.

### 2. Test shows `proof_outcome: valid` but `sp1_proof.has_proof: false` (no proof from prover)

- When testing **against Theta**, `backend/theta-bridge/.env` must have **`ZKGPT_PROVER_URL`** set to your Theta prover URL (e.g. `https://xxx.tec-s20.onthetaedgecloud.com`). If it’s unset or points to `localhost`, the bridge may not call the Theta prover (or may call a local mock), and the task can still be marked fee_collected with no proof.
- After fixing the Theta prover (e.g. resolving fsnotify and seeing `POST /prove received` in logs), run the test again. You should then see `sp1_proof.has_proof: true` and `sp1_proof.proving_time_ms` set.

### 3. `proof_outcome: regenerable` and `Prover exited 1` with empty stderr

The wrapper returned **502** because the adapter's child (`demo_llm_run`) exited with **code 1** and no stderr. Common causes: binary fails at runtime without writing to stderr, or wrong image (mock-only instead of full).

**Diagnose inside the container (Docker):** Run the binary by hand to see stdout/stderr:

```powershell
docker run --rm -it -e LD_LIBRARY_PATH=/app/lib xfuel/xfuel-zkgpt-prover:full-v4 sh -c "cd /app && /app/demo_llm_run 2>&1"
```

- Loader/lib errors: fix `LD_LIBRARY_PATH` or image (ensure `/app/lib` has the `.so` files).
- Binary runs then exits 1: C++ code is failing (range_prover or GKR); prover can take 30–60s per run.
- Use the **full** image (e.g. `Dockerfile.full`, tag `full-v4`), not the mock-only image.

### 4. Theta shows 0/24 (increasing attempts) vs 0/1 (normal) — read this first

**What the numbers mean:** **0/1** = 0 ready out of 1 replica (still starting or failing readiness). **0/24** (or 0/12, 0/30) = **crash loop**: the container **exits soon after start** and the platform restarts it (e.g. up to 24 times). So **0/24 means the main process is not staying up** — fix the startup/exit cause before worrying about 1/1.

**Strict diagnosis order (do not skip):**  
1) **Get logs** for the failing container (Theta UI → deployment → logs). Without logs you are guessing.  
2) **Deploy diagnostic image:** `docker build -f zkgpt-prover/Dockerfile.theta-diagnostic --platform linux/amd64 -t xfuel/xfuel-zkgpt-prover:theta-diagnostic .` then push. New template: image `theta-diagnostic`, port 81, no custom command. If that goes **1/1**, platform and Node are fine — problem is full image or wrapper. If diagnostic **also** 0/24, contact Theta (platform/arch/registry).  
3) **If diagnostic is 1/1:** Use **full** image but set start command to only `node /app/start-ping.cjs`. If that goes 1/1, the issue is entrypoint or wrapper; next use the fallback command from Part 2 Step 2 and check logs for `[zkgpt-wrapper]` or `Server listen error`.  
4) **Health probe:** If process starts but stays 0/1, ask Theta for a **long initial delay** (90–120 s) for health on port 81 path `/health`, or disable it to confirm 1/1.

- Use the **one** Container Arguments fallback from Part 2 Step 2. Redeploy once.
- **Diagnostic image:** Build and deploy `Dockerfile.theta-diagnostic` (see "Last resort" below). If that also 0/24, the issue is platform/Theta — contact support.
- **Build for the right CPU** so the image runs on Theta’s nodes. From repo root:
  ```powershell
  docker build -f zkgpt-prover/Dockerfile.full --platform linux/amd64 -t xfuel/xfuel-zkgpt-prover:full-v7 .
  docker push xfuel/xfuel-zkgpt-prover:full-v7
  ```
  Then point the template at `full-v7`. If Theta runs arm64, they would need an arm64 image; confirm with Theta which architecture their nodes use.
- **Ask Theta support** (1) what 0/24 means (restarts? attempts?), (2) how to view logs for a container that never becomes “ready,” and (3) what command the platform runs when the start command is empty vs when it is set.

### 5. Theta deployment not starting (0/1 or 0/2, no logs)

If the container never becomes ready and you get no logs, the process may not be starting at all. Work through the following.

**A. Use the image default (no custom start command)**  
Clear or remove any custom “start command” / “command” override in the Theta template so the image runs its default `ENTRYPOINT` + `CMD`. Redeploy. If it goes to 1/1, the issue was the custom command (syntax or quoting on Theta).

**B. Minimal “ping” server (isolate Node vs our script)**  
The image includes a minimal server that only logs and listens on 81. Rebuild the image (so it includes `start-ping.cjs`), push, then set the Theta **start command** to exactly:

```text
node /app/start-ping.cjs
```

Redeploy. If the deployment goes to 1/1 and you get logs like `[zkgpt-ping] Starting...` and `Listening on port 81`, then Node and the platform are fine and the issue is with `wrapper-template.cjs` or how the full command is passed. If it still does not start, the problem is likely image, platform, or how Theta runs the command (e.g. wrong image name, architecture, or command format).

**C. Verify image and port**  
- Confirm the template uses the **full prover image** (e.g. `xfuel/xfuel-zkgpt-prover:full-v4`), not a different image (e.g. generic `xfuel/xfuel`).  
- Container port must be **81** (the app listens on 81).

**D. Full start command (only after ping works)**  
If the ping server starts, use the full command with full path:

```text
sh -c "ulimit -n 65536 2>/dev/null || true; exec node /app/wrapper-template.cjs"
```

If the ping works but this does not, the issue is with `sh -c` or `ulimit` on Theta (e.g. quoting, or shell).

**E. Health check**  
If the process starts but the deployment stays 0/1, the readiness probe may be failing. Ask Theta to use a **long initial delay** (90–120 s) for the health check, or disable it temporarily. Probe: **port 81**, path **/health**.

### 6. Quick checklist when deploying to Theta

| Check | Action |
|-------|--------|
| `ZKGPT_PROVER_URL` in theta-bridge `.env` | Set to `https://YOUR_THETA_PROVER_URL` (no trailing slash) when running tests against Theta |
| Theta Container Arguments | Leave empty; if 0/24 use the one JSON fallback from Part 2 Step 2 |
| Replicas | Set to **1** |
| Logs show `POST /prove received` | If not, requests aren’t reaching the prover (wrong URL, crash loop, or LB hitting restarting pods) |
| Health check | `GET https://YOUR_THETA_PROVER_URL/health` returns `"status":"ok"` |

---

## Quick reference

| Component        | URL / command              | Port |
|-----------------|----------------------------|------|
| zkGPT prover    | `http://localhost:81`     | 81 |
| M2M server      | `http://localhost:3002`    | 3002 |
| Prover health   | `GET /health` on prover URL| —    |
| M2M health      | `GET /health` on M2M URL   | —    |
| Test script     | `.\scripts\test-task-zkgpt.ps1` | — |

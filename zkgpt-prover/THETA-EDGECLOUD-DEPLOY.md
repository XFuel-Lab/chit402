# Theta EdgeCloud — zkGPT Prover Deploy

Per [Theta: Running Generic Containerized Workload](https://docs.thetatoken.org/docs/running-generic-containerized-workload).

## Template fields (match the docs)

| Field | Value |
|-------|--------|
| **Container Image URL** | `xfuel/xfuel-zkgpt-prover:full-v6` (or your tag, e.g. `full-v7`). Do not include `https://hub.docker.com/r/`. |
| **Container Port** | `81` (your app listens on 81; Theta maps it to 443 HTTPS in deployment). |
| **Container Argument** | See below — **set this explicitly** if you get 0/20 or 0/22. |
| **Container Environment Variables** | Optional. Leave empty or set e.g. `{"NODE_ENV":"production"}` if needed. |

## If you get 0/20 or 0/22 (crash loop)

When **Container Argument** is left empty, the platform may run the container with **no command**, so the process exits immediately and Theta restarts it (0/20, 0/22). Fix: **set Container Argument** to the exact command you want to run, as a **JSON array**.

### Full prover image (`xfuel/xfuel-zkgpt-prover:full-v6`)

In the custom template, set **Container Argument** to:

```json
["/usr/local/bin/node", "/app/wrapper-template.cjs"]
```

(One line, valid JSON. No trailing comma.)

### Smoke image (for testing)

For `xfuel/xfuel-zkgpt-prover:smoke` or `smoke-v2`, set **Container Argument** to:

```json
["node", "-e", "require('http').createServer((q,r)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify({status:'ok',service':'smoke'}));}).listen(81,'0.0.0.0',()=>console.log('listening'));"]
```

## Checklist

1. **Dedicated models** → **Create from Custom Template** → **+** new template.
2. **Container Image URL**: `xfuel/xfuel-zkgpt-prover:full-v6`
3. **Container Port**: `81`
4. **Container Argument**: `["/usr/local/bin/node", "/app/wrapper-template.cjs"]` (full prover) or leave empty only if you confirmed empty works.
5. **Container Environment Variables**: empty or as needed.
6. Create template, then click it → **Create New Deployment** → choose VM type and replica count (use **1** replica first).
7. Wait for **Inference Endpoint** to turn green; then open it (HTTPS). Path `/health` should return `{"status":"ok",...}`.

## If you still get 0/10 or 0/20 with Container Argument set

Faster failure with **fewer** restarts (e.g. 0/10 instead of 0/22) after setting Container Argument usually means the process **is** starting but then exits or is **killed** quickly (e.g. by a health/readiness check). Two things to try:

### 1. Try port 80 (in case the platform probes port 80 by default)

Some runtimes probe **port 80** to see if the container is up. We normally listen on **81**; if the probe hits 80, it fails and the container can be killed. Use the **same image** and only change the template:

| Field | New value |
|-------|-----------|
| **Container Port** | `80` |
| **Container Environment Variables** | `{"ZKGPT_PROVER_PORT":"80"}` |
| **Container Argument** | unchanged: `["/usr/local/bin/node", "/app/wrapper-template.cjs"]` |

The wrapper reads `ZKGPT_PROVER_PORT` and listens on that port, so the app will listen on 80 and Theta will map 80 → 443 HTTPS.

### 2. Ask Theta support

Request: (1) **Exact command** used to start the container when Container Argument is set. (2) **Logs** for a container that never becomes ready (even one restart). (3) Whether a **readiness/liveness probe** is used (port, path, initial delay) and if it can be relaxed or disabled for your deployment.

## Port note

Theta maps your **Container Port** (81 or 80) to **443 HTTPS** in the deployment. Your app must listen on that same port inside the container (we use **81** by default; set env `ZKGPT_PROVER_PORT=80` to use 80).

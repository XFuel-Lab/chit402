# zkGPT Prover service for Theta EdgeCloud / E2E (Phase 1 — ZKG-1)
# Runs wrapper-template.cjs: mock mode by default; set ZKGPT_PROVER_CMD to use real C++ prover.
FROM node:20-slim

WORKDIR /app

# Copy only prover scripts (no parent node_modules)
COPY wrapper-template.cjs ./
COPY mock-server.cjs ./

ENV NODE_ENV=production
ENV ZKGPT_PROVER_PORT=81

EXPOSE 81

# Default: run wrapper (mock if ZKGPT_PROVER_CMD unset; real if set)
CMD ["node", "wrapper-template.cjs"]

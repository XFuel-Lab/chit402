# Launch post — XFuel: route any model, prove every dollar

Short, agent-and-dev-focused announcement copy. Three formats below (blog, X/thread,
one-liner). Honest proof scope throughout — we say exactly what the proof attests.

---

## Blog / long-form (≈250 words)

**XFuel is the verifiable settlement + payments layer for AI compute — live on testnet.**

Agents are spending real money on inference, but the receipt is a black box: you can't
prove what you paid for, what it routed to, or that the fee split was correct. XFuel
fixes the settlement half of that problem today.

Submit an inference task and XFuel routes it to a provider, settles payment over the
rail you choose — **USDC via x402** (the default, agent-native rail) or **TFUEL on
Theta** — and returns a **verifiable receipt**. Every task now has one public,
shareable link — its `verify_url` — that renders the route, the payment (with a
block-explorer link), the SP1 settlement proof status, and an **independent
re-derivation of the x402 payment binding**. No login. No trust-me.

Be precise about what the proof means: the SP1 proof attests **settlement metadata**
(correct fee split, payment binding) plus a commitment to the output hash, anchored
on-chain with a single-use nullifier. It does **not** attest that a black-box provider
ran the model correctly — that's proof-of-inference, and it's on the roadmap.

**Use it in one line:**
- OpenAI-compatible: point any client's `baseURL` at `{host}/v1`.
- MCP: `npx xfuel-mcp` — submit, pay, verify from Claude/Cursor.
- SDK: `npm install xfuel-sdk`.
- Discover it: `GET /.well-known/x402`.

Providers are pluggable. The settlement + proof layer is the product.

Docs: `AGENTS.md` · Playbook: `skills/AGENT_PLAYBOOK.md`

---

## X / thread (5 posts)

**1/** AI agents are paying for inference with black-box receipts. You can't prove what
you paid for. We built the fix. XFuel: the verifiable settlement layer for AI compute —
live on testnet. 🧵

**2/** Submit a task → we route it to a provider → settle in USDC (x402) or TFUEL →
return a verifiable receipt. Every task gets ONE public link (`verify_url`) that anyone
can open. No login.

**3/** That receipt shows the route, the payment (+ explorer link), the SP1 proof
status, and an *independent* re-derivation of the x402 payment binding. It's a trust
artifact, not a screenshot.

**4/** Honest scope: the proof attests settlement metadata (correct fee split + payment
binding) + an output-hash commitment, anchored on-chain with a single-use nullifier. It
does NOT prove a black-box provider ran the model right. That's proof-of-inference —
roadmap.

**5/** Try it in a line:
• OpenAI-compatible: baseURL → {host}/v1
• MCP: `npx xfuel-mcp`
• SDK: `npm i xfuel-sdk`
• Discover: GET /.well-known/x402
Route any model. Prove every dollar.

---

## One-liner (directory / registry blurb)

> XFuel — verifiable settlement + payments for AI compute. Submit inference, pay per
> task (USDC via x402 or TFUEL), and get a public, shareable proof receipt for every
> task. OpenAI-compatible + MCP + SDK.

---

### Pre-publish checklist

- [ ] Swap `{host}` for the public API host and confirm `PUBLIC_BASE_URL` so
      `verify_url`s in examples are absolute.
- [ ] Include one real `verify_url` from a settled testnet task as the hero link.
- [ ] Link the MCP registry listing once published (see `docs/DISTRIBUTION.md`).
- [ ] Keep the proof-scope paragraph verbatim — do not let copy drift into
      "proves the model ran correctly" (see `docs/POSITIONING.md` §2).

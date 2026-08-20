# Outreach Templates — Design Partners

Copy/paste. Customize the `[brackets]`. Targets: [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md).

Framing follows [ADR 0006](./adr/0006-receipts-are-not-a-paid-feature.md): **lead with the audit
trail, not the payment rail.** The receipt is free for anything we route and needs no wallet, so
the first ask is a base-URL swap rather than a treasury decision. USDC settlement is the upgrade
you offer once they care about the receipt — putting it first shrinks the conversation to teams
who already hold USDC on Base *and* want an audit trail, and makes a "no" unreadable (did they
not want the receipt, or not want to fund a wallet?).

---

## Cold DM / email (short)

**Subject:** Can you say what your agents spent last week, and on what?

Hi `[Name]` — saw `[project / post / hackathon]`.

Most teams running agents can answer that from a provider invoice at the account level, and
nowhere near the per-call level. Which model actually served it, which provider, how many tokens,
what it cost — that either lives in your own logs, which attest nothing, or nowhere.

XFuel is an OpenAI-compatible gateway that returns a **signed receipt for every call**: model,
provider, token counts, output hash, cost. Tamper-evident, verifiable with our SDK or your own
HMAC check. Two minutes to try — change `baseURL` to `https://api.xfuel.app/v1` and keep
everything else. No wallet, no signup call, receipts are free.

Looking for **3 design partners** to run real agent traffic through it and push on the receipt
schema before it sets.

Worth 20 minutes this week?

— `[You]` · https://xfuel.app · https://api.xfuel.app

---

## Cold DM / email (crypto-native variant)

Use when they already settle in USDC — a DAO treasury, an on-chain agent team, an x402 project.
Here the payment rail is a feature rather than a hurdle, so it can lead.

**Subject:** USDC settlement + a signed receipt per agent call

Hi `[Name]` — saw `[project / post / hackathon]`.

If `[project]`'s agents spend from a shared treasury, you have the reporting problem twice: what
was spent, and proof for whoever asks. XFuel settles agent inference in USDC on Base over x402
and returns a signed receipt per call naming the model, the provider, the tokens and the cost —
so spend reconciles against something better than a screenshot. Optional SP1 settlement proof
on-chain when a receipt needs to stand up to an auditor rather than a colleague.

OpenAI-compatible, so it is a base-URL swap. You can see the receipt before touching a wallet —
the free surface returns the same signed artifact.

Open to 20 minutes?

— `[You]` · https://xfuel.app

---

## Follow-up (no reply in 5 days)

Quick bump on design-partner access for `[project]`. Fastest version: one `curl` on a shared
screen and you leave with a `verify_url` you can check yourself. Still relevant?

---

## What to show on the call

In order. The point is to get to a receipt they can verify inside five minutes.

1. **Their own client, our base URL.** Whatever they already use — OpenAI SDK, LangChain, Cursor.
   Nothing changes but one string.
2. **The receipt.** `xfuel` block on the response, or `GET /receipt/:task_id`. Walk the fields:
   `route.model`, `route.provider`, `usage`, `payment.rail`, `signature`.
3. **Verify it in front of them.** `verifyReceiptSignature(receipt, secret)` from `xfuel-sdk`, or
   `?format=auditor` for the human-readable pack.
4. **Then, only if they ask about money:** x402 on `/task-request`, and the on-chain SP1 proof.

Say plainly what the receipt does not do: on an unmetered call it attests **which model and
provider ran**, not a dollar, because nothing settled. It is not a proof that the provider ran
the weights it claimed — that is what the spot-check tier ([ADR 0007](./adr/0007-spot-check-assurance.md))
is for, and it is not built yet. Overclaiming here is the one thing that loses a technical
partner permanently.

---

## After they say yes

Send the partner key, a Slack/Telegram invite, and
[DESIGN_PARTNER_ONBOARDING.md](./DESIGN_PARTNER_ONBOARDING.md) — that file is the partner
artifact (base-URL swap, receipt, stats, paid path). Do not send the operator tracker or
this templates file. Daily cap and trust notes live in the onboarding doc so you do not
have to restate them. The prover is kept live during onboarding.

Hi `[Name]` — you're in.

1. Key: `[partner-key]` (yours; not the public `xfuel-demo` key — keep it private)
2. Working copy: `[link to DESIGN_PARTNER_ONBOARDING.md]`
3. Channel: `[Slack/Telegram invite]`

Start at section 1 of the working copy — one `baseURL` swap, no wallet. Ping here if
anything 401s or 402s.

---

## Ask for a quote (after 2 weeks of usage)

Would you share 2–3 sentences we can use (or paraphrase) for Seed diligence — what you could not
answer about agent spend before, and what changed? Attribution optional.

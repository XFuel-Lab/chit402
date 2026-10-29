# Agent owner key

An agent owner key is an Ethereum address. The agent wallet and the key both sign the bind message. A session opened with that key is the path into that agent's book. The bind signatures are not stored.

## Bind

```
POST /v1/agents/:agent_id/owner-key
```

```
{"public_key":"0x…","wallet_signature":"0x…","key_signature":"0x…"}
```

Both signatures are over `agentBindMessage(agent_id, public_key)`:

```
Chit402 agent key bind v1
agent_id:<agent_id>
pubkey:<public_key>
```

## Persistence

The gateway stores the bindings in `agent-owner-keys.json` under the agents data directory:

```
<data>/agents/agent-owner-keys.json
```

The file is mode `600`. From this release on, a binding survives a gateway restart. The file holds the address and the bind time. It does not hold a private key.

Anything bound before the deploy that ships this release was already dropped at that deploy's restart, and at every restart before it. The owner has to bind again with:

```
POST /v1/agents/:agent_id/owner-key
```

and `{"public_key":"…","wallet_signature":"…","key_signature":"…"}` over the bind message above.

Known gaps:

- Book webhook signing secrets, stored beside this file, are plaintext at rest (mode `600`). See `docs/product/book-webhook.md`.
- Rotating the book session does not revoke a webhook registered by an earlier session holder.

# Agent owner key

An agent owner key is an Ethereum address bound to an `agent_id`. It holds no signing secret. Sessions opened with that key are the path into that agent's book.

## Bind

```
POST /v1/agents/:agent_id/owner-key
```

JSON body:

```
{"public_key":"0x…","wallet_signature":"0x…","key_signature":"0x…"}
```

Both signatures are over `agentBindMessage(agent_id, public_key)`:

```
Chit402 agent key bind v1
agent_id:<id>
pubkey:<public_key>
```

The agent wallet registered for that `agent_id` signs `wallet_signature`. The key itself signs `key_signature`.

## Persistence

The binding is stored under the agents data directory, beside `identities.json`, in:

```
<data>/agents/agent-owner-keys.json
```

The file mode is `600`. The binding survives a gateway restart from this release on.

Anything bound before the deploy that ships this release was already lost at that deploy's restart, and at every earlier restart. Owners must re-bind.

Re-bind with:

```
POST /v1/agents/:agent_id/owner-key
```

and the same JSON body as above.

Known gaps: rotating the book session does not revoke the owner key. The webhook signing secret, which lives in a different file under the same directory, is plaintext at rest at mode `600`.

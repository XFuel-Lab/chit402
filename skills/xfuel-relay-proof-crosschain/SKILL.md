---
name: xfuel-relay-proof-crosschain
description: >-
  Relay a verified XFuel ZK proof from Theta to another chain (e.g. Bittensor EVM
  964/945) via Hyperlane: build the relayProofCrossChain transaction, including
  the destination domain and message fee. Use when an agent needs a proof
  verified on Theta to be recognized on a remote chain, for cross-chain
  settlement or stake-gated verification. Building calldata only — signing is
  done server-side or out-of-band (skills hold no keys).
---

# XFuel: Relay Proof Cross-Chain

Take a settled proof and relay it to a destination domain through Hyperlane,
verifying locally and dispatching the cross-chain message.

## Prerequisites

- A completed task's proof (`task_id`) — fetch via `xfuel-verify-proof`.
- `ZK_VERIFIER_ADDRESS` and a Theta ETH-RPC URL (`THETA_RPC_URL`; public or a
  dedicated Theta node — **not** ZAN, which does not serve Theta RPC).
- Hyperlane must be configured server-side (`setMailbox` / `configureDomain`).

## Parameters

| Name | Required | Description |
|------|----------|-------------|
| `task_id` | yes | Task whose proof to relay. |
| `circuit_id` | yes | bytes32 circuit identifier the proof was generated for. |
| `dest_domain` | yes | Destination Hyperlane domain. `964` = Bittensor Mainnet, `945` = Bittensor Testnet. |
| `fee_wei` | no | Hyperlane message fee (quote from the mailbox). Default `0`. |

## Procedure

1. Fetch the proof and its public values:

   ```js
   import { XFuelClient } from 'xfuel-sdk';
   const client = new XFuelClient({ baseUrl: process.env.XFUEL_API_URL, apiKey: process.env.XFUEL_API_KEY });
   const p = await client.getProof(task_id);
   const { proof, publicInputs: publicValues, nullifier } = p.sp1_proof;
   ```

2. Build the relay calldata (verified signature: `relayProofCrossChain(bytes32
   circuitId, bytes publicValues, bytes proofBytes, bytes32 nullifier, uint32
   destDomain)`):

   ```js
   import { XFuelOnChain } from 'xfuel-sdk/onchain';
   const chain = new XFuelOnChain({
     rpcUrl: process.env.THETA_RPC_URL,
     zkVerifierAddress: process.env.ZK_VERIFIER_ADDRESS,
   });
   const call = chain.encodeRelayProofCrossChain(circuit_id, publicValues, proof, nullifier, dest_domain, fee_wei ?? '0');
   // -> { to, data, value }
   ```

3. Submit `call` via the server relayer or sign out-of-band. Return the
   resulting `messageId` / tx hash.

## Failure modes

- `NoMailbox` revert → Hyperlane mailbox not configured on the verifier.
- Nullifier already spent → the proof was already relayed/settled.
- Underpaid `fee_wei` → dispatch reverts; quote the mailbox fee first.

## Notes

- For stake-gated remote verification, the destination uses
  `verifyWithStakeCheck` (Bittensor dTAO). See `docs/TAO_CIRCUIT_HYPERLANE_E2E.md`.

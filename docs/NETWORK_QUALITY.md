# ReferenceForge network quality and routing revision

## What the public scores actually show

The current score history contains a positive macro result and two distinct zero-score failure classes. The latest FX_NOW zero records a request-builder LLM HTTP 429 / quota exhaustion before a Provider call. This is evidence of a platform request-construction failure for that sample, not evidence that the FX endpoint answered incorrectly. The separate daily-ECB versus institutional-live FX coverage limitation still exists.

ONCHAIN_METRIC_VERIFY records HTTP 422 INVALID_ADDRESS. The public history does not expose the original request payload, so we cannot prove whether the address was absent, malformed, an unsupported name, or wrongly assigned by the router. The registered generic endpoint makes address optional because gas/log/transaction metrics require a hash instead. That is a demonstrable contract ambiguity; we reproduced the missing-address failure with an original test and removed that ambiguity in a candidate descriptor.

The new contract keeps exactly the same ten intents. Its fixed metric paths are:

| Endpoint | Required fields | Primary answer |
|---|---|---|
| `/onchain-metric/native-balance` | chain, address | Raw wei balance |
| `/onchain-metric/erc20-balance` | chain, address, token | Raw ERC-20 base units |
| `/onchain-metric/transaction` | chain, tx_hash | Execution status: 1 success, 0 reverted, null pending/unknown |
| `/onchain-metric/gas` | chain, tx_hash | Gas used, not price or total fee |
| `/onchain-metric/logs` | chain, tx_hash | Receipt log count |

The generic endpoint remains callable for backwards compatibility. The candidate descriptor replaces only that generic declaration with five explicit alternatives. No address, chain, token or transaction is guessed. Unsupported chains and ENS remain refused. Runtime diagnostics record endpoint, error code and parameter type/length/shape only; they do not log field values, original questions, supplied keys or unexpected field names.

## Register the contract revision once

The deployed routing descriptor is public, but Telegraph continues using the old descriptor until its registered URL/hash are updated. Descriptor content is hash-pinned on-chain, so silently editing the registered file would be incorrect. This is a contract correction for the same ten intents, not another miner or an additional intent count.

```powershell
cd "C:\Users\hyada\OneDrive\Documents\Work-Related\Hackathons\Telegraph hackathon sarojyadav"
node tools/refine-routing-miner.mjs --check
node tools/refine-routing-miner.mjs --interactive
```

Review all details and type `REFINE_REFERENCEFORGE_ROUTING`. Enter the matching wallet private key at the hidden local prompt. The helper targets active registration 4850 only, verifies its current ten-intent descriptor, owner, fee recipient, floor, inactive predecessors, deployed revised bytes, new runtime contracts, fresh two-operator results, canonical intents, simulation, nonce and funding. It includes and tests the review timestamp required by the signing guard. An exclusive shared update lock and durable journal prevent repeat attempts after uncertain, reverted or completed sends. The agent uses only mocks and read-only preflights.

| Field | Pinned value |
|---|---|
| New YAML | https://referenceforge.0xsaroj001.workers.dev/referenceforge-routing.yaml |
| SHA-256 bytes32 | `0xd3c4ad5864771472bdf51d61930079d6fd4864c04746b7a07659cccb84f57a73` |
| Current registration | 4850 |
| Final intents | Same ten |
| Floor | 0.01 USDC |
| Network | Base Sepolia 84532, testnet only |

One update transaction replaces 4850 with a new registration ID. No second independent miner, WASM transaction or USDC transfer is included. It does not force reevaluation or guarantee a better score.

```powershell
node tools/refine-routing-miner.mjs --status
node tools/check-network-quality.mjs
```

## Network proof still needed

One unpaid direct Engine probe returned HTTP 402, confirming that the live payment gate is enforced. No payment header, wallet signature, retry or settlement was sent. This is not a successful inference, ranked-routing proof or independent consumption. The supported direct Engine path requires x402, and even malformed requests encounter payment before schema validation. A browser or consumer test needs a reviewed payment flow before we claim actual network inference.

`tools/check-network-quality.mjs` is read-only by default and reads our own public registry/scores. Its optional `--probe-payment-gate` performs exactly one request without payment or account headers and never pays or retries. Repeated probes are unnecessary while the condition is unchanged.

The known quota error is ready for organizer review in a local incident note; no outreach has been sent. After a real rescore, compare failure categories and results rather than treating a passing local test as a higher network score. The new metrics, weather and currency capabilities still require individual evaluated/routed evidence. Testnet use, our internal demonstration, independent H2 app consumption and customer-funded use remain separate states.

Official references: [Engine direct requests and payment gating](https://docs.telegraphprotocol.com/docs/using/engine-ask), [routing fields in YAML](https://docs.telegraphprotocol.com/docs/miners/yaml-config), [Provider rules](https://hackathon.telegraphprotocol.com/rules). Public score history is visible through the [Explorer API](https://explorer.telegraphprotocol.com/api/scores?miner=referenceforge-numeric&limit=30).

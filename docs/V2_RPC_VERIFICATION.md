# V2 RPC verification

Verified locally on 29 October 2026. Original diagnostics and source-workflow evidence stay local under `reports/v2-rpc/`. No deployment, paid request, credential retrieval, transaction or competition submission was performed.

## Finding

The failure was a JSON-RPC source error inside HTTP 200, not a successful balance response. The original `reports/v2-provider/rpc-diagnostic.json` recorded dRPC code 27. A bounded reproduction isolated the failing request to `eth_getBalance(address, {blockHash, requireCanonical:true})` on Base Sepolia. dRPC returned `Unknown state. First available state is 1`, code 27. Its chain ID, latest header and explicit header reads succeeded. PublicNode answered the requested hash-pinned balance.

This establishes that the sampled dRPC backend could not serve that specific requested state. It does not establish the precise internal backend cause, a global dRPC outage, or lack of all EIP-1898 support. The public documentation search did not locate an authoritative definition of dRPC code 27; the diagnosis above comes from the preserved actual response and method isolation.

## Bounded fix and source scope

Anonymous defaults now use the official Base RPC plus Allnodes PublicNode:

| Chain | First operator | Second operator |
| --- | --- | --- |
| Base | `https://mainnet.base.org` | `https://base-rpc.publicnode.com` |
| Base Sepolia | `https://sepolia.base.org` | `https://base-sepolia-rpc.publicnode.com` |

The [official Base network documentation](https://docs.base.org/get-started/connect-to-base) identifies the first pair and chain IDs. [PublicNode](https://www.publicnode.com/) publishes the second service and links it to Allnodes. These are separately identified operator services, not two URLs from the same operator. As before, common upstream faults remain possible; this is not an infrastructure audit or cryptographic state proof. Official Base endpoints are public development infrastructure, so a successful sample does not establish a production throughput guarantee. [Base's public launch guidance](https://www.base.org/blog/base-mainnet-is-open-for-builders) explicitly identifies public RPC rate limits and recommends node/provider infrastructure for production.

When an Alchemy account key is configured, the existing Alchemy plus PublicNode pair remains unchanged. No account endpoint or secret was read to complete this work. [Alchemy's Base Sepolia page](https://www.alchemy.com/rpc/base-sepolia) documents an account-key endpoint; an anonymous Sepolia endpoint was not inferred from the mainnet endpoint.

There is no fallback from two sources to one, no replacement of the block hash with `latest`, and no fabricated zero. [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) defines the block-hash parameter and canonical requirement. Existing chain ID, head freshness/skew, exact state agreement, canonical hash checks and post-read reorg checks remain active.

The RPC reader also now enforces deadlines while awaiting a stalled streamed response or a noncooperating transport promise. JSON-RPC responses containing both an `error` member and a result, even `error:null`, are refused as malformed. Error callbacks retain safe codes/stages without URLs, keys, raw upstream messages or request parameters.

## Evidence and limits

Six initial anonymous endpoint probes established chain ID and head-read connectivity for dRPC, official Base and PublicNode on both chains. They completed in 231 to 656 ms. Those initial methods did not test balance-state availability.

Three complete native-wallet workflows then produced these results:

| Workflow | Result |
| --- | --- |
| Old dRPC plus PublicNode, Base Sepolia | Explicit refusal after dRPC code 27 on the hash-pinned balance read |
| Official Base plus PublicNode, Base Sepolia | Exact dual-source state agreement and post-read canonical checks passed |
| Official Base plus PublicNode, Base | Exact dual-source state agreement and post-read canonical checks passed |

The Base Sepolia owner's exact balance string was retained in local evidence. Canonical V2 numeric encoding can still refuse an exact nonzero source decimal if conversion to JSON number would lose digits. That separate precision policy was not weakened to make this RPC experiment pass. Native workflow success does not automatically establish every concrete V2 response or platform scoring.

`hash-pinned-wallets.json` contains per-stage method/status evidence, successful source payload digests, exact values and the original failure. `public-endpoint-probes.json` preserves initial connectivity samples. `live-lookup-candidates.json` contains mined zero-value transactions discovered with one official Base block read, so a lookup can be validated without generating a transaction. These are point-in-time samples, not a sustained latency/reliability benchmark.

## Tests

Command executed:

```powershell
node --test test/v2-rpc-reliability.test.mjs test/alchemy-configuration.test.mjs test/onchain.test.mjs test/v2-provider.test.mjs
```

Result: **108/108 passed**, including 11 new RPC reliability cases. Coverage includes HTTP 200 code 27, exact hash-pinned state refusals, malformed/duplicate IDs, invalid JSON/UTF-8, response size limits, request budgets, deadlines, stream cancellation, source failure without single-source fallback, account override isolation and existing wrong-chain/reorg/precision regression cases. Tests use mocked transports and real source logic. The live read samples are recorded separately above.

Root follow-up verified all five V2 source workflows through local workerd, including the owner's native wallet and a real mined zero-value transaction. Canonical field/version/range checks passed. One direct deployed legacy wallet check also succeeded using Alchemy plus PublicNode, without retrieving its secret. These are separate point-in-time samples: the V2 candidate still has not been uploaded and configured-secret V2 behavior awaits owner deployment. Evidence: reports/v2-provider/worker-smoke-live.json and reports/v2-current/public-configured-wallet.json.

## Cancellation cleanup follow-up, 30 October IST

A local stalled-stream experiment found a separate deadline escape: the reader reached its abort deadline, then awaited an underlying `cancel()` hook indefinitely in cleanup. The [Streams Standard](https://streams.spec.whatwg.org/#default-reader-cancel) permits cancellation to return a promise; a cancellation request alone does not establish that cleanup has finished. The recorded pre-fix experiment remained pending after its deadline.

Cleanup now observes the original signal plus a100ms cleanup ceiling, releases the reader lock, and observes late cleanup rejections even if the signal was already aborted. Size-limit and abort failures keep their original error. This cannot force a noncooperating underlying resource to close; it bounds our wait and releases our reader. Source agreement, EIP1898 and canonical-state rules are unchanged.

Three new tests cover stalled cancellation after abort, stalled cleanup after a size refusal without a caller signal, and cleanup rejection behavior. **505/505 full tests pass**. `node tools/check-rpc-cleanup-worker.mjs` also passes both abort and size-refusal cases in local workerd with the project's existing compatibility date; its Node-side elapsed timing includes runtime startup. The owner release helper includes that local runtime gate. The normal V2 dry run and14-module/10-asset audit also pass. Reports stay local in `reports/v2-rpc/cleanup/`; no live source probe, upload, signing or admission claim was made for this follow-up.

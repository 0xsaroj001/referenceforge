# Transaction-lookup Provider acceptance workflow

Updated 6 November 2026 IST. This reviewer tool checks `ONCHAIN_TX_LOOKUP_GENERAL` for the Miners / Providers entry. It accepts the captured hosted version pair `4/4` and the refreshed local pair `1/1`, records the observed pair, and rejects other combinations. The [official Provider rules](https://hackathon.telegraphprotocol.com/rules) require reviewers to be able to reproduce the workflow.

An application considering a top-level native transfer needs the correct transaction, execution result, sender, recipient, block and native amount. Testing only the scored block height can miss errors in the other five fields. The new checker reads those facts separately from two fixed public RPC operators and compares all six canonical fields against the hosted Provider. It also checks rejection of an unsupported chain and malformed hash.

## Run with your own realistic transaction

Use Node.js 24 or later from the project root:

```powershell
node tools/mission-tx-acceptance.mjs --chain base --tx 0x21af89bdd84cc2b8b7bc239624279dcec922e0e93287150796fa55eec50f342e
```

Replace the transaction hash with a new realistic input. Supported chains are `base` and `base-sepolia`. This test covers mined, non-contract-creation transactions in the Provider's exact-numeric domain. Pending, absent or disagreeing source evidence is a test refusal/failure, not a guessed successful answer. A real source's transaction, receipt and supplied block must agree on chain, identity and height, and the block's transaction list must include the hash.

## Reproduce the native payment check

Use these two public Base hashes to see how an application distinguishes successful execution from a reverted payment attempt:

```powershell
node tools/mission-tx-acceptance.mjs --chain base --tx 0xb02880d1d93f92ec3ddac3cd2d5875c00a3a0591206507e561ac78fc6e9a4503
node tools/mission-tx-acceptance.mjs --chain base --tx 0x8dfee23ca24278854e31f8cb4cb51f807415205f51c70f0be7931cc78664cff2
```

| Input | Expected outcome |
|---|---|
| Confirmed native transfer | `confirmed`, 0.009999193962807419 ETH transferred to the recorded recipient |
| Reverted attempt | `reverted`, zero transferred, 0.032847159127382235 ETH attempted in the source transaction |
| Malformed hash | HTTP 422 `INVALID_HASH` with no canonical amount |
| Unsupported chain | HTTP 422 `UNSUPPORTED_CHAIN` with no canonical amount |

Both commands exercised the existing hosted endpoint on 4 November. Each matched all six canonical fields against two RPC sources and passed both refusal checks. The successful responses took 1.291 and 1.484 seconds in this sample and reported `4/4`. These were author-run direct HTTP calls with no Engine delivery record. The workflow covers native ETH. ERC-20 transfers, invoice settlement, and L1 finality are outside its scope.

The command performs three direct public Provider GETs, at most eight read-only RPC POSTs and three public discovery/registration/contract GETs. Each HTTP attempt has a 15-second bound and a 2 MiB response limit. It uses fixed public origins, no wallet/key, no Engine asks, no paid inference and no broadcast. Source-reference methods are only chain ID, transaction, receipt and block reads. Provider and reference reads may share underlying operators; separately implemented arithmetic is not independent ground truth or an external review.

Each run writes a new ignored directory under `reports/provider-acceptance/` containing source/Provider captures, HTTP timings, a capture hash, its `.sha256` sidecar and the result. It also records the Provider correlation header when present and snapshots the public registration, matching discovery entry and concrete contract under `binding`. A failed binding read remains in that capture as an error. Direct source correctness can still pass while that extra snapshot is unavailable. Existing captures are not overwritten. Failed reads remain failures and retain diagnostics; there is no automatic favorable-input search or retry loop. Successful reference reads are decoded separately using integer wei and exact decimal arithmetic. Reverted execution transfers zero even if its attempted value is nonzero. `confirmed` denotes included successful L2 execution, not L1 finality or irreversible settlement.

Replay an existing capture without network access:

```powershell
node tools/mission-tx-acceptance.mjs --replay "C:\path\to\capture.json"
```

The replay reproduces checks of the supplied capture. A file hash or consistent replay does not authenticate a capture's source or the identity of a reviewer. New live captures retain bounded raw response text; the two first preflight captures retain parsed references and original-response fingerprints.

## Compare the hosted pair with a single RPC

```powershell
node tools/benchmark-tx-pair.mjs --freeze
node tools/benchmark-tx-pair.mjs --run <frozen.json-path>
node tools/benchmark-tx-pair.mjs --replay <comparison.json-path>
```

Copy the paths printed by each command. Freeze selects the first qualifying native payment and zero-value contract call from each of two Base blocks at the observed head minus 64 and 65. It corroborates the selected transactions using two RPC operators before calling the hosted Provider or running the baseline. Empty selection slots stay empty. The absence control counts only when both sources return `null` for the selected hash. A failed freeze is retained.

The baseline obtains the transaction and receipt from the official Base RPC in two parallel calls. It returns the same six answer fields but does not corroborate inclusion with another operator. Run compares both answers against the frozen reference, separates invalid-input refusals from unavailable or incorrect answers, and records elapsed time and upstream calls. Replay checks the original hashes and re-scores the saved replies offline. The attempt marker prevents a second live run on the same freeze. Captures stay under ignored `reports/tx-pair-benchmark/`.

On 6 November, both implementations matched all six fields for four mined cases and correctly refused two invalid inputs. ReferenceForge took 639–3,653 ms per mined case and reported 5–7 upstream HTTP requests per case. The direct baseline took 272–454 ms with two RPC requests per case. Three ReferenceForge answers recorded rate-limit retries, all on PublicNode. These are client-observed timings over different network paths in a small author-run sample. The baseline shares a reference source and PublicNode overlaps the hosted service's sources.

PublicNode returned HTTP 403 with a token requirement for the absence probe on both freezes. The official Base endpoint returned `null`. The scored comparison excludes that case. A separate direct diagnostic to the hosted Provider returned `503 RPC_UNAVAILABLE` on the same input. Its response did not identify which upstream failed. The sample measures direct HTTP behavior and cannot establish Engine delivery or mission use.

In a separate local follow-up, Base plus public dRPC matched both sampled mined answers and reached the explicit inconclusive refusal `422 UNSCORED_TRANSACTION_STATE` for the absence probe. dRPC initially rejected the default four-item request with HTTP 400. The follow-up used its documented three-item batch limit. Public 1RPC returned head data that failed the handler's freshness check for all three probes. These observations are limited to the transaction route and local client egress. The dRPC pair is a candidate for further transaction testing, with wallet compatibility and hosted egress performance still unverified. [dRPC batch limit](https://drpc.org/docs/howitworks/ratelimiting) · [1RPC Base endpoint](https://docs.1rpc.io/overview/supported-networks)

## Diagnose the request path

The local V2 candidate gives requests reaching its handler an `x-referenceforge-request-id` response header. Its `v2_request` diagnostic contains that ID, fixed endpoint/Intent names, elapsed time, HTTP status, error code and one of `validation`, `source`, `verification` or `response`. Successful rows include schema/format versions and canonical field names. Transaction verification records mined, reverted, pending or unknown state when source processing reaches that stage. Worker admission refusals occurring before the V2 handler retain the existing `admission_refused` diagnostic. Logging callbacks are awaited and their failures are contained after releasing handler capacity.

The structured event omits query values, hashes, addresses, source URLs, request bodies, headers and error messages. It records the raw Provider's processing stage. The Engine's subsequent field statuses must come from its receipt. Worker log sampling still applies. This is a local implementation awaiting a reviewed release.

## Check a supplied canonical Engine receipt offline

```powershell
node tools/check-tx-node.mjs C:\path\raw-receipt.json C:\path\source-capture.json
```

Both inputs require adjacent `.sha256` files containing hashes of their exact bytes. Use a capture with two corroborating references, the raw Provider response and `binding`, following the format produced by the live command above. Historical captures without a binding still support direct replay. The receipt command requires the binding.

The checker requires registry record `4889` and its owner, verifies the active discovery entry's slug/owner, and compares the receipt's `miner_id` with that discovery ID. The 5 November discovery ID is `1900999000`. Refresh discovery before a real Engine request. A registry number and an Engine miner ID must be resolved through their owning records. The [official Engine documentation](https://anjoman.ai/docs/using/engine-ask) defines the ID through discovery.

The command checks the supplied contract's `1/1` versions, request identity, selected `/v2/tx` endpoint, canonical result, six field statuses, source agreement and signal-hash presence. It rejects raw fallback, partial fields, stale contract versions, duplicate JSON keys, lossy numeric tokens and changed input sidecars. Output lists each field's status and whether its value matches the Provider. Raw Provider `4/4` captures remain supported independently of the shaped receipt's current `1/1` metadata.

Reports are saved under ignored `reports/tx-node-receipts/`. A successful result establishes consistency of the supplied files. Node origin, signal-to-answer binding, execution correlation, score encoding and mission verification remain explicitly unverified. For a real execution, collect its raw signal payload and corroborating source snapshot. A separately timed direct capture can test consistency, but cannot prove what a paid Engine execution consumed. The documented Engine request requires payment authorization and any relevant owner action.

## Verified initial scope and limits

Two known historical Base transactions were checked during this work: one with zero native value and one transferring 0.00195 ETH. Both matched all six canonical fields using fresh reads from Base and PublicNode, and both rejection cases passed. They are deliberately selected real regression examples, not unseen samples, a statistical quality estimate, competitive superiority, independent app consumption or a completed commercial mission. The historical transaction's own block date is separate from this test's capture date.

The captures occurred on 31 October 19:20–19:21 UTC, already 1 November IST but before the event opens at 1 November 00:00 UTC / 05:30 IST. The report therefore records `pre_event`. October evidence is retained as preparation; it is not relabelled as H2 activity. Event classification uses the actual capture timestamp and does not prove that a request was routed through Telegraph.

Remaining requirements include a canonical Engine delivery record for miner 4889, independent same-Intent quality comparison, representative availability and cost measurements, mission-specific review or verified H2 app use, and the final submission. Useful new capability can be assessed before demand grows if a reviewer can reproduce its contribution to the workflow.

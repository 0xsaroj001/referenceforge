# Wallet node shaping and numeric scoring

Checked 4 November 2026 IST. Live read-only checks confirm miner 4889 active, the expected ReferenceForge owner, and wallet request/response versions 1/1 with a numeric balance field declaring six decimals. Local wallet metadata was corrected from 5/5 to 1/1 in the handler and generated manifest. The hosted service has not been updated by this work. The final focused suite passes 72/72, including 15 receipt-consistency checks.

## Two different numeric paths

The current official MIT baseline source at commit `1ed063e2f0066cfaf0e124d66ec6a17b7a6121fd` separates user-facing shape conversion from comparator encoding. In `pkg/scoring/responseparser/shape.go`, numeric conversion returns a float64 after unit/range checks; it does not round the displayed number to the field's `decimals`. Therefore a source-correct balance with more than six decimal places is not, by itself, evidence of a shaping defect. Preserve the exact Provider value and its wei evidence.

In `pkg/scoring/comparator/comparator.go`, `ScaleValue` uses the configured scale, multiplies the float64 value, then applies Go `math.Round` and converts to int64. Configured scale is separate from a response field's decimals; the deployed database configuration and node build are not established by reading source. If the active scale is one million, the saved balance 0.000088441745493652 maps to 88. That is a conditional encoding illustration, not an observed on-network score or permission to round the Provider answer.

Specifically, `responseparser.Field.Decimals` documents **on-chain int256 encoding** (`EncodeOnChain`), not the comparator's int64 scale. The current kit has no compiled wallet fallback configuration; live intent discovery does not disclose the database's wallet scale/code/tolerance. These must not be inferred from `decimals:6`. Older package wording calling this a six-decimal *scoring* boundary was too broad: separate display precision, on-chain encoding and comparator configuration.

The same source exposes important boundaries: wallet zero can be a valid shaped number but the comparator scaling path rejects zero unless the intent uses its PASS_FAIL comparator. A positive value below half a micro-unit can round to zero at scale one million. Large values can fit the wallet schema's 1e15 range while exceeding the int64 scaled domain (approximately 9.223e12 whole units at that scale). Do not fabricate a score, narrow service coverage or alter correct balances merely to mask these upstream boundaries. The actual wallet scale, comparator selection and deployed behavior still need verification.

Auxiliary Provider metadata is not globally rejected by the source's format shaping. The node's own `format_version` and per-field statuses describe its shaped response. Correcting local metadata is useful, but does not prove the node has shaped any answer. At least one successful field can still leave other fields null/rejected, so HTTP 200 and `result_shape:intent` alone are insufficient.

The official kit PR #2 is now merged; older notes calling it open are historical. Current public source is evidence of implementation behavior, not proof of the binary/configuration deployed on the testnet node. Source provenance and exact isolated replay results remain local under `reports/wallet-node-shaping-2026-11-04/`.

An offline Go replay extracted the exact current official `Convert`, `EncodeOnChain`/fixed-point and `ScaleValue` function bodies, retained MIT attribution and source hashes, and used only the standard library with dependency fetching disabled. The saved real balance remains `0.000088441745493652` in the user view and encodes to int256 **88** with six on-chain decimals. This resolves the local six-decimal encoding question. Scoring also produces int64 88 **only in the explicitly injected one-million-scale configuration**. Other reproduced cases: 0.0000004 encodes to 0; 0.0000005 encodes to 1; 1.23456789 remains unchanged in the user view and encodes to 1234568. Zero shapes/encodes successfully but the non-PASS_FAIL scoring mock refuses it; 1e15 fits on-chain int256 encoding while overflowing the injected comparator scale. None of these local executions establishes deployed node configuration.

Official pinned source: [response parser](https://github.com/telegraphprotocol/telegraph-wasm-baseline/tree/1ed063e2f0066cfaf0e124d66ec6a17b7a6121fd/pkg/scoring/responseparser), [comparator](https://github.com/telegraphprotocol/telegraph-wasm-baseline/tree/1ed063e2f0066cfaf0e124d66ec6a17b7a6121fd/pkg/scoring/comparator).

## Offline receipt checks

```powershell
node tools/check-wallet-node.mjs C:\path\raw-receipt.json C:\path\source-capture.json
```

Each input needs an adjacent `.sha256` containing the SHA-256 of its exact bytes. Use a source capture from the *same execution*, containing the raw Provider response and corroborating references. A separately timed direct Provider call is not an interchangeable witness for a future paid Engine call.

The tool performs zero HTTP calls. It requires miner 4889, the wallet intent/endpoint, matching validated input, current contract versions, all five ordered canonical fields and all statuses `ok`, exact source-value agreement, a signal hash, valid source proof, unique JSON keys and numeric tokens without silent precision loss. It saves a new local report. The synthetic CLI demonstration and 15 tests establish only local checker behavior.

A pass is supplied-receipt consistency. Hash sidecars do not authenticate the node, and the mere presence of a signal hash does not verify the signal payload. Node origin, signal-to-raw-answer binding, actual comparator encoding and platform admission remain separate checks. The tool deliberately reports those limits.

## Remaining live gate

The [documented Engine request](https://anjoman.ai/docs/using/engine-ask) is paid, including direct canonical requests to a named miner. This work sends no Engine request and uses no payment/signature or internal-traffic bypass. The [free Daemon feed](https://anjoman.ai/docs/using/daemon-signals) was read once (69 CRYPTO entries); none were ReferenceForge wallet results. That bounded sample does not establish that no historical result exists.

Next evidence needed: an actual authorized canonical Engine receipt for miner 4889, its raw signal payload and correlated source snapshot, plus the active wallet scoring configuration or a supported scoring trace. Raw fallback, parser availability, unit conversion, zero behavior and rounding must be measured on that path. Paid execution requires a specific spending authorization; any wallet signing remains the owner's action. No upload or signing is needed to continue offline source investigation.

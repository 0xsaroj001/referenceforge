# Validation and benchmark methodology

Evidence below describes local development checks captured on 23 October 2026. Re-run the commands in [the demo](../DEMO.md) for a current machine result. Generated reports remain local.

| Check | Captured result | Practical limit |
| --- | --- | --- |
| Node service/unit tests | 27 passed | Authored fixtures and HTTP behavior |
| Rust comparator tests | 6 passed | Arithmetic unit checks |
| Node and wazero ABI corpus | 2,400 vectors in each runtime, repeated | Same authored corpus, not live admission |
| Pinned official arithmetic reference | 2,370 safe-domain matches; 30 separate overflow refusals | Explicit domain exceptions |
| Miner corpus | 35/35 | Authored development cases |
| Input/cache corpus | 14/14 | Authored inputs and injected failures |
| Warm loopback HTTP | 200/200, concurrency 10, one upstream read including priming | Synthetic source; no public capacity claim |
| Live FX and macro transformations | 9/9 matched a Python Decimal implementation | Shared captured upstreams, no independent data provider |
| Live FX API comparison | Both services scored 10,000 on six reads | No scoring advantage observed |
| Context guard demonstration | 18 false accepts without guard, zero with guard; three valid cases retained | 27 synthetic structured cases, outside WASM |
| Local Worker smoke | Eight HTTP/artifact checks passed | Local emulator, not production limits |

## Reproducibility

`bench:miner` and `bench:input-cache` always test the current implementation with self-contained fixtures. They optionally compare our own historical versions when local archives exist; those fields are null in a fresh checkout. No private archive is needed to run the current checks.

Run `build:wasm` before `test:wasm`, then `test:wazero` and `test:official`. The official check fetches the source and MIT license from the fixed revision below only if absent. Both SHA-256 values are verified before execution. Only its package name changes to run it as a standalone Go answer key.

Official repository revision: [992f2650cf99e3d35306a782cf5f39967a121796](https://github.com/telegraphprotocol/telegraph-wasm-baseline/tree/992f2650cf99e3d35306a782cf5f39967a121796).

Source `pkg/scoring/comparator/reference.go` SHA-256: `26e9e139e690398ee751361a5bfde7c48f6d4465f83f8f6a488c2743511af017`.

License SHA-256: `e20635bc37e1ec73cc962c20cf23b0043bfcf20d01dbcefb959238ebc2f8fde1`.

The captured source was an open V2 proposal, not a confirmed deployed node revision. The comparator refuses overflow cases instead of inheriting release-mode wrapping. Do not report full-domain compatibility.

## Performance and source limits

The captured WASM artifact was 2,202 bytes with no imports and 128 KiB initial memory. The microbenchmark uses 25 warmed batches of 20,000 calls and includes JS/WASM crossing. JIT and compilation caching affect results. It is not a cross-machine comparison.

Warm HTTP timings do not resolve cold source latency. A captured cold FX read exceeded the catalogue target, and an earlier World Bank fetch timed out. Public latency, CPU allowance, sustained uptime and useful independent demand remain unmeasured.

Live economic values can be revised. The Python check independently transforms the captured bytes; it does not establish an independent source of truth. The context guard can reject metadata mismatches but cannot detect forged matching metadata or verify arbitrary prose.

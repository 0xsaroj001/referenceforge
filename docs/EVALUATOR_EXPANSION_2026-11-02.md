# Evaluator expansion, 2 November 2026

## Backup readiness, 5 November 2026 IST

We have three local evidence evaluators that can support separate review workflows. The wallet ownership lookup lists only registration 45, now superseded. The live resolver routes transaction lookup and wallet balance through generic scorer 900005, and temperature through WEATHER_CHECK comparator 141. These observations do not establish a ranking failure.

| Priority | Local evaluator | What it checks | Evidence needed before claiming added coverage |
|---|---|---|---|
| 1 | [Transaction evidence](../evaluator-v2/capture-chain-v3.mjs) | Chain, transaction and block identity, recipient, execution status and transferred amount | Fresh reviewer-selected Base cases against a block-number-only baseline. Record a realistic payment decision affected by an incorrect recipient or value. |
| 2 | [Wallet balance evidence](../evaluator-v2/wallet-evidence.mjs) | Native balance, request and pinned block identity, exact units and source agreement | Fresh exact-quantity and wrong-wallet cases. Obtain the active scoring configuration before making claims about its numeric behavior. |
| 3 | [Weather evidence](../evaluator-v2/weather-evidence.mjs) | Observation freshness, station identity, distance, units and temperature | Show fresh examples that detect stale or wrong-station evidence and compare with a temperature-only check. |

Run the local readiness checks from the repository root:

```powershell
node --test test/evaluator-v2-capture-chain.test.mjs test/wallet-evidence-evaluator.test.mjs test/weather-evidence-evaluator.test.mjs test/comparator-v2.test.mjs
```

All 36 checks passed in the 5 November run. These are development tests. The evidence evaluators are supporting material for the track. Comparator v2 is the separate local runtime candidate.

The [official module guide](https://anjoman.ai/docs/scoring/build-a-scoring-module#what-actually-happens-when-you-deregister) describes a single active module per Intent and restoration of the previous module when the current one is deregistered, if the previous module is still retained. This makes two or three distinct evaluation contributions useful as portfolio backups. Registrations on separate families provide separate coverage. They do not fail over for each other.

Live update, 3 November at 14:12 UTC: original registration 45 is now **superseded**, with its correctness gate preserved. The new comparator and wallet/weather evidence evaluators below remain local and are not admitted replacements. See [current status](LIVE_STATUS_2026-11-03.md); the following build description retains its original date.

The requested work is more useful evaluators. Current state is one active numeric comparator (registration 45) and a separate local transaction-evidence policy. All deterministic families require the same numeric rule; judgment/hybrid registration requires a trained LoRA safetensors delta on the pinned Foundation Model. A renamed binary does not add measurement quality. The official [build guide](https://anjoman.ai/docs/scoring/build-a-scoring-module) and [training guide](https://anjoman.ai/docs/scoring/train-a-scoring-adapter) were checked before implementation.

The bounded build has three pieces:

1. A new freestanding comparator with 32 isolated live comparison-spec allocations, correct exhaustion, invalid-pointer refusal and zeroization/reuse. The old single static slot aliases two simultaneously live allocations. Numeric scores retain the existing documented safe-domain behavior, including saturating arithmetic and explicit signed-overflow refusal. This is an allocator/ABI improvement, not better judgment quality or permission to register copies across families.
2. A wallet-balance evidence evaluator for the concrete native ETH contract, checking two supplied RPC captures, chain/block/query identity, exact amount interpretation and canonical answer fields. A balance without block/source identity cannot establish a reproducible gold label.
3. A current-weather evidence evaluator checking official NWS capture shape, station identity, distance, observation age, unit conversion and the canonical temperature. A stale or wrong-location observation cannot establish a current-weather gold label.

Who benefits: comparator hosts that retain multiple specs, and contributors/reviewers who need reproducible native-balance or temperature labels rather than answer-shape checks. The latter two are local evidence evaluators and supporting material. They are not neural models or registerable model adapters. No new App-track entry is involved.

Failure priorities before implementation:

1. False correctness: independent reference cases freeze before comparator target access; preserve all old artifacts, frozen corpora and failures. Author-run regression counts are not independent adoption or unseen model quality.
2. Memory aliasing and stale contents: distinct live pointers, bounded capacity, exact pointer/size checks and zeroization on free/allocation. Raw ABI pointers cannot carry generation identities after reuse.
3. Arithmetic drift: retain low-32-bit comparison code, signed input bounds, saturating score/window rules and quantified overflow refusals; compare against an independent integer reference and the existing binary on declared shared inputs.
4. Evidence identity/units/freshness errors: supplied clocks and captures are explicit, missing or inconsistent evidence abstains, wrong canonical answers reject. Mutually consistent JSON is not cryptographic inclusion, source authenticity or finality.
5. Registration confusion: only the new comparator can potentially enter deterministic WASM admission. Hosting, actual hidden-gate acceptance, registry signing, activation and hackathon submission remain separate. Wallet signing stays with the owner.

Source captures, fresh review cases and reports stay local under ignored `reports/evaluator-expansion-2026-11-02/`. Private existing questions, competitor research and wallet journals are excluded from publication and runtime bundles.

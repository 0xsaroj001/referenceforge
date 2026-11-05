# ReferenceForge architecture

Updated 29 October 2026. Original implementation reference. Current platform admission requires [Anjoman V2 migration](docs/ANJOMAN_V2.md).

## Existing service flow

HTTP request → bounded input/scope checks → numeric, on-chain or weather handler → bounded source read/cache → semantic validation and unit conversion → result with timestamps and provenance, or explicit refusal.

| Component | Responsibility |
|---|---|
| src/unified.mjs | Dispatches existing capability routes |
| src/v2.mjs | Five concrete intent adapters; canonical fields plus original evidence; strict precision/scope refusals |
| src/miner.mjs, src/decimal.mjs | ECB FX, World Bank annual indicators, conversion and exact decimal handling |
| src/upstream.mjs | Allowlisted numeric upstreams, bounded reads/timeouts, cache validation and coalescing |
| src/onchain/ | Base/Base Sepolia RPC, transfer verification, pinned metrics, transaction and wallet lookups |
| src/weather.mjs | NWS point/hourly/station/alert semantics with geographic, age and request bounds |
| deploy/v2-worker.mjs | V2 plus legacy dispatch, ten explicit public assets and shared isolate-level admission |
| contracts/v2-intents.json | Dated official request/response contract fields, excluding all participant catalogue data |
| evaluator-v2/ | Separate original evaluation-material audit code; private seed stays outside served assets |
| src/weather-brief.mjs, src/weather-window-planner.mjs | Original offline consumer demonstrations |
| tools/lib/weather-* | Offline evidence validation/analysis; synthetic checks remain explicitly labelled |
| wasm/ | Historical original comparator; development and registration stay stopped |

## Trust and source boundaries

Numeric, RPC and NWS responses undergo their own bounded semantic checks. Unsupported chain, unit, geography, date or metric is not silently substituted. Missing values remain unavailable; source failure cannot become zero or an all-clear answer. The Kansas 0.5.4 fix permits one bounded same-station history page without relaxing freshness/distance limits.

Source URLs, SHA-256 hashes and local fetch timestamps identify captured bytes. They do not independently authenticate an upstream's truth or attest pre-target capture time. Offline artifact checking and statistical analysis retain that distinction.

Alchemy credentials remain encrypted Worker secrets. Wallet-signing code is confined to owner terminal tooling, outside the served Worker bundle. Competitor research, reports, local strategy and credentials are excluded from public assets.

## V2 integration boundary

The API retains ten legacy capability families. `src/v2.mjs` and the descriptor select five concrete subsets with canonical inputs, root fields and exact units. After fixing the anonymous RPC source, all five local workerd live responses pass field conformance. The original dRPC failure remains recorded. `tools/lib/v2-validation.mjs` checks provider fields and platform replies separately; it does not fabricate node field statuses. Admission and ranked routing require actual platform evidence.

The prepared V2 Worker boundary permits fourteen original runtime modules and ten explicit public assets, preserving eight historical artifact byte sequences and adding a candidate descriptor/manifest. The Evaluator questions, audit outputs, local strategy, wallet tooling and source archives are absent from that package. See [live status](docs/LIVE_STATUS_2026-11-03.md) for the indexed Provider and deployed runtime.

Local correctness, public HTTP service, current deployment identity, node admission, shaped outputs, ranked routing, independent mission use and H2 submission are separate gates. See [requirements](docs/REQUIREMENTS_AND_EVIDENCE.md) and [deployment gates](docs/DEPLOYMENT.md).

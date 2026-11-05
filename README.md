# ReferenceForge

Original source-backed numeric, blockchain and weather Provider, with a separate V2 evaluation-material contribution and original deterministic comparator. Current campaign: **Telegraph Season II, Providers and Evaluators**. Live status checked 3 November 2026 at 14:12 UTC; see [current evidence and gates](docs/LIVE_STATUS_2026-11-03.md).

Start with [documentation index](docs/INDEX.md), [current rules](docs/SEASON_II_RULES.md), [V2 migration](docs/ANJOMAN_V2.md), [requirements and evidence](docs/REQUIREMENTS_AND_EVIDENCE.md) and [submission checklist](docs/SUBMISSION_CHECKLIST.md).

## Current state

| Layer | Verified state |
|---|---|
| Original service | Ten retained legacy families and five concrete V2 routes; public runtime 0.7.0 |
| Latest coverage | Exact US place/state weather resolution using pinned Census data; 1..48-hour NWS scope remains |
| Tests | 561/561 automated checks; local workerd, 17-module boundary audit, twelve public asset pins and city current/forecast checks pass |
| New platform | [Anjoman](https://anjoman.ai/); Provider tools at /dashboard/earn and /dashboard/registrations |
| V2 discovery | 136 concrete intents observed; twelve candidate names inspected across our ten families |
| V2 admission | Miner 4889 active in the node with referenceforge-places-v2.yaml and five concrete Intents; hosted SHA-256 matches the indexed hash. Replaces 4864 |
| Live sources | All five concrete routes pass live-source field checks after the anonymous RPC fix. Deployed legacy Alchemy wallet check also passes |
| Forecast evidence | 52/72 paired hours; forecast MAE 1.563250 C versus persistence 1.550000 C. No superiority established |
| Submission/adoption | Neither H2 submission nor independent H2 consumption verified |
| Evaluation material | Original synthetic material/frozen baselines preserved. Fresh supported-domain agent review matched 12/12; separate post-freeze chain inconsistency fixed in optional v3, with no unseen v3 quality claim |
| Original WASM | WEATHER_CHECK registration 45 now superseded; its recorded deterministic gate remains 1120 cases, zero mismatches. Temperature routes through the family, currently champion 59 |

The competition runs 1 November to 1 December 2026. Final cutoff: **1 December 23:59 UTC / 2 December 05:29 IST**. H2 transaction/activity evidence must come from the event period. Registration on the protocol is separate from registration and final submission on the H2 website.

## Local development

Node.js 24+, Python 3 and locked dependencies:

```powershell
npm ci
node tools/release-places.mjs --check
node node_modules/wrangler/bin/wrangler.js dev --config deploy/places.wrangler.jsonc --local --ip 127.0.0.1 --port 8797
```

In a second terminal run `node tools/smoke-places.mjs --live`. These commands publish nothing; live smoke makes free direct upstream source requests. The local release check includes the full test suite and pinned Census preparation. See [US place weather](docs/US_PLACE_WEATHER.md), [Evaluator material](evaluator-v2/README.md), [architecture](ARCHITECTURE.md), [on-chain service](docs/ONCHAIN_MINER.md) and [weather service](docs/WEATHER_MINER.md).

## Current work

The [local verification package](docs/VERIFICATION_PACKAGE.md) adds a reproducible wallet workflow and comparator-v2 runtime gates. Start offline with `npm run demo:wallet`. Its direct-source, synthetic-review and local-runtime results remain separate from platform admission.

The [4 November wallet follow-up](docs/WALLET_NODE_SHAPING.md) fixes local schema metadata to 1/1 and reproduces six-decimal on-chain encoding while preserving the exact displayed balance. Its focused suite passes 72 tests. Actual Engine-shaped output and deployed comparator configuration remain unverified; no upload or signing occurred.

Use `node tools/release-places.mjs --check` for the current runtime. The [place descriptor](docs/US_PLACE_WEATHER.md) is public and indexed by active miner 4889; do not repeat the completed registration using an older handoff. Current node shaping, fair quality comparisons and real useful consumption remain separate evidence gates. Comparator v2 and the evidence evaluators are available as source for local verification. Old Base repair tools must not be redirected. See [live status](docs/LIVE_STATUS_2026-11-03.md).

Competitor repositories, derived strategy, reports, credentials and wallet journals remain local. Obsolete guides are archived locally.

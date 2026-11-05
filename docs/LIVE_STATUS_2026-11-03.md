# Live status, 3 November 2026

Read-only checks at **14:12 UTC / 19:42 IST** supersede older onboarding and activation notes. No signing, upload, registration, deployment, payment or submission occurred in this refresh.

| Stage | Observed state |
|---|---|
| Public Provider | [Health](https://referenceforge.0xsaroj001.workers.dev/health) returns HTTP 200 and runtime 0.7.0 |
| Indexed Provider admission | [Miner 4889](https://devnode.telegraphprotocol.com/api/miners/4889) is active with the five concrete Intents below; it replaces 4864 |
| Exact descriptor | [referenceforge-places-v2.yaml](https://referenceforge.0xsaroj001.workers.dev/referenceforge-places-v2.yaml) returns HTTP 200; downloaded SHA-256 `431fe66212568d452c647c69c9c3c26f464bc0babbac79ff83e03f74a860a168` equals the indexed hash |
| Original evaluator | [Registration 45](https://devnode.telegraphprotocol.com/engine/validator/v1/wasm/45) now reports **superseded**, updated at 07:21:35 UTC on 3 November; its recorded 1,120-case, zero-mismatch deterministic gate is preserved |
| Current family routing | [Temperature resolution](https://devnode.telegraphprotocol.com/api/wasm?resolve=WEATHER_CHECK_TEMPERATURE) still reports `routed:true` through `WEATHER_CHECK`; the resolver lists active champion 59 and registration 45 as rank 2, replaced |
| Original runnable hosting | [Comparator health](https://referenceforge-comparator.0xsaroj001.workers.dev/health) returns HTTP 200; hosting does not restore champion status |
| New local evaluators | The comparator-v2 public health URL returns HTTP 404. The new comparator and wallet/weather evidence evaluators remain local work, with no new admission established |
| H2 outcomes | No new H2 registration/submission receipt, independently verified consumption, judge score or award was checked |

The indexed Provider owner and fee address remain `0xfec66e0f5c64296ff190edced88c781eeedfd9d3`. This is the ReferenceForge owner, distinct from the bounty contributor account. Supported concrete Intents are `MACRO_ECONOMIC_INDICATOR_GENERAL`, `ONCHAIN_TX_LOOKUP_GENERAL`, `WALLET_BALANCE_CHECK_GENERAL`, `WEATHER_CHECK_TEMPERATURE` and `WEATHER_FORECAST_GENERAL`.

These are current node, hosted-byte and routing observations. This refresh did not independently inspect the miner replacement's chain transaction or an authenticated validation receipt. Those missing receipts do not justify repeating the already completed places-descriptor registration. Historical 4840/4864 funding, validation and update handoffs are retained as dated evidence.

The next Provider gates are actual node-shaped canonical outputs, fair same-Intent quality/reference comparisons, service reliability/economics and verifiable useful H2 workflows. Do not generate traffic to imitate independent consumption. The next evaluator gate is a distinct, justified contribution with its local runtime/reference checks completed before any hosting or owner admission step. A renamed or duplicate original binary does not meet that gate; supersession alone is not evidence of a numerical defect.

The current [official rules](https://hackathon.telegraphprotocol.com/rules) frontend dataset was also read without executing it. Providers now use weights **35/15/10/10/5/5/20**; Evaluators use **40/15/10/10/5/20**. Both include 20 points for organic growth, education and developer activation. Technical minima remain 24/35 and 28/40 respectively, with 70/100 overall. These replace the older weights in dated notes; no points or eligibility are self-awarded. See [rules summary](SEASON_II_RULES.md).

Original responses, failures, descriptor bytes, rule-page source and SHA-256 metadata stay local under ignored `reports/status-2026-11-03T14-12-24-601Z/`. No competitor artifact was downloaded or executed, and no private evaluation material was published.

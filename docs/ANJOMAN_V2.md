# Anjoman and Telegraph V2

**Current status, 3 November 2026:** runtime0.7.0 and active miner4889 index the place descriptor; evaluator45 is now superseded. See [live status](LIVE_STATUS_2026-11-03.md). The deployment/import/funding observations below are dated history.

Checked 29 October 2026. [Anjoman](https://anjoman.ai/) is a beta outcome-oriented Telegraph interface, not a separate verified hackathon. Competition entry and submission remain at the [Season II website](https://hackathon.telegraphprotocol.com/).

## Current surfaces

| Purpose | Official surface |
|---|---|
| Describe a job/outcome | https://anjoman.ai/ |
| Provider onboarding | https://anjoman.ai/dashboard/earn |
| Registration status | https://anjoman.ai/dashboard/registrations |
| Current protocol documentation | https://anjoman.ai/docs |
| V2 changes | https://anjoman.ai/docs/whats-new-v2 |
| Miner YAML | https://anjoman.ai/docs/miners/yaml-config |
| Registration | https://anjoman.ai/docs/miners/miner-registration |
| Intent model | https://anjoman.ai/docs/using/intents |
| Deployment parameters | https://anjoman.ai/docs/protocol/addresses-and-params |

Earn requires sign-in for registration tools. Read-only public inspection did not sign in, submit YAML, register a project, purchase intelligence or broadcast a transaction.

The Earn UI describes USDC payment, while the protocol overview describes USDC-funded MACHINA settlement. Actual payout behavior and competition prize terms must be verified separately; this documentation claims no realized earnings.

## Migration requirements

1. Register concrete Intents, never family prefixes. The old ten names describe our service families; they are not a new registration-ready list. The live HTTP discovery returned 136 intents, including the candidate names in [the requirements map](REQUIREMENTS_AND_EVIDENCE.md).
2. Read each Intent's live request, response and on-chain schema using GET /engine/v1/intents/{intent}. Some return null request/response schemas; do not invent a typed contract.
3. Adapt native parameter names and output fields deliberately. V2 supports declarative intent_mapping. Existing signal_mapping/score_value alone does not prove shaped V2 output.
4. Reproduce all relevant constraints and scope errors. Publish only compatible pairs, with geographic, chain, freshness and window limitations declared.
5. Pin YAML bytes with SHA-256, validate schema and sandbox behavior, then verify the current deployed chain/registry ABI, owner/imported identity and exact selected intents before preparing a replacement owner-run transaction.
6. After owner execution, verify receipt, live registration, catalogue, shaped response fields and actual applicable ranked routing separately.

The V2 deployment is now reconciled from current app configuration, deployed code, catalogue and owned-import reads: **Ethereum Sepolia 11155111**, registry `0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b`, imported owned registration **4840**. The address page still showed the older Base Sepolia deployment. See [live status](LIVE_STATUS_2026-11-03.md) for the subsequent Provider registration. Never redirect an old signing helper automatically.

## API changes that affect our evidence

Responses may now provide result_shape, format_version, field_status and shape_error. The old parsed object is removed. A successful HTTP response with result_shape=raw is not proof that every required canonical field was produced. Validate each field status.

Typed intent + params requests are checked against request schemas before payment; query/context conflicts must be refused. Direct asks choose a miner; they are distinct from ranked routing and cannot prove ranked-routing award points.

## Current incompatibilities

FX daily ECB references are not demonstrated live mid-market quotes. A current storm Intent asks for a risk_score in [0,1], not simply an issued-alert count. Forecast requests expose windows up to 240 hours; our service covers 48. A city-name interface needs accurate location resolution before our coordinate-only weather API can satisfy it.

The V2 change log replaces old MiniLM/rank_answer and Q32.32 packages with float model-adapter WASM and runnable endpoints, registered at prefix level. Keep our old comparator stopped and archived as historical original work. A separate original [V2 evaluation-material build](../evaluator-v2/README.md) is now authorized and tested locally; it claims no trained adapter or network admission.

Official docs can be inconsistent with each other or an observed deployment. Retain dated evidence, report discrepancies, and do not treat a documentation example as live admission.

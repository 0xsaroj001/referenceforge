# Network quality checkpoint

**Current status, 3 November 2026:** runtime0.7.0 and active miner4889 index the place descriptor; evaluator45 is now superseded. See [live status](LIVE_STATUS_2026-11-03.md). The deployment/import/funding observations below are dated history.

Updated 29 October 2026. New [V2 documentation](ANJOMAN_V2.md) supersedes the old flat-intent integration assumption.

Earlier same-day checks found old-chain active records 4851/4864 but current node 404s and history listing 4840. Discovery advertises concrete suffix names. The earlier reading of these labels as merely an indexing anomaly was incomplete: V2 documents prefix/sub-intent changes and a fresh deployment/import process. This supports a migration investigation; it does not prove the exact current registry or the reason an individual record is absent.

Current HTTP discovery returns 136 concrete intents. All twelve selected candidate detail GETs returned 200. Request/response schemas can be null, and schema contents are narrower or different than broad catalogue descriptions. [Requirements map](REQUIREMENTS_AND_EVIDENCE.md) records the practical consequences.

Existing public runtime reports0.5.2. Local0.6.0 passes 496/496 tests and workerd asset/boundary checks. After the anonymous RPC fix all five concrete live responses pass field conformance, including wallet and mined tx. A deployed legacy wallet probe confirms its Alchemy account pair works. Imported V2 registration4840 remains active with four older claims and is not yet updated. No authenticated platform validation, new ranking, score recovery, owner migration, event-period consumption or H2 submission is established. See [RPC diagnosis](V2_RPC_VERIFICATION.md) and [live status](LIVE_STATUS_2026-11-03.md) for the subsequent registration.

A source outage, request-builder outage, unsupported chain, missing field and schema mismatch need different fixes. Preserve failed payload evidence when available. Old score snapshots remain historical and cannot be used as a current V2 score.

Next useful checks are configured-RPC V2 behavior, platform conformance and owner-reviewed bond/update semantics. Deployment/ABI/import reconciliation is complete. Do not repeatedly probe unchanged failures, manufacture requests, or expand synthetic weather experiments without a mission requirement.

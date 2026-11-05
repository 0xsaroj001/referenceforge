# Deployment and registration gates

Current reference: [Anjoman V2 migration](ANJOMAN_V2.md). The existing permanent Worker origin is https://referenceforge.0xsaroj001.workers.dev. Static GitHub files do not host the dynamic service.

Current public runtime is **0.7.0**, Cloudflare version `1ec7280b-6359-47c9-9395-3044e7e67f9f`, deployed 2 November 2026. It retains ten legacy families, five concrete V2 routes and all ten previously published asset bytes, and adds explicit US place/state weather resolution plus two separate descriptor/manifest assets. The release passes 561 tests, local workerd checks, a 17-module boundary audit, twelve public asset hashes and both public city weather workflows. See [US place weather](US_PLACE_WEATHER.md) for source pins, scope and exact new descriptor inputs.

Live refresh on 3 November at 14:12 UTC confirms miner 4889 active with the place descriptor and all five concrete Intents. The downloaded descriptor hash matches the indexed hash; 4864 is superseded as the current Provider identity. Evaluator 45 is now superseded, while temperature still routes through WEATHER_CHECK with champion 59. See [exact status and evidence limits](LIVE_STATUS_2026-11-03.md). Earlier update simulations, 0.6.0 release evidence and the initial timeout remain historical; no completed registration should be repeated from those handoffs.

Before another upload or owner transaction:

1. Establish the authoritative live V2 chain ID, RPC, registry address and ABI; reconcile current discovery with the older contract.
2. Identify the actual owned/imported registration and slug. Preserve historical IDs and attempt journals.
3. Pin concrete eligible intent names and full request/response contracts.
4. Render a V2-compatible descriptor with deliberate native request and answer-field mappings.
5. Test source correctness, scope, units, current output fields, failures, concurrency and declared limits for every advertised pair.
6. Verify hosted exact bytes/hash, authenticated platform validation where required and free sandbox behavior.
7. Prepare a new fixed, duplicate-safe owner-run update with a fresh review. Key entry and signing stay in the owner's terminal.
8. Verify the resulting chain receipt, current node identity, catalogue, compatibility and applicable routing separately.

Use `node tools/release-places.mjs --check` for the current runtime. Its `--deploy` mode also requires fresh local live smoke bound to the exact bundle, data, configuration and descriptor. The older `release-v2 --deploy` refuses to overwrite public 0.7.0 with 0.6.0. Current Provider indexing is complete; a later change needs its own fresh validation and owner review. Never reuse the old Base repair; old public artifact bytes remain pinned.

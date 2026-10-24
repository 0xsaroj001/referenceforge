# ReferenceForge architecture

## Request flow

`HTTP request -> parameter/scope validation -> bounded source client -> source parser -> exact decimal transformation -> context and provenance response`

The Node server and Worker share the same miner implementation and response envelopes.

| Module | Responsibility |
| --- | --- |
| `src/server.mjs` | Node HTTP transport, GET and JSON POST, input bounds |
| `src/miner.mjs` | Currency orientation, indicator mapping, observation selection and scope refusal |
| `src/upstream.mjs` | Fixed HTTPS hosts, shared timeout, retry, bounded cache and request coalescing |
| `src/decimal.mjs` | Integer/rational decimal parsing, original JSON numeric-token precision and formatting |
| `src/responses.mjs` | Shared health and error envelopes |
| `src/evaluation.mjs` | Structured-context guard, explicit fixed-point scaling and WASM invocation |
| `deploy/worker.mjs` | Fetch transport and three explicitly exposed artifact paths |
| `wasm/comparator/src/lib.rs` | Original deterministic comparator and 16-byte ABI allocation |

## Source boundary

Only the configured ECB and World Bank HTTPS hosts are fetched by the miner. Redirects are refused. Source responses have a 1 MB limit; four reads may be active concurrently. Two attempts share an eight-second budget. Successful payloads are validated before entering a cache of at most 128 entries.

Pending requests are coalesced. Invalid cached payloads and observations that become stale within a cache TTL are refreshed. Failed reads do not become plausible numeric answers.

Source URL, SHA-256 and fetch time describe captured bytes. They are provenance fields, not upstream signatures or independent confirmation of economic truth.

## Numeric boundary

FX cross-rates use rational arithmetic and render 12 decimal places. Annual macro values retain their source decimal representation. Conversion to WASM integers occurs only with a declared positive scale and signed 64-bit range checks.

The comparator uses signed 64-bit saturation where required by the pinned reference and wider multiplication for relative error. It refuses zero truth and signed difference/absolute-value overflow. The ABI is serial: allocation supplies one static 16-byte specification, so simultaneous outstanding specifications are unsupported.

## Deployment boundary

The Worker serves only `miner.yaml`, `referenceforge-comparator.wasm` and `artifact-manifest.json` as public assets. The bundle checker verifies that asset set, hashes and source-map paths. Research, local reports and generated build directories are excluded from Git.

The server has no registration transaction or payment integration. A successful HTTP request, hosted artifact, validator pass and network registration are separate evidence states.

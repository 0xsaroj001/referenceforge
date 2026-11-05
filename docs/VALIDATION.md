# Validation requirements

The [Validation API documentation](https://anjoman.ai/docs/miners/validation-api) still describes the older POST https://integrate.telegraphprotocol.com/api/validate. A 29 October request returned 404. Current Anjoman Earn JavaScript uses `POST https://anjoman.ai/api/registrations/validate` with `{yaml, apiKey?}` and an authenticated session; a request without a session returned 401. Do not claim the old documented anonymous route is working. Current authenticated validation remains an owner gate.

A wallet signing key is never an upstream API key. Our Alchemy credential stays in the Worker secret, outside public YAML and documentation.

Validation has several distinct checks:

| Gate | Needed evidence |
|---|---|
| Declarative schema | Required fields, closed key sets, valid params and exact concrete intents |
| Identity | Owned slug, unique logical ID and applicable imported registration |
| Endpoint sandbox | Actual request/response and platform validation result |
| Semantic correctness | Correct value, chain, time, units and Intent fields on realistic new inputs |
| Failure behavior | Honest refusal and no successful signal made from error content |
| Network admission | Current registration and indexed catalogue |
| Serving workflow | Compatible shaped result and real routing/accounting evidence |

The official sandbox may treat reachable 4xx responses other than authentication failures as a pass. Reachability therefore does not prove task correctness. A 422 checkmark cannot replace semantic tests.

Current local tests are 496/496. All five live-source V2 responses pass canonical version, field/type/range and provenance checks through local workerd. Ten asset hashes and private-path refusals also pass. The original shared-public dRPC wallet failure is preserved; the verified anonymous pair now passes. `node tools/validate-v2.mjs --local` checks contract mappings; `--hosted` additionally checks exact public descriptor bytes after owner deployment; `--platform` attempts the current authenticated route without bypassing login and fails on401. It never accepts a reachable422 as fulfilled validation. No platform acceptance, new admission or ranked score is established. See [live status](LIVE_STATUS_2026-11-03.md) for the subsequent admission.

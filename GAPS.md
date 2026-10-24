# ReferenceForge open gaps

Updated 24 October 2026.

| Gap | Current evidence | Closing evidence |
| --- | --- | --- |
| Stable public origin | Worker package and local emulator checks | Provider deployment URL plus external exact-byte fetches |
| Production limits and latency | Warm loopback tests and a few cold source reads | Public measurements and provider runtime metrics |
| Miner validation | Descriptor generation and local HTTP tests | Authenticated Telegraph validator result |
| Descriptor identity | Candidate numeric ID only | Successful identity/conflict validation |
| Live WASM interface | Pinned official V2 source checked locally | Admission using the actual deployed interface |
| Overflow compatibility | 30 deliberate refusals in the test corpus | Confirmed acceptance policy or an explicitly supported domain |
| Competitive advantage | Local regression gains; live FX comparison tied | Valid live scores and useful independent usage |
| Evaluation material | Small authored structured-context corpus | Independently reviewed coverage and applicable admission |
| Registration and submission | No receipts | Actual network registration and submission confirmation |

## Limits that remain visible

The FX endpoint supplies daily references. It must refuse spot/intraday requests, even if that reduces task coverage. The World Bank can revise past annual values. Network failures, upstream revisions and cold source latency remain operational risks.

Context checking occurs outside WASM and relies on declared metadata. The 27-case context demonstration uses synthetic mutations around three captured observations. It does not establish arbitrary-answer verification or hidden-set accuracy.

The 2,400-vector WASM suite includes 30 deliberate compatibility exceptions. The pinned official source is an answer key for that revision, not proof that a live node runs it. No local result establishes eligibility, admission, prize placement or a payment flow.

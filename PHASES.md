# ReferenceForge implementation phases

Updated 24 October 2026.

| Phase | Deliverable | State |
| --- | --- | --- |
| 1. Original service | ECB FX, annual World Bank macro, exact decimals, explicit refusal | Implemented and locally tested |
| 2. Comparator | Original Rust ABI, Node and wazero conformance checks | Implemented; overflow exceptions documented |
| 3. Reliability | Alias conflicts, payload validation, bounded retry, cache recovery | Implemented with authored regression cases |
| 4. Reproducibility | Standalone documentation, optional historical baselines, pinned official test source | Fresh-checkout checks passed; original source committed |
| 5. Hosting | Stable HTTPS origin and exact-byte artifact smoke check | Deployed and verified on 24 October 2026 |
| 6. Telegraph validation | Authenticated endpoint results and actual WASM admission contract | Pending |
| 7. Network evidence | Accepted registration, later valid scoring results and useful usage | Pending |
| 8. Submission | Final reproducible evidence and confirmed submission receipt | Pending |

## Next execution gates

1. Use the [verified upload handoff](UPLOAD_TO_TELEGRAPH.md) to validate the miner and resolve every reported conflict.
2. Confirm the live comparator interface and supported refusal behavior before evaluator registration.
3. Record network results separately from local benchmarks and public hosting checks.
4. Measure sustained public latency and reliability; the first macro request timed out before later recovery.

Further capability expansion should follow measured task fit and successful admission. No additional application build or duplicate comparator registration is included in this scope.

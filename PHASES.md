# ReferenceForge implementation phases

Updated 24 October 2026.

| Phase | Deliverable | State |
| --- | --- | --- |
| 1. Original service | ECB FX, annual World Bank macro, exact decimals, explicit refusal | Implemented and locally tested |
| 2. Comparator | Original Rust ABI, Node and wazero conformance checks | Implemented; overflow exceptions documented |
| 3. Reliability | Alias conflicts, payload validation, bounded retry, cache recovery | Implemented with authored regression cases |
| 4. Reproducibility | Standalone documentation, optional historical baselines, pinned official test source | Source publication checks |
| 5. Hosting | Stable HTTPS origin and exact-byte artifact smoke check | Pending account login and deployment |
| 6. Telegraph validation | Authenticated endpoint results and actual WASM admission contract | Pending |
| 7. Network evidence | Accepted registration, later valid scoring results and useful usage | Pending |
| 8. Submission | Final reproducible evidence and confirmed submission receipt | Pending |

## Next execution gates

1. Complete hosting authentication and confirm the actual origin.
2. Render the descriptor with a candidate ID, build artifacts and audit the exact upload set.
3. Verify public endpoint behavior and fetch/hash the hosted YAML and WASM.
4. Validate the miner in the integration console and resolve every reported conflict.
5. Confirm the live comparator interface and supported refusal behavior before evaluator upload.
6. Record network results separately from local benchmarks.

Further capability expansion should follow measured task fit and successful admission. No additional application build or duplicate comparator registration is included in this scope.

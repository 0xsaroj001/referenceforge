# ReferenceForge verification package

Completed 4 November 2026 IST. This local package strengthens the existing Provider and original deterministic comparator work. It creates no additional registration. Nothing in this build was signed, uploaded, deployed or submitted.

Follow-up: [wallet node shaping and scoring](WALLET_NODE_SHAPING.md) corrects local wallet metadata, distinguishes displayed precision from comparator scaling, and records the remaining paid-node/configuration evidence gate. Its focused suite passes 72 checks; the original 52-test package checkpoint below remains historical.

## Reproduce the wallet workflow

Use Node.js 24+ from the repository root:

```powershell
npm run demo:wallet
node --test test/wallet-proof.test.mjs test/wallet-proof-cli.test.mjs test/wallet-evidence-evaluator.test.mjs test/comparator-v2.test.mjs
```

The offline demonstration uses fictional data and makes zero network requests. It accepts a consistent nonzero balance and rejects a wrong-wallet answer with the same number. The final combined suite passes **52/52**, with zero skips. See [wallet guide](WALLET_VERIFICATION_GUIDE.md) for bounded free live checks and hash-checked offline replay. Replay reports current HTTP calls separately from the original capture's calls.

A 3 November live Base Sepolia capture matched a nonzero native balance against two fixed RPC services at the disclosed block hash, including a canonical-header recheck and three invalid-input refusals. It completed 16 HTTP calls, zero Engine asks and zero payments. The final CLI replays that capture successfully with zero new HTTP calls. An earlier Base transport failure is preserved; one successful run does not establish sustained reliability.

A separate agent froze synthetic expectations before reading the checker. Its explicit composed evidence-envelope replay matched **15/15** expectations, including a raw JSON token that loses one wei when parsed as a JavaScript number. The strict answer-only projection is **15 NOT_RUN**, because the frozen specification separates evidence from answer JSON. Supplemental head/completion/header fields are synthetic adapter inputs. The initial masked adapter failure is retained. This is bounded second-model development review, not independent human certification or an unseen benchmark. The review's freshness policy differs at boundaries from the checker's policy, and those boundaries were not adjudicated. A later CLI-only reporting fix separated replay calls from captured calls; the reviewed checker is unchanged.

## Reproduce the comparator gate

Prerequisites: locked npm dependencies, Rust and its `wasm32-unknown-unknown` target, plus the pinned original comparator at `deploy/v2-public/referenceforge-comparator.wasm`. Cargo builds offline and locked. From the repository root:

```powershell
npm run build:comparator:v2
$env:WRANGLER_SEND_METRICS='false'
node node_modules/wrangler/bin/wrangler.js deploy --config deploy/comparator-v2.wrangler.jsonc --dry-run --minify --outdir ../dist/comparator-v2-worker
cargo test --offline --locked --manifest-path wasm/comparator-v2/Cargo.toml
node --test test/comparator-v2.test.mjs
npm run check:comparator:v2
```

The literal `--dry-run` packages locally without uploading. The checker manages its own local workerd runtime and rejects public modes. It verifies source/build/asset identity, exact one-MiB acceptance, streamed oversize refusal, duplicate-key refusal, concurrent isolation and private-path refusal.

Results: **10 ABI tests**, **2 native Rust tests**, **612 generated numeric cases twice**, zero mismatches, and parity with the original binary on those 612 cases. The owner's additional protected replay passes **40 unchanged cases** using `node tools/check-comparator-v2.mjs --require-private-replay`. Without protected data the default source-kit check honestly reports that replay not run; required-private mode refuses its absence. The source-kit reproduction reused installed dependencies and is not a clean-machine installation claim. Never distribute the protected corpus to reproduce this optional gate.

Artifact: 2,322 bytes, zero imports; SHA-256 `2b56e8154600f04f6c42029c50cbf754eacb797482931fb463c11ea9435f44f0`. Rust source and binary were unchanged by this verification pass. The repaired checker demonstrates v2's existing isolated allocations when multiple specs remain live. The current executor uses one spec per request: this counterexample establishes no deployed scoring failure or model-quality superiority.

## Admission and judging gates still open

| Gate | Current evidence and missing work |
|---|---|
| Existing Provider admission | Miner 4889 was already indexed active in the 3 November status refresh. This package does not repeat its registration or claim a new 4 November index refresh. |
| Wallet protocol compatibility | Local handler and generated manifest now report versions 1/1, matching the refreshed contract. The earlier public capture reports 5/5 and is preserved. A real node-shaped response remains unverified; no upload occurred. |
| Wallet numeric encoding | Current official functions preserve the displayed balance and encode the saved nonzero value to int256 88 at six decimals. Comparator scale/code/tolerance are separate deployed configuration and remain unknown. Keep the exact Provider balance. |
| Comparator hosting and validation | v2 is locally built and runtime-tested. No exact public-byte check or supported authenticated validator receipt for this candidate is established. Public hosting/upload is outside this build's authorization. |
| Comparator registry admission | No new v2 admission or champion replacement is established. Fresh interface, owner/bond checks and supported validation must precede any owner signing. Local parity does not justify another registration by itself. |
| Wallet evidence helper | Local review tooling only; no platform evaluator-module admission is claimed. |
| Winning evidence | Useful real mission consumption, fair relevant comparisons, independent reproduction, H2 eligibility/submission/review and awards remain separate. Author scripts and synthetic challenges are not independent adoption. |

No credentials or signature are needed to run the offline package. The next live gate is a canonical Engine receipt with a correlated raw signal/source snapshot and the deployed wallet scoring configuration. Engine execution requires specific payment authorization. Hosting this comparator candidate requires separate explicit approval of the exact original artifact and service, followed by supported validation. Signing remains the owner's action after those gates pass. No funding or signature is requested now.

## Local evidence inventory

Ignored owner-only receipts remain under `reports/`: wallet captures in `wallet-proof/`, challenge freeze/replay and final TAP in `wallet-proof-2026-11-03/`, and comparator source/build/runtime proofs in `comparator-proof-2026-11-03/`. The successful live wallet capture is `2026-11-03T16-13-33-592Z-4c3cce65`, SHA-256 `50750e6e93069c8c8445c58e894f526ac560ac2ea2f1c5daefe75810781f1de7`. These paths describe local evidence, not a public source-kit dependency. Keep reports, research, account bindings, credentials, signing history and protected material local.

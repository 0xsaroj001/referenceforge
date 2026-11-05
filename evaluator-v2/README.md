# ReferenceForge V2 transaction evidence evaluation material

This is an original local Evaluator-track build: a small, auditable preference-pair pack and an offline evidence/format checker for `ONCHAIN_TX_LOOKUP_GENERAL`. It helps distinguish successful inclusion, reverted execution, wrong identities, incorrect block heights and unit mistakes. It is evaluation material, not a trained model, WASM binary, registered scoring adapter or network champion.

The initial private catalog contains 12 paired questions and 9 evidence-refusal challenges. Every transaction and block is synthetic. Nothing here proves a live transfer, independent adoption, network admission, scoring improvement or a prize result. The examples are controlled evidence-reading exercises; they do not test fresh RPC retrieval. No competitor repository supplied code, cases or labels.

## Run locally

Use Node.js 24 or later from the project root:

```powershell
node --test test/evaluator-v2.test.mjs
node evaluator-v2/audit.mjs
```

The first command tests the public audit code with separate unit fixtures. The second requires the unpublished local catalog at `evaluator-v2/local/tx-evidence-cases.json`, checks fixed gold labels, checks that chosen answers match evidence and rejected answers fail, then writes:

1. `reports/evaluator-v2/pool/ONCHAIN_TX_LOOKUP_GENERAL.jsonl`
2. `reports/evaluator-v2/pool/audit.json`

An alternative catalog and output folder can be passed as two positional arguments. The command only reads local files and writes local outputs. It contains no key prompt, wallet dependency, upload, RPC request, transaction or signing operation. The private catalog is deliberately absent from a clean source checkout. A missing catalog is an error, not permission to replace it with invented network evidence.

The initial verified result is **39/39 code tests**, 12/12 paired cases, 12/12 erroneous-answer detections, and 9/9 expected refusal cases. These are fixture checks, not a statistical model benchmark. The local advisory trigram similarity maximum was 0.516; this does not reproduce the node's near-duplicate algorithm.

## Frozen baseline comparison

The follow-up benchmark adds 10 harness tests and a separate frozen local corpus:

```powershell
node --test test/evaluator-v2.test.mjs test/evaluator-v2-benchmark.test.mjs
node evaluator-v2/benchmark.mjs
```

The combined code suite passes **49/49**. The private frozen corpus has 16 balanced-position preference pairs and 20 evidence controls, including 10 valid controls so that always refusing cannot succeed. The runner verifies corpus/development hashes, rejects repeated case IDs and overlapping named failure groups, withholds labels and the competing answer from scorers, counts ties as zero strict-ordering credit, checks repeated scoring, and writes a new timestamped report without overwriting previous results. Candidate or baseline changes after the freeze are marked as seen evaluation, not a fresh holdout result.

The original baselines are constant, shape-only, receipt-status-only and naive selected-field checking. No competitor or network model was downloaded or executed. Results are deliberately reported separately:

| Set | Reference-bound audit | Relevant simple baseline | Interpretation |
|---|---:|---:|---|
| 12 development pairs, already used | 12 correct | Naive fields: 12 correct | No advantage over this field baseline. |
| 16 frozen response-format pairs | 14 correct, 2 ties | Shape-only: 14 correct, 2 ties | No measured ordering advantage here. |
| 20 balanced evidence controls | 20 correct, 0 unsafe accepts | Chain/status: 12 correct, 8 unsafe accepts | Bounded evidence-consistency/refusal advantage in this synthetic policy test. |

Two holdout failures remain visible: the audit ignores unsupported additional finality and invoice-payment certifications attached to otherwise correct fields. They have **not** been fixed by tuning this holdout. The current audit is not a complete answer-quality judge. A later fix must preserve these results and use a new independently prepared challenge set to make a new generalization claim.

All inputs are author-curated synthetic observations. The local author was not blinded; some underlying fields and concepts overlap development even though case IDs and specific mutation groups do not. This is controlled adversarial testing, not a statistical claim about unseen real transactions, a network ranking, or neural-model superiority. The cases remain out of the evaluation-pool export.

The official [adapter resolution interface](https://devnode.telegraphprotocol.com/api/wasm?resolve=ONCHAIN_TX_LOOKUP_GENERAL) returned no serving module for this concrete Intent on 29 October 2026. That is a time-bound observation, not permanent absence of a baseline. The current official [kit at commit 5fa5d68](https://github.com/telegraphprotocol/telegraph-wasm-baseline/tree/5fa5d68bbcf76aaa2093c5d0578f53462bc0e36e) uses `wide_runtime` training/export paths; the contemporaneous Anjoman tutorial still names `float_runtime`, absent from that tree. This documentation drift and the missing same-Intent serving module block a credible network-model comparison. Read-only captures are local; no remote runnable endpoint was invoked.

## Mapping to current requirements

An optional conservative canonical-only envelope preflight now rejects fields outside the six declared answer fields, including unsupported `finalized`/`invoice_paid` claims, as well as duplicate JSON keys and accessor/non-scalar objects. Run `node evaluator-v2/audit-envelopes.mjs` against the existing private development material, or import `checkAnswerEnvelope` from `answer-envelope.mjs`. It refuses unsupported claims; it does not determine whether they are false. Raw Provider responses containing `evidence` or other metadata are outside this helper's input contract and must not be silently stripped and passed off as complete audited answers.

The legacy `evidence.mjs`, original pool exports and frozen baseline runner are deliberately unchanged. Six new envelope regression tests are development cases informed by known failures, not an independently prepared challenge set or an unseen-quality result. The previous 14-correct/two-tie baseline result remains the valid frozen result. New independent reference review and holdout work are still required before reporting improved generalization. Captured official response fields and local preflight reports are in ignored `reports/evaluator-v2/answer-envelope/`.

Checked 29 October 2026 against official [evaluation-data instructions](https://anjoman.ai/docs/scoring/contribute-evaluation-data), [adapter-training instructions](https://anjoman.ai/docs/scoring/train-a-scoring-adapter) and [scoring-module instructions](https://anjoman.ai/docs/scoring/build-a-scoring-module). The **Evaluators** radio was also selected on the [official rules](https://hackathon.telegraphprotocol.com/rules), verifying the track-specific requirements rather than the initial Apps or Provider view. Raw captures and hashes stay in ignored `reports/evaluator-v2/`.

The rules allow material-only contributions and useful evaluation before live activation. A 3 November read of the current official frontend dataset supersedes the older weights: 40 for measurement validity/discrimination/baseline evidence, 15 integrity/robustness, 10 reproducibility/protocol compatibility, 10 useful coverage/improvement, 5 documentation/integration and 20 organic growth/education/developer activation. Eligibility plus 70/100 overall and at least 28/40 measurement validity are required to win. A comparable baseline is required if one exists; credible new tests and reference quality can support underserved coverage. These are judge-assigned criteria, not points earned by the local unit-test count. See [current rules](../docs/SEASON_II_RULES.md) and [live status](../docs/LIVE_STATUS_2026-11-03.md); local evidence tools are separate from registration 45, which is now superseded.

| Current interface or rule | This build | Evidence or limit |
|---|---|---|
| One intent per JSONL upload | One concrete `ONCHAIN_TX_LOOKUP_GENERAL` file | Every row declares the same intent. |
| Preference-pair row | `prompt`, `chosen`, `rejected`, `label_kind`, `provenance` | Both answers are non-empty, distinct strings containing a complete structured response. |
| Current answer contract | Request schema v4; response format v4 | `status`, `block_number`, identifiers and native value checked. The live detail URL is [the intent contract](https://devnode.telegraphprotocol.com/engine/v1/intents/ONCHAIN_TX_LOOKUP_GENERAL). |
| Default byte/text limits | 32 MiB body; 64 KiB row; normalized field-length checks | Strict UTF-8 decode, NUL/control checks, prompt identity and same-answer rejection. This is a local preflight, not full node curation. |
| Prompt deduplication | NFC plus collapsed whitespace | Exact duplicates fail; advisory similarity cannot establish node admission. |
| Ambiguous JSON rows | Duplicate decoded object keys are refused at every nesting level | Includes escaped aliases and duplicate provenance; a conservative local integrity gate, not a claim about the node's parser. |
| Truthful provenance | `source_kind: synthetic` | All 12 rows remain **unverified**, including when their semantic reference is an official URL. URLs do not turn synthetic observations into real ones. |
| Hidden testing/ranking halves | No author-selected split | The network chooses a fixed half per row. Local exported order is not its split. |
| Judgment-pool diversity | Only one local contributor | The official minimum is five distinct contributors before judgment questions are used. More wallets owned by us would not establish independence. |
| New adapter contract | No adapter claimed | Float-model training, ABI packaging, runnable parity and champion replacement have not been attempted. |
| Submission/admission | Not submitted or signed | A future upload is checked per row. HTTP 200 alone would not establish admission or eligibility. |

## Evidence policy and useful failures

The independent audit rule reads a captured transaction, receipt, observed block and chain ID. It verifies their identities/heights agree, converts hex heights, and converts wei to six-decimal whole-native-unit values using integer arithmetic. It checks receipt execution success rather than gas use or inclusion alone. Hash/address comparison is case-insensitive.

The rule follows [Ethereum's JSON-RPC field meanings](https://ethereum.org/developers/docs/apis/json-rpc/). A matching supplied block is consistency evidence in this exercise; it is not cryptographic inclusion proof, a trustworthy live source, or evidence of finality. In these exercises, `confirmed` means successful inclusion at the supplied observation. A success enum does not prove that a payment will never be reorganized.

Nine local challenges deliberately produce no pool row: upstream failure, wrong chain, absent observations, observed pending, disagreeing block hash, missing receipt, contract creation with null recipient, sub-six-decimal native value, and a reverted transaction carrying nonzero attempted value. These refusals prevent fabricated numbers from being used as gold labels.

In particular, the current numeric `block_number` contract has no documented pending/null representation. An unavailable transaction is not conclusive proof of never existing. A reverted transaction's attempted value must not be presented as a successful transfer. Those schema/semantic gaps require clarification or an accepted error path; the toolkit does not fill them with block zero, guessed `not_found`, rounded dust, or fabricated recipient strings.

The numeric policy is intentionally narrower than the live field's full range: values must be exact multiples of 10^12 wei, have a safe integer count of micro-native units, and survive a six-decimal numeric round trip. This restriction is explicit rather than silently rounding an answer.

## Fresh supported-domain review, 2 November

A separate agent froze twelve new expectations using one fresh Base mainnet capture corroborated by official Base RPC and PublicNode, before inspecting the target, tests, corpora or old reports. The reviewed `strict_capture_identity_v2` matched all twelve: one accept, four rejected wrong answers and seven abstentions on inconsistent evidence. This small reviewer-selected set is not an external human review, a statistical benchmark or evidence of network superiority. Full inputs, hashes, results and scope limits remain local under `reports/independent-review/evaluator-2026-11-02/`.

A separate post-freeze, implementation-informed probe exposed a real gap: v2 accepted a transaction whose own `chainId` contradicted the request and captured RPC chain. That diagnostic is excluded from the twelve frozen cases. The new optional `checkAnswerWithCaptureChain` export in `capture-chain-v3.mjs` first applies v2, then requires a canonical hexadecimal transaction chain witness matching the supported request chain. Missing, malformed or contradictory witnesses explicitly abstain. Older captures without that witness do not silently pass. Mutually consistent JSON still does not establish authentic sources, cryptographic inclusion or finality.

Five new regressions pass. Replaying the frozen twelve through v3 still matches twelve, and the additional chain conflict now abstains; both v3 results are post-review development checks. The reviewed v2 file, original scorers, baseline results and private frozen corpora remain unchanged. No pool export is automatically switched, and v3 is neither a WASM artifact nor a new registered adapter.

## Confidentiality and next gates

### Separate review and optional capture identity policy

A separate agent-led review took place on 1 November IST. Its original frozen Ethereum cases were out of scope; its supported-Base adaptation was post-freeze development work. Do not present it as an externally independent review or an unseen accuracy improvement.

Post-inspection diagnostics found that the original field/envelope audits accepted conflicting receipt addresses and an explicitly empty block transaction list. The original files/results remain unchanged. A new optional `checkAnswerWithCaptureIdentity(request, evidence, candidate)` export in `capture-identity-v2.mjs` requires matching receipt sender/recipient, an RPC block transaction hash list, and consistent indices pointing to the requested hash, before applying the existing canonical-only envelope policy. Missing witnesses explicitly abstain. This improves internal consistency only; mutually consistent supplied JSON does not establish authentic sources, cryptographic inclusion or finality.

The new policy expects full=false RPC block hash lists and original receipt/transaction indices. It is intentionally narrower than the old minimal evidence envelope. Raw Provider metadata remains outside its answer contract and must not be silently stripped then represented as wholly audited. Eight focused regressions and two explicitly projected canonical-view replays pass; all are development checks informed by review, with no new generalization claim. Frozen scorers, corpora and original benchmark results remain unchanged. No current pool export is automatically switched to this policy.

### Input-integrity follow-up, 1 November IST

The row preflight now refuses duplicate JSON object properties, including escaped spellings of the same key and duplicates inside provenance objects. Ordinary JSON parsing keeps the last property, which could conceal an earlier preferred answer or replace synthetic provenance with a different classification. The new `strict-json.mjs` gate rejects the ambiguous row before it contributes to row or provenance counts. It reports only the error code and row number, without echoing the protected property or value. Repeated member names in separate objects remain valid.

Five public parser regression cases cover overwritten labels/provenance, escaped aliases, nested object scopes, JSON-looking string contents and malformed input. The focused Evaluator suite passes 60/60. These are development integrity checks, not additional private evaluation examples, independent label review, a model comparison or evidence of improved measurement validity. The frozen scorers, private corpus and original benchmark results remain unchanged. Material-only eligibility and the 70/100 overall plus 28/40 validity thresholds were rechecked against the selected official Evaluators rules; they are still external judging requirements.

`evaluator-v2/local/` and `reports/` are ignored. Keep unpublished questions, rejected answers and their gold evidence there. The public unit fixture is separate and is not part of the private pack. Do not publish the private catalog or pair file if it may later enter a protected evaluation pool. Other participant repositories and derived research remain under the workspace's stricter local-only policy.

Before any Evaluator entry, expand beyond this 12-case seed, independently review labels, resolve numeric/error semantics, and demonstrate useful discrimination against a current adapter with genuinely independent evidence, or establish credible underserved coverage. Include the material version/results and mission-specific tests or applications enabled. No independent adapter comparison or model training has happened. Pool admission, event-period use and hackathon submission are separate later gates and require owner authorization.

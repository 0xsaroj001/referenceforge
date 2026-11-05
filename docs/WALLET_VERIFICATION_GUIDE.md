# Reproduce a native wallet-balance check

This original local reviewer kit tests one useful Provider task: whether a native ETH balance belongs to the requested wallet and chain at a disclosed, recent block. It checks the five canonical `WALLET_BALANCE_CHECK_GENERAL` field values against two fixed RPC services. It also demonstrates why a correct-looking number can be attached to the wrong wallet.

It extends the existing ReferenceForge Provider and evidence work. It is supporting tooling for the Provider/Evaluator entries, not another registered miner, admitted evaluator, App-track product, independent user or claimed hackathon award.

## Start with the safe offline demonstration

Use Node.js 24+ from the repository root. No account, wallet connection, API key or dependency installation is needed for the wallet commands.

```powershell
npm run demo:wallet
```

Expected: `pass:true`, `evidence_kind:"synthetic_demonstration"`, `http_calls:0`. The fictional wallet holds **0.125 ETH** at a fictional block. The command then changes only the answer's wallet address, leaving the balance unchanged. The detailed checker rejects it; the illustrative numeric-only check would miss that error. This is a constructed demonstration, not a measured accuracy advantage on an unseen benchmark.

The public-safe fixture is `test/fixtures/wallet-proof.mjs`. It contains no real wallet observations, protected questions/gold, private review corpus or credentials. Each command writes a new ignored directory under `reports/wallet-proof/`; existing captures and failures are preserved.

## Check a real address

```powershell
npm run proof:wallet -- --chain base-sepolia --address 0xYOUR_40_HEX_DIGIT_ADDRESS
```

Replace the placeholder with an actual 20-byte hexadecimal address. Supported chains are `base` and `base-sepolia`; the scope is native ETH only. ENS, Ethereum mainnet, ERC-20 holdings, portfolio valuation and finality certification are outside this check. An address used as a query input is not a wallet being connected or operated.

The command first reads the live intent contract and miner 4889's owner identity. An owner mismatch stops Provider/reference calls. It reads the public `/v2/wallet` response, including the disclosed block identity, and checks three Provider refusals: unsupported chain, malformed address and unsupported token.

For a fulfilled request it queries the **same disclosed block** from official Base and PublicNode endpoints: chain ID, block header, current head, hash-pinned `eth_getBalance`, and a post-read canonical header. The balance query uses EIP-1898 `{blockHash,requireCanonical:true}`. Exact decimal/integer arithmetic compares wei with the Provider's whole-ETH JSON number; the checker also inspects the original numeric token before JavaScript parsing can silently discard precision.

Limits are fixed before calls: at most **16 HTTP requests / 10 reference RPC methods**, 15 seconds per HTTP request, 2 MiB per response, no redirects, automatic retries, caller-supplied RPC URLs or fallback source. Only read methods are allowed. The command makes **zero Engine asks, purchases, payments, broadcasts or wallet signatures**. Its own public HTTP/RPC requests require no paid plan; public upstream rate limits still apply. The Provider itself performs its separately reported upstream reads.

Official network and block-query references: [Base endpoints and chain IDs](https://docs.base.org/get-started/connect-to-base), [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898). Separate declared service operators can share infrastructure or failures; this is not an audit of operator independence or a cryptographic state proof.

## Replay and inspect the result

```powershell
node tools/wallet-proof.mjs --replay "C:\absolute\path\to\capture.json"
```

Keep the adjacent `capture.json.sha256`. Replay checks the exact file bytes before running the same checks without network calls. A capture hash detects changes against its sidecar; anyone controlling both files can replace both. Replay does not authenticate a source, reviewer or old timestamp.

Inspect `plan.json`, `capture.json` and `result.json`. Source requests, raw responses, hashes, timings and transport failures remain local. A nonzero exit code is a failed verification, including RPC error objects inside HTTP 200, wrong identity, inconsistent snapshots, stale data, reorgs, missing evidence or lossy numeric values. Never replace a failure with a synthetic result or an earlier successful capture.

## Current verified checkpoint — 3 November 2026

- 28 focused checker tests and three CLI tests cover valid nonzero/zero cases, unit/identity/chain errors, state-query binding, post-read reorgs, source failures, stale/future timestamps, raw JSON precision, offline replay integrity and rejection of upload/signing/RPC-origin options.
- An initial Base CLI run failed on transport reads, including its contract read, Provider request and token refusal. Its failed capture is preserved; it did not read reference balances or establish a successful workflow.
- Browser access in verified Saroj Optimes subsequently returned a successful zero-balance Provider response on Base. This demonstrates a browser-visible response, not the full two-source CLI verification.
- A separate Base Sepolia run with Node's per-process `--dns-result-order=ipv4first` completed all 16 calls, matched a real nonzero balance against both references at the disclosed hash and passed all three refusals. That single run does not establish the cause of the earlier transport failures or sustained availability. No global network setting was changed.
- The public Provider reports raw request/response metadata version **5**, while the freshly read intent reports **1**. This is exposed as `raw_metadata_versions_match_live_contract:false`; raw compatibility metadata must not be represented as verified node-shaped output.
- The real nonzero snapshot is not exactly representable at six decimal places. `six_decimal_exact:false` preserves that boundary; this checker does not assert the platform's eventual numeric score encoding or rounding behavior.

The separate reviewer challenge replay and comparator runtime proof are described in `VERIFICATION_PACKAGE.md`. Their results remain bounded development/runtime evidence.

The [4 November node-shaping follow-up](WALLET_NODE_SHAPING.md) clarifies that six decimals belongs to on-chain encoding, while comparator scale is separate configuration. More than six displayed decimals alone is not a shaping defect. Local wallet metadata now reports 1/1; the saved live capture and public service were not rewritten or uploaded.

## What a pass does and does not establish

`pass:true` establishes the stated direct Provider/reference consistency checks and refusals for that capture. `node_shaping_verified`, `platform_admission_verified`, `source_operator_independence_verified` and `independent_human_review` remain false. The original code's RPC providers overlap one reference operator, so this is separately implemented verification, not wholly independent ground truth.

To strengthen the H2 evidence, reviewers still need realistic new inputs, an actual supported node-shaped request/response check, the deployed comparator configuration verified, fair relevant comparisons, and genuine mission-app use or independently accepted mission-specific reproduction. Local six-decimal on-chain encoding is now reproduced; it does not establish comparator settings or live execution. Signing, uploading, publishing and outreach remain separate owner-authorized steps.

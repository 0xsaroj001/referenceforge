# ReferenceForge Onchain 0.1

An original, read-only miner for `CRYPTO_TRANSFER_VERIFY` and `ONCHAIN_METRIC_VERIFY`. It supports Base (8453) and Base Sepolia (84532) through Tenderly's public RPC and Allnodes PublicNode. Each answer requires agreement from both configured operator groups. There are no keys, signing methods, paid APIs or transaction broadcasts in this service. The earlier local benchmark used the Base public RPC; the deployed service switched to Tenderly after Base's endpoint returned HTTP 429 from the Cloudflare execution location.

This is a separate service, now deployed at https://referenceforge-onchain.0xsaroj001.workers.dev. The existing numeric miner and its hosted YAML/WASM bytes are not updated. Hosted registration inputs are in [ONCHAIN_UPLOAD_TO_TELEGRAPH.md](../ONCHAIN_UPLOAD_TO_TELEGRAPH.md); actual Telegraph validation, registration and admission remain pending. WASM development remains stopped.

## Run

Requires Node.js 24 and the repository's locked dependencies. Python 3 is needed only for the separate reference transformation.

```powershell
npm ci
npm run start:onchain
```

Default address: `http://127.0.0.1:8790`. Optional `ONCHAIN_HOST` and `ONCHAIN_PORT` configure binding. The Node adapter limits active work to eight concurrent requests per process. This is not a distributed rate limiter or evidence that public RPC capacity supports eight concurrent clients continuously.

## Requests and exact scope

Both endpoints accept GET query parameters or POST JSON. POST bodies are bounded to 16 KiB. Repeated query keys, conflicting body/query values, unknown parameters and nested parameters are refused. Use strings for addresses, hashes, amounts and block numbers. There is no free-form question interpreter or caller-supplied RPC URL.

```powershell
curl.exe "http://127.0.0.1:8790/health"
curl.exe "http://127.0.0.1:8790/verify-transfer?chain=base&asset=native&tx_hash=YOUR_PUBLIC_TX_HASH"
curl.exe "http://127.0.0.1:8790/onchain-metric?chain=base&metric=native_balance&address=YOUR_PUBLIC_ADDRESS&block=safe"
```

| Endpoint | Required | Conditional or optional |
|---|---|---|
| `/verify-transfer` | `chain`, `tx_hash`, `asset` | `asset` is `native` or `erc20`. `token` is required only for erc20. Optional `expected_from`, `expected_to`, `expected_amount`, `min_confirmations` |
| `/onchain-metric` balances | `chain`, `metric`, `address` | `metric` is `native_balance` or `erc20_balance`; `token` required for erc20_balance. `block` defaults to safe; finalized or exact uint64 decimal/hex number strings accepted |
| `/onchain-metric` transaction metrics | `chain`, `metric`, `tx_hash` | `metric` is transaction, gas or logs. These use the inclusion block; block/address/token parameters are refused |

`chain` is base/base-sepolia or the corresponding numeric chain ID. Balance requests reject latest and pending: they must resolve to one stable reference block. ERC-20 balance queries use the caller-declared contract's balanceOf ABI, with contract code present and a 32-byte result; the standard and token economics are not audited. Each eth_call has a 100,000-gas execution cap. More expensive contracts fail explicitly.

Native transfers mean nonzero **top-level transaction value**. They do not establish internal transfers, recipient balance retention or bridge settlement. ERC-20 transfers mean three-topic `Transfer(address,address,uint256)` events emitted by the specified contract. Mint/burn/zero events retain their actual addresses/amounts; event attestation does not prove token legitimacy or net balance changes. NFT event shapes are not decoded.

Every supplied expectation must match the **same event**, rather than separate events matching different fields. Amounts are exact uint256 decimal strings in wei or token base units. The contract address receiving the outer transaction can differ from the recipient in an ERC-20 event.

## Verification behavior

1. Both RPCs must return the configured chain ID and structurally valid, internally consistent transaction/receipt data. Requests are read-only and restricted to a method allowlist.
2. Latest heads must be timestamp-fresh within 120 seconds, no more than 10 seconds in the future, and within four L2 blocks of each other for transaction confirmation checks. Both providers must agree on the canonical inclusion block and the conservative common head.
3. Receipt identity, execution status, gas, sender/recipient and event context are checked. Removed, duplicate, malformed and foreign-transaction logs are rejected. Source disagreement never silently falls back to one operator.
4. Balances use EIP-1898 `{blockHash, requireCanonical:true}` against both RPCs, followed by a second canonical-block check. Safe/finalized tags can advance between providers at different times. Use the lower reported height only after both providers agree on its canonical hash; expose both reported heights, their difference and the selected block's age. A tag above its own provider head is invalid. This conservative common ancestor may be older than one provider's newest tagged block, so consuming apps must inspect the age/lag. Unsupported archive/EIP-1898 reads fail explicitly.
5. There is no result cache. Repeated requests repeat RPC checks. Each upstream batch has a deadline and a 2 MiB streamed response limit; a request has a five-second deadline and at most 16 RPC HTTP attempts. A 429 can be retried once after a short Retry-After (or 400 ms if absent), within the same deadlines. Long waits are refused rather than retried early. Attempts and rate-limit retries are counted in the evidence. Provider errors and URLs are not echoed. Both in-flight source reads settle before returning a failure. Shared free RPC limits can still cause unavailable responses or slower requests; small passing samples are not an SLA.
6. Two reported operator groups and payload hashes provide source-agreement evidence, **not** a cryptographic state proof or protection against every shared upstream fault. Runtime state is request-owned in the Worker.

## States and scored values

| Situation | Result |
|---|---|
| Matching successful transfer and enough confirmations | `verified_answer:true`, `claim_verified:true`, `score_value:"1"` |
| Definitively reverted or mined but mismatching transfer | Verified evidence of a negative result, `claim_verified:false`, `score_value:"0"` |
| Pending or unknown transaction | `verified_answer:false`, `fulfillment:"inconclusive"`, `score_value:null` |
| Too few requested confirmations | `verified_answer:false`, `fulfillment:"inconclusive"`, `score_value:null` |
| RPC failure, inconsistent evidence, stale head, unsupported history or reorg | Explicit error, `verified_answer:false`, no substitute score |

Confirmation counts are conservative **L2 block confirmations**, not Ethereum L1 finality, withdrawal finality or bridge completion. A null transaction at two providers does not prove that a transaction never existed.

Metric score_value is an exact decimal string: balance in wei/token base units; transaction execution status 0/1; gas used in gas units; or receipt log count. Structured transaction, fee and log evidence is also returned. A consumer must select the correct metric and units. Protocol parsing and live scoring of these mapped fields still require supported platform validation.

Fees include exact execution cost (`gasUsed * effectiveGasPrice`), base/priority components, provider-reported L1 data fee, and their known subtotal. `total_fee_wei` remains null because complete fork-dependent operator charges are not established. Base L2 fees go to fee vaults; the base-fee component must not be described as burned ETH. Ethereum L1 burn attributable to a batch is not computed. System/deposit and unknown transaction types are outside the current fee/transfer scope.

## Actual requirements and benchmark gates

The live [intent catalogue](https://hackathon.telegraphprotocol.com/intents) describes transfer status, fees, sender/recipient and confirmations, with a target under 1.5 seconds. On-chain metrics cover logs, gas, balances and transaction state, with a target under 2 seconds. Independent RPC and archive-node checks are listed as ways miners compete. These catalogue targets are not an SLA guarantee.

| Requirement | Verification method | Limit |
|---|---|---|
| Correct transfer identity and amount | Native/token predicates, same-event tests, real receipt captures | Top-level native and ERC-20 events only |
| Correct execution state | Pending/unknown/reverted/success fixtures; live mined cases | Pending and unknown live cases may not be found within a bounded sample |
| Fees and confirmations | Independent Python integer transformation, conservative common-head tests | Complete fee total and L1 finality not asserted |
| Logs, gas and exact balances | Live transaction metrics and hash-pinned state reads | No trace/internal-transfer execution; archive support is provider-dependent |
| Source disagreement and reorgs | Injected second-source corruption and post-read reorg cases | Authored fault tests are not unseen adversarial accuracy |
| Latency | Fresh-process local HTTP with real reads; first-per-case and repeated fresh-RPC samples reported separately | Not deployed-edge latency or sustained uptime |
| Capacity | 200 loopback calls at concurrency eight with synthetic RPCs | Not public-RPC throughput or production capacity |
| Worker compatibility | Local workerd smoke with real source reads; dry-run bundle audit | Production CPU and public admission remain unverified |

```powershell
npm test
npm run bench:onchain
npm run bench:onchain:live
npm run check:onchain:oracle
npm run build:onchain:worker
npm run audit:onchain:bundle
```

The live benchmark discovers a bounded set of public recent transactions, never sends one, then starts a fresh verifier process and runs each case three times. Captures, failures and reports stay under ignored `reports/onchain-miner/`. These repeated cases are not independent random accuracy samples. The Python oracle separately transforms the same captured raw facts; it is not another truth source or an independent reviewer. The receipt-status-only ablation is our deliberately weak development baseline, not competitor code or evidence of superiority over an existing miner.

Run local Worker smoke after the live benchmark:

```powershell
npm run dev:onchain:worker
# In a second terminal:
npm run smoke:onchain:worker
```

## Descriptor and deployment boundary

```powershell
npm run render:onchain -- --id YOUR_AVAILABLE_CANDIDATE_ID --base-url http://127.0.0.1:8790
```

This local command generates a separate `dist/onchain-miner.yaml`. It does not reuse an existing registration, reserve an ID, change hosted artifacts, upload a YAML, deploy a Worker or register anything. A loopback descriptor cannot be used by Telegraph. The deployed descriptor was separately prepared with `npm run prepare:onchain:deploy -- --id 1900999001 --base-url https://referenceforge-onchain.0xsaroj001.workers.dev`, then package-audited and deployed with `wrangler deploy --config deploy/onchain.wrangler.jsonc`. Only `deploy/onchain-public/miner.yaml` is an asset; its exact hosted bytes were checked after deployment. Before registration, validate using the intended Telegraph account and verify identity availability. The original numeric deployment remains separate.

## Primary specifications

1. [Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/).
2. [EIP-1898 block-hash state reads](https://eips.ethereum.org/EIPS/eip-1898).
3. [ERC-20 Transfer and balanceOf](https://eips.ethereum.org/EIPS/eip-20).
4. [Base networks](https://docs.base.org/get-started/connect-to-base), [Base fees](https://docs.base.org/specifications/transactions/network-fees).
5. [PublicNode Base endpoints](https://base.publicnode.com/).
6. [Tenderly public RPC networks and limits](https://docs.tenderly.co/node-rpc/rpc-reference).
7. [OP fee vaults and fee components](https://docs.optimism.io/op-stack/transactions/fees).

Public free endpoints carry availability, capacity and historical-data limits; no production entitlement or paid upgrade is assumed. Competitor repositories, research, strategy and generated reports are excluded from publication and deployment.

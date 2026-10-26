# ReferenceForge: combine four intents

Completed by the owner: replacement 4844 is active and earlier registrations 4838 and 4843 are inactive. This guide records that completed migration. For the subsequent additions, use [INTENT_EXPANSION.md](INTENT_EXPANSION.md) and `tools/expand-miner.mjs`.

The combined runtime serves these four intents from one origin and one descriptor:

| Intent | Endpoint | Scope |
|---|---|---|
| FX_NOW | `/fx` | Latest published ECB daily reference, not an executable intraday quote |
| MACRO_ECONOMIC_INDICATOR | `/macro` | Published annual World Bank observations, exact requested year |
| CRYPTO_TRANSFER_VERIFY | `/verify-transfer` | Base/Base Sepolia top-level native value and ERC-20 Transfer events |
| ONCHAIN_METRIC_VERIFY | `/onchain-metric` | Exact block-pinned balances, receipt logs, execution status and gas used |

The display name is **ReferenceForge**. The existing `referenceforge-numeric` slug and YAML ID `1900999000` are retained for identity continuity. All four responses use the common `score_value` / `summary` signal mapping. Numeric responses retain their exact `numeric_value`, source hashes and observation metadata; pending/unknown on-chain results retain a null score and explicit inconclusive status. No unsafe amount is converted through a JavaScript floating-point number.

| Registration input | Exact value |
|---|---|
| Combined YAML URL | https://referenceforge.0xsaroj001.workers.dev/referenceforge-unified.yaml |
| YAML SHA-256 bytes32 | `0x6c1d031c2cc64ad6a57db83c8bb18af5538ef9531df2872b11267ead929d349a` |
| YAML bytes | 9,236 |
| Account / fee recipient | `0xFEc66E0F5c64296fF190EdCeD88C781eeEdFd9d3` |
| Floor price | 0.01 USDC per request; preserved from both current registrations |
| Registry | `0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8` on Base Sepolia, chain 84532 |

## Run the user-owned migration

From this project folder, run:

```powershell
node tools/update-miner.mjs --interactive
```

This migration requires **two separately approved transactions** to finish with one active miner:

1. The helper displays and simulates `updateMiner(4838, ...)` for the four-intent descriptor. Type `UPDATE_REFERENCEFORGE` to approve that one update, then paste the matching private key into the hidden local prompt. It preserves the fee recipient and floor price. `updateMiner` replaces registration 4838 and issues a **new registration ID**, which the helper reads from the verified receipt. It does not create a third independent miner with `registerMiner`.
2. It verifies the replacement on-chain and waits briefly for Telegraph's node to report the exact YAML, owner and all four intents as active. Only then does it display and simulate `deregisterMiner(4843)`. Type `RETIRE_ONCHAIN_4843` to approve that second transaction. The same locally held wallet signs it, or a later resumed run asks for the key again. This retires only the separate old Onchain registration. Declining leaves it active and preserves coverage.

If node indexing takes longer, the helper stops before retirement. Check status, then rerun `--interactive` later. The saved journal skips the completed update and resumes the retirement checks. Do not use `register-miner.mjs` to consolidate; that older helper is pinned to the separate two-intent miner.

```powershell
node tools/update-miner.mjs --check
node tools/update-miner.mjs --status
```

No private key is accepted in command arguments or saved to disk. Each phase stores its deterministic transaction hash under ignored `reports/unified-migration/` **before** one broadcast. A pending, uncertain, reverted or confirmed attempt blocks a duplicate send for that phase. Keep these journals and any interrupted lock files. `--status` reads receipts without signing. Manual transactions or deleted/moved journals cannot be deduplicated by this local history; unexpected contract state causes a stop rather than a guessed replacement.

Only testnet gas is paid; both transactions transfer zero ETH value and make no USDC payment. Each phase reviews its own fee budget and requires an additional 0.00005 test ETH balance reserve for possible L1 data fees. That reserve is not a precise total-fee quote. The final retirement remains unavailable unless both on-chain and node activation checks succeed again immediately before signing.

## Validation and deployment

The final runtime is deployed to the existing `referenceforge` Cloudflare Worker, version `fcfd80d7-a4cd-452f-81f6-957dbc41aaf1`. Old `/miner.yaml`, `/referenceforge-comparator.wasm` and `/artifact-manifest.json` bytes are preserved. The separate Onchain Worker remains hosted so it continues serving the old registration until retirement. Runtime deployment does not perform the on-chain migration.

The combined implementation passes 196 Node tests, including 63 on-chain fault cases through the combined HTTP interface, exact numeric mapping, null-score preservation, input conflicts, safe resolved-cache sharing, ownership checks, partial activation refusal and duplicate-attempt protection. Local workerd smoke and final public smoke both pass 26/26 using real ECB, World Bank and two RPC operators on both Base networks. The live read-only update preflight succeeds with a funded owner and a successful exact-calldata contract simulation. Retirement simulation uses mocks until a real replacement exists, because bypassing the activation gate would defeat its purpose.

The package audit permits exactly ten original runtime modules and four explicit assets. No signing helper, credential, competitor research, strategy or generated report is in the deployed package. Numeric cache sharing contains resolved text only; in-flight source promises and RPC sessions remain request-owned. Every cached numeric read is revalidated. On-chain answers are not cached by the descriptor.

These checks do not establish authenticated Telegraph validator acceptance, actual routed requests, scoring, rewards or production capacity. Free shared RPCs can rate-limit or fail. The original numeric scope limits remain, L2 confirmations do not establish L1 finality, and full transaction-fee totals remain unasserted. WASM remains stopped.

Reproduce the local checks:

```powershell
npm test
npm run build:unified:worker
npm run audit:unified:bundle
npm run dev:unified:worker
# In another terminal, with earlier live captures available:
npm run smoke:unified
# Public read-only smoke:
npm run smoke:unified -- https://referenceforge.0xsaroj001.workers.dev
```

`prepare:unified:deploy` fetches and verifies the already hosted legacy assets before copying them into the explicit upload directory. Live smoke requires the ignored captures produced by `bench:onchain:live`; they are test evidence, not public assets. Reports are timestamped under ignored `reports/unified/`. Deployment uses `wrangler deploy --config deploy/unified.wrangler.jsonc --keep-vars` after tests and audit. Source publication and on-chain execution remain distinct steps.

Primary interfaces: [Telegraph registration and updateMiner](https://docs.telegraphprotocol.com/docs/miners/miner-registration), [YAML contracts](https://docs.telegraphprotocol.com/docs/miners/yaml-config), [Cloudflare Worker asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).

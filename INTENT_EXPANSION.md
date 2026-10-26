# ReferenceForge: three additional intents

**The deployed runtime passed all 29 public checks, and the read-only update preflight passes.** Alchemy is configured as an encrypted Cloudflare secret, with Base access enabled in the existing app and PublicNode retained as the second operator. The latest successful direct HTTP sample was captured at 05:54 UTC on 26 October 2026. This permits the user-run update below; it does not establish sustained uptime, routed scoring or activation of the three new intents.

The owner completed consolidation: registration **4844** is active with the four-intent descriptor; earlier registrations 4838 and 4843 are inactive. Expansion adds three original endpoint implementations to the same ReferenceForge Worker. The on-chain update is user-run and has not been signed or sent by the agent.

| New intent | Endpoint | Exact implementation |
|---|---|---|
| CURRENCY_EXCHANGE | `/convert` | Latest published ECB daily conversion. Primary score is the converted amount, not the per-unit exchange rate. Original rate, amount, date and source evidence remain in the answer. |
| ONCHAIN_TX_LOOKUP | `/tx` | Base/Base Sepolia transaction, receipt, status, gas, sender, recipient and top-level value. A selected field supplies the primary answer; pending/unknown or an absent recipient is explicitly inconclusive. |
| WALLET_BALANCE_CHECK | `/wallet-balance` | Base/Base Sepolia address balances at a fresh common canonical block. Native ETH uses 18 decimals; ERC-20 balanceOf and decimals are independently agreed at the same block hash. Returns human token units plus exact raw units. |

## Default update: retain all four existing intents

No intent is removed by default. Run from this project folder:

```powershell
node tools/expand-miner.mjs --interactive
```

Review the fixed wallet, registry, registration 4844, seven intents, fee recipient, floor price and gas ceiling. Type `EXPAND_REFERENCEFORGE_7`, then enter the matching key at the hidden local prompt. The helper refreshes the entire preflight before signing one `updateMiner` transaction. This replaces 4844 and issues a new registration ID; it does not create another independent miner. The fee recipient and 0.01 USDC floor remain unchanged. There is no extra retirement transaction and no USDC payment.

| Field | Exact seven-intent value |
|---|---|
| YAML URL | https://referenceforge.0xsaroj001.workers.dev/referenceforge-expanded.yaml |
| SHA-256 bytes32 | `0x95f0c102e41a72d569302a9664ce37e55ccfdce56762018e7f9f0e3823d1e197` |
| YAML size | 14,165 bytes |
| Wallet / fee recipient | `0xFEc66E0F5c64296fF190EdCeD88C781eeEdFd9d3` |
| Network | Base Sepolia 84532 |

The final seven are FX_NOW, MACRO_ECONOMIC_INDICATOR, CRYPTO_TRANSFER_VERIFY, ONCHAIN_METRIC_VERIFY, CURRENCY_EXCHANGE, ONCHAIN_TX_LOOKUP and WALLET_BALANCE_CHECK.

```powershell
node tools/expand-miner.mjs --check
node tools/expand-miner.mjs --status
```

Each attempt is journalled before broadcast under ignored `reports/intent-expansion/terminal/`. The deterministic hash is saved without the private key or raw signed transaction. Both descriptor variants share a single journal, so changing flags cannot bypass a recorded attempt. Uncertain, pending, reverted and confirmed attempts block another send. A local lock prevents concurrent signing attempts. Existing signing checks enforce signer, chain, contract, calldata, nonce, zero value and exact gas terms. Keep the journal and inspect status if a run is interrupted. The agent uses only mock signers and read-only live checks.

## Existing FX_NOW coverage limitation

The live catalogue now describes FX_NOW as a current institutional mid-market rate or spread. Our existing `/fx` remains an ECB daily reference endpoint and **does not supply an institutional live feed or spread**. Retaining this intent preserves the existing registration's coverage label; it does not fix the mismatch or prove full fulfilment. The new CURRENCY_EXCHANGE endpoint is a better match for our daily-rate conversion implementation. We do not claim that a higher intent count improves scoring or earnings.

Removing FX_NOW requires an explicit owner choice. If the owner chooses to replace it, use:

```powershell
node tools/expand-miner.mjs --interactive --replace-fx-reference
```

That mode requires `EXPAND_REFERENCEFORGE_6`. It selects the six-intent descriptor at `https://referenceforge.0xsaroj001.workers.dev/referenceforge-expanded-no-fx.yaml`, SHA-256 `0xb1aa128c22c904ba6fef49f9d690f6d2f6b2596b5bda4a312a1b486d66c1fcef` (12,655 bytes). It is an optional alternative, not an action taken by the agent. `/fx` remains hosted for compatibility even if it is not declared by that descriptor.

## Tests and limits

259 Node tests pass, including the previous 196 regressions and 63 expansion/operator/credential checks. Tests cover human-unit scaling across large uint256 balances and decimals 0/6/18/255, zero balances, missing/nonstandard decimals, source disagreement, stale or divergent heads, reorgs, wrong chains, transaction-state differences, missing fields, exact currency conversion, operator-specific batch limits, the repeated-latest-read race, header-only credential handling, readiness gating and update calldata for both variants. Invalid token metadata produces an explicit unavailable result instead of an assumed scale. ERC-20 decimals is optional in the standard; this human-balance endpoint requires a supported decimals response. The original raw-unit metric remains available separately.

Local workerd smoke and the latest deployed public smoke each reached 29/29 using real ECB, World Bank, Base and Base Sepolia sources, including an ERC-20 balance and all four legacy endpoints. The test reconstructs raw units from the returned human amount and decimals. That checks scaling of the same source facts, not another independent truth provider. Without a secret, the runtime uses dRPC public RPC plus Allnodes PublicNode; public Cloudflare testing of that pair failed 4 of 29 checks because dRPC mainnet returned HTTP 429. The installed repair is an Alchemy Free app key plus PublicNode. Initial Alchemy requests returned HTTP 403 before Base access was enabled; a later 28/29 run and its failure are retained alongside the final 29/29 report. A subsequent read-only update preflight verified fresh wallet reads, transaction lookup, conversion, ownership, canonical intents, simulation and sufficient test ETH. Distinct service operators do not prove separate underlying infrastructure or eliminate correlated errors. Agreement is not a cryptographic proof. Timestamped successes and failures remain preserved locally.

Earlier public runs returned HTTP 429 from Tenderly at Cloudflare, and a later run failed all seven on-chain data checks. Their 28/29 and 22/29 reports remain preserved. A replacement-provider local test then exposed RPC code 19 on a near-tip state read, and another exposed a race between two separate latest-head reads. We replaced Tenderly with dRPC, respected its documented maximum of three methods per batch, used one current head observation per operator, and added a disclosed two-block wallet buffer. Every split batch and retry still counts toward the 16-HTTP-attempt request budget. Per-batch timeout is 2.6 seconds including transport; the whole on-chain request is bounded at 8 seconds. These changes preserve two-operator agreement and never fall back to a single source or guessed data.

Wallet balances use two blocks behind the lower fresh head when operators are within four blocks, EIP-1898 canonical block-hash reads, a post-read canonicality check and a 120-second freshness bound. The block age, reported head heights and two-block buffer are returned explicitly. They are observations at that named block, not a promise that the tip cannot advance immediately afterwards. ENS, Ethereum mainnet, other chains, token legitimacy, USD portfolio valuation, internal execution traces and full L1 finality remain unsupported. Token amount formatting uses integer/string arithmetic throughout.

The first repaired deployment was Cloudflare Worker version `4ead7505-6a1f-4d11-ba3d-69f893695fea`; its public failures are preserved. The current secret-configured version is `9cd397b4-7184-4545-8235-d8d78a1c5c28`, using the audited 43,560-byte minified runtime. Deployment keeps all four previously hosted asset hashes unchanged and adds exactly two original descriptor assets. The upload audit allows eleven original runtime modules and six explicit assets. Research, competitor repositories, derived strategy, reports, signing tools and credentials remain excluded from the public bundle. The provider key exists only as an encrypted secret binding. WASM work remains stopped. Direct endpoint tests, runtime deployment, node activation, paid routing, scoring and payouts are distinct states.

Reproduce using `npm test`, `npm run build:expanded:worker`, `npm run audit:expanded:bundle`, then `npm run dev:expanded:worker` and `npm run smoke:expanded` in another terminal. Smoke requires the earlier ignored live on-chain captures. Public smoke uses `npm run smoke:expanded -- https://referenceforge.0xsaroj001.workers.dev`. Deploy after tests/audit with `wrangler deploy --config deploy/expanded.wrangler.jsonc --minify --keep-vars`. All provider reads are bounded and public; no paid service or upgrade was added.

Primary references: [live intent catalogue interface](https://docs.telegraphprotocol.com/docs/using/intents), [registration and update](https://docs.telegraphprotocol.com/docs/miners/miner-registration), [ERC-20 units and optional metadata](https://eips.ethereum.org/EIPS/eip-20), [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898), [dRPC free-tier limits](https://drpc.org/docs/howitworks/ratelimiting).

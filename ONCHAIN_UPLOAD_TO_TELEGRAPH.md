# ReferenceForge Onchain: registration inputs

Historical handoff for the separately registered Onchain miner 4843. The current task consolidates it with numeric miner 4838. Use [UNIFIED_MIGRATION.md](UNIFIED_MIGRATION.md) and `tools/update-miner.mjs`; do not run the old registration command to combine them.

Public deployment verified on 25 October 2026. This is a separate miner service for both CRYPTO_TRANSFER_VERIFY and ONCHAIN_METRIC_VERIFY. Register the single YAML once; it declares two endpoints and both intents.

| Field | Exact value |
|---|---|
| YAML URL | https://referenceforge-onchain.0xsaroj001.workers.dev/miner.yaml |
| YAML SHA-256, bytes32 | `0x0249b5ce39199dcc0df449ebc57048aee6be798eed9b2e548db2621e1d5ba17d` |
| Requires API Key | Off |
| API Key | Leave blank |
| Miner name | ReferenceForge Onchain |
| Candidate YAML ID | 1900999001; not reserved or registered |

The hosted YAML contains 5,610 bytes and matches the verified local download at `dist/upload-verified-onchain/miner.yaml`. This hash is SHA-256, not Ethereum Keccak-256. Do not edit the YAML after recording its hash. Any byte change requires re-fetching and recomputing the hash.

## Console steps

1. Open [Telegraph registration](https://integrate.telegraphprotocol.com/register?mode=hash) using your intended account and wallet.
2. Paste the YAML URL and hash above. Turn Requires API Key off and leave the key empty.
3. Validate the endpoints and inspect identity conflicts and warnings. The public catalogue had no matching candidate ID/slug when checked; that does not reserve the identity or replace the authenticated validator.
4. Select your intended fee address and floor price in the console. The deployment does not choose a new wallet or sign for you.
5. Review and approve registration yourself if the validator is satisfactory. Save its transaction hash and issued registration ID, then check actual node indexing/routing for both intents.

No on-chain registration, validator pass, reward, ranking or network admission is claimed by this deployment. WASM remains stopped. The earlier numeric Worker and its hosted miner/WASM hashes were checked unchanged.

## What was verified

### User-run terminal registration

From this project folder, run:

```powershell
node tools/register-miner.mjs --interactive
```

Enter your intended **public wallet address**, fee recipient (Enter uses that same wallet), and floor price (Enter uses the documented minimum of 0.01 USDC). The helper shows the fixed Base Sepolia contract, exact hosted YAML SHA-256, both intents, calldata terms, balance and estimated gas budget. The floor price is your service price per request, not a USDC payment for registration. Registration sends zero ETH value and pays testnet gas only.

Type `REGISTER_ONCHAIN_MINER` only after reviewing those details. Then paste the matching private key at the hidden local terminal prompt. It is not accepted in command arguments, written to a file or printed. The helper refreshes the artifact, contract simulation, nonce and gas checks before signing. It sends **one transaction containing both intents**, never two separate registrations. It does not modify miner 4838 or register WASM.

Read-only preflight and later receipt status are available with your public address:

```powershell
node tools/register-miner.mjs --check --account YOUR_PUBLIC_WALLET_ADDRESS
node tools/register-miner.mjs --status --account YOUR_PUBLIC_WALLET_ADDRESS
```

Optional `--fee-address PUBLIC_ADDRESS` and `--floor-price-usdc 0.01` select the fee recipient and service price. The default mode is read-only. Use Base Sepolia test ETH, not mainnet ETH or test USDC, for gas. A separate 0.00005 test ETH balance reserve covers possible L1 data fees; it is a reserve, not an exact fee quote or a guaranteed total-fee cap.

The helper saves the deterministic transaction hash to ignored `reports/miner-terminal-registration/` before the single broadcast. A pending, ambiguous, reverted or confirmed attempt blocks another registration from that helper journal. Keep the journal and any interrupted lock file; use `--status` to inspect an uncertain result. This local guard cannot discover every registration made manually or on another machine. If you already registered this YAML manually, cancel and use its existing ID. Simulation and health checks do not replace the authenticated Telegraph validator or prove node admission. After confirmation, use the issued registration ID to check indexing and routing for both intents.

The helper was tested using offline mock signers and a live read-only preflight. The agent did not enter a real key, sign or broadcast a registration transaction. This terminal helper is local tooling and is excluded from the deployed Worker bundle.

### Deployment smoke

Final public smoke passed 16/16: hosted bytes/content type, two-intent health, both real endpoints on Base and Base Sepolia, POST JSON, parameter/error behavior, unavailable private paths and preservation of the earlier Worker assets. The final active Worker version is `8cb88dcb-7883-41f9-a89f-c1ac2cc88389`. All 108 Node tests passed after deployment changes.

The initial deployment exposed HTTP 429 failures at the public RPCs from the Cloudflare execution location. The deployed pair is Tenderly public RPC plus Allnodes PublicNode. One short bounded Retry-After retry was added while preserving agreement from both sources and request limits. The final five real data calls were approximately 675 to 1,044 ms from the checking machine. This is a small successful smoke sample, not sustained uptime or a production latency guarantee. Free shared RPCs can still become unavailable under rate limits. Failed checks and raw diagnostic reports remain local under ignored `reports/onchain-deployment/`.

Only seven original runtime modules and one explicit YAML asset were uploaded. Competitor repositories, strategy, local research, generated reports, credentials and signing helpers were excluded. No paid upgrade or API key was added.

For scope, limitations and reproduction, see [ONCHAIN_MINER.md](docs/ONCHAIN_MINER.md).

# Alchemy Free setup for ReferenceForge

Alchemy is now configured on the deployed Worker. The supplied app key is stored as the encrypted Cloudflare secret `ALCHEMY_API_KEY`; it is absent from project files and public artifacts. Base access is enabled in the existing Alchemy app. After initial HTTP 403 responses while access was being enabled, all 29 public checks and the read-only expansion preflight passed on 26 October 2026. The runtime uses Alchemy plus Allnodes PublicNode. No wallet transaction was involved in this setup.

## Setup procedure for a future credential change

1. Open [Alchemy Dashboard](https://dashboard.alchemy.com/) and complete sign-up/sign-in yourself. Select **Free**. Do not enable Pay as You Go or enter a payment commitment for this setup.
2. Use the existing default app if one was created for you. Enable **Base Mainnet** and **Base Sepolia**, with **Node RPC** access. If an app name is required, use **ReferenceForge**. No wallet, paymaster, NFT or transaction-sponsorship product is required.
3. Copy that app's **API key**. This is a provider credential, not a wallet private key and not a full RPC URL. Keep it out of chat.

[Alchemy's official app/API-key guide](https://www.alchemy.com/docs/create-an-api-key) describes the current dashboard. Its [Free plan](https://www.alchemy.com/pricing) currently lists 30 million compute units per month and 15 requests per second. Compute units are not request counts; actual consumption depends on methods. This is a test-stage allowance, not a traffic forecast or production uptime guarantee.

## Enter the key privately in PowerShell

```powershell
cd "C:\Users\hyada\OneDrive\Documents\Work-Related\Hackathons\Telegraph hackathon sarojyadav"
node tools/configure-alchemy.mjs --interactive
```

Review the target Cloudflare account and Worker, then type `CONFIGURE_ALCHEMY_FREE`. Paste the **Alchemy app API key** at the hidden prompt. A wallet-key-shaped value is rejected before any upload. The helper performs six bounded, read-only checks against your Alchemy app: chain ID, a safe block header and a canonical block-hash balance read on each network. A wrong network or unsupported read stops the upload.

The helper sends the API key through stdin to the authenticated local Wrangler CLI, which stores it as the encrypted Worker secret `ALCHEMY_API_KEY` on `referenceforge`. It is not placed in command arguments, printed or written to a project file. CLI output is not echoed by the helper. Secret insertion deploys a new version of the same currently active Worker code. If the CLI does not confirm success, the helper stops instead of automatically retrying.

The Worker sends Alchemy authentication in the `Authorization: Bearer` header, following [Alchemy's header-authentication documentation](https://www.alchemy.com/docs/how-to-use-api-keys-in-http-headers). The key is absent from RPC URLs, response evidence and our diagnostic logs. `/health` reports only `alchemy_account_plus_publicnode` or `shared_public_rpcs`, never the key.

## Verify before updating intents

The current setup has passed these checks. Rerun them after changing provider configuration:

```powershell
node tools/smoke-expanded.mjs https://referenceforge.0xsaroj001.workers.dev
node tools/expand-miner.mjs --check
```

The full public smoke must pass. The update preflight requires the Alchemy configuration plus fresh successful checks of native balances on both networks, a known transaction lookup and a currency conversion before it reaches signing. Current shared public RPC configuration is deliberately blocked from expansion signing.

Once those checks pass, the seven-intent update is:

```powershell
node tools/expand-miner.mjs --interactive
```

Type `EXPAND_REFERENCEFORGE_7` after reviewing the transaction, then enter the **wallet private key** at the separately labelled hidden signing prompt. This is a different credential from the Alchemy key. The update replaces active registration 4844 with a new ID, retains the existing four intents and adds CURRENCY_EXCHANGE, ONCHAIN_TX_LOOKUP and WALLET_BALANCE_CHECK. It preserves the fee recipient and 0.01 USDC floor. It does not create another miner or remove FX_NOW by default. Existing FX_NOW coverage is still daily ECB reference data, not an institutional live feed or spread.

See [INTENT_EXPANSION.md](INTENT_EXPANSION.md) for exact hosted descriptor hashes, coverage limits and duplicate-attempt protection. Account setup, secret configuration, successful public reads and on-chain activation are separate milestones. The user supplied the provider credential and the agent installed it through the authenticated Cloudflare connector. No paid plan was enabled and no intent update was signed or broadcast. Competitor research remains local.

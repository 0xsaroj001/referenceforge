# Hosting and registration preparation

Current state: deployed to [referenceforge.0xsaroj001.workers.dev](https://referenceforge.0xsaroj001.workers.dev) on 24 October 2026. The final eight public checks pass and the hosted YAML/WASM match prepared bytes. See the [exact upload handoff](../UPLOAD_TO_TELEGRAPH.md). Authenticated Telegraph validation and network registration remain pending.

A GitHub source repository does not host the dynamic miner. The integration console needs a public HTTPS origin reachable without this laptop.

## Local preparation

After `npm ci`, build WASM and prepare the exact assets:

```powershell
npm run build:wasm
npm run prepare:deploy -- --id 1900999000 --base-url https://referenceforge.YOUR-SUBDOMAIN.workers.dev
npm run build:worker
npm run check:public-bundle
npm run dev:worker
```

The example origin is a placeholder. It cannot be used to register. The numeric ID is a candidate whose availability must be validated.

In another terminal:

```powershell
npm run smoke:worker -- http://127.0.0.1:8788
```

The dry run uploads nothing. Only three static assets are allowed: `miner.yaml`, `referenceforge-comparator.wasm` and `artifact-manifest.json`. Runtime code comes from the Worker dependency graph.

## Account and real origin

Complete the hosting account login and CLI authorization locally. Credentials and verification steps belong in the provider's own flow.

```powershell
npx wrangler login
npx wrangler whoami
```

Once the actual Workers subdomain is known, rerun preparation with that origin, rebuild and audit. A deployment needs its own authorization; the user authorized this deployment on 24 October 2026. Source publication alone does not constitute deployment or a purchase.

The deployment command, when authorized, is:

```powershell
npx wrangler deploy --config deploy/wrangler.jsonc
npm run smoke:worker -- https://referenceforge.ACTUAL-SUBDOMAIN.workers.dev
```

Confirm the provider's returned URL, public health/source behavior and exact YAML/WASM hashes. Inspect provider CPU and runtime metrics separately from local emulator behavior.

## When integration-console input is ready

| Field | Required value |
| --- | --- |
| YAML URL | Verified public URL ending `/miner.yaml` |
| YAML hash, bytes32 | `0x` plus SHA-256 of the exact final hosted YAML bytes |
| Requires API Key | Off |
| API Key | Blank |

Prepared values are written to ignored `reports/registration-inputs.json`. A prepared hash is not hosting or validator evidence. Descriptor changes require regeneration and a new exact-byte check.

Miner YAML uses SHA-256. The WASM registration artifact uses Ethereum Keccak-256. They are different hashes.

Use [the Telegraph integration console](https://integrate.telegraphprotocol.com/register) to validate the final descriptor with an authenticated session. Inspect all endpoint failures, warnings and identity conflicts, and save the result locally. A validator pass still does not constitute an on-chain registration.

For the evaluator, confirm the live comparator ABI and supported refusal policy before uploading the final binary/hash. The context guard is not part of the WASM artifact. No wallet transaction or submission is performed by these preparation commands.

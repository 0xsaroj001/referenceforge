# ReferenceForge

The current runtime serves ten capabilities under one ReferenceForge identity: its seven numeric/blockchain capabilities plus WEATHER_FORECAST, WEATHER_CHECK and STORM_ALERT. Weather uses original NWS-backed endpoints for US land coordinates. See [the weather guide](docs/WEATHER_MINER.md) and [requirements map](docs/WEATHER_REQUIREMENTS.md) for exact boundaries, tests and the current user-run update command.

The last verified on-chain registration is still 4844 with four intents; 4838 and 4843 are inactive. One user-run update can activate the ten-intent descriptor without an intermediate seven-intent update. The new helper also handles a completed seven-intent update when its exact receipt and original journal are available. Direct endpoint availability, registration, node activation and routed scoring are separate states. WASM development remains stopped.

The earlier separate Onchain service remains hosted during migration. Its implementation and scope are documented in [ONCHAIN_MINER.md](docs/ONCHAIN_MINER.md). Legacy public YAML and WASM bytes remain available at their original URLs.

The original ReferenceForge 0.2.1 implementation serves numeric references from the European Central Bank and World Bank. The repository also includes its original Rust WASM comparator, structured-context evaluation harness and separate service packages. The deployed weather Worker reports version 0.5.1.

The original numeric deployment's source and artifact checks passed on 24 October 2026. Local correctness and deployment do not establish scoring, rewards or a competitive ranking advantage. The [original upload handoff](UPLOAD_TO_TELEGRAPH.md) is historical; use the weather guide for the current update.

See [network quality and the optional routing-contract revision](docs/NETWORK_QUALITY.md) for the verified score failure classes and owner-run metadata update. [The Provider evidence packet](docs/PROVIDER_EVIDENCE.md) separates completed tests from pending routing, forecast skill and adoption evidence.

## Run locally

For the ten-capability Worker, run `npm run dev:weather:worker`. The earlier seven-capability runtime is available with `npm run dev:expanded:worker`. The commands below run the legacy numeric Node server; `npm run start:onchain` runs the separate on-chain Node adapter. The earlier four-endpoint Worker can still be run with `npm run dev:unified:worker`.

Requires Node.js 24 or newer. Rust with the `wasm32-unknown-unknown` target builds the comparator; Go 1.26 runs the second WASM runtime and pinned official reference check. Python 3 runs the optional independent live transformation check.

```powershell
npm ci
npm test
npm start
```

The Node server listens on `http://127.0.0.1:8787`.

| Request | Purpose |
| --- | --- |
| `GET /health` | Service version, supported intents and explicit registration state |
| `GET /fx?base=USD&quote=INR&amount=20` | Latest published ECB daily reference conversion |
| `GET /macro?country=US&indicator=unemployment&year=2019` | Exact annual World Bank observation |

Successful responses include decimal strings, units, observation periods and source provenance. Unsupported scope and unavailable observations return explicit errors. The miner requires no upstream API key.

## Build and verify WASM

```powershell
rustup target add wasm32-unknown-unknown
npm run test:rust
npm run build:wasm
npm run test:wasm
npm run test:wazero
npm run test:official
npm run bench:miner
npm run bench:input-cache
npm run bench:wasm
```

The official check downloads two hash-pinned MIT-licensed files from an official repository revision into an ignored local cache if absent. It executes that reference as a test answer key. It does not establish which revision a live node uses.

The 2,400-vector corpus includes 2,370 arithmetic-safe cases matching the pinned reference and 30 overflow-domain cases deliberately refused by our comparator. Zero truth is also refused. See [validation](docs/VALIDATION.md) for limits and reproduction details.

## Documentation

1. [Product scope](PRD.md)
2. [Architecture](ARCHITECTURE.md)
3. [Implementation phases](PHASES.md)
4. [Open gaps](GAPS.md)
5. [Demo procedure](DEMO.md)
6. [HTTP and WASM interfaces](docs/INTERFACES.md)
7. [Validation and benchmark methodology](docs/VALIDATION.md)
8. [Deployment and registration preparation](docs/DEPLOYMENT.md)
9. [Contribution and publication boundaries](CONTRIBUTING.md)

Generated artifacts, reports, session notes and research archives are excluded from version control. A source repository or a prepared deployment package is not a running miner or a registration receipt.

## Optional user-run terminal registration

The [terminal guide](docs/TERMINAL_REGISTRATION.md) covers the original WASM-only helper. It uses the official Base Sepolia RPC, verifies the pinned hosted artifact, reads the key through a hidden local prompt and asks for explicit confirmation before one broadcast. It never registers the miner. A durable local transaction record blocks a second submission after a timeout. The agent has not run a signing or broadcast mode.
## Weather validation

ReferenceForge now has three original NWS-backed US weather endpoints alongside its seven existing capabilities. See [weather setup, boundaries and update command](docs/WEATHER_MINER.md) and the [requirements map](docs/WEATHER_REQUIREMENTS.md). Public weather checks pass 32/32 and the previous-capability regression checks pass 29/29. These are direct HTTP results; the ten-intent registration update, routing and forecast accuracy remain separate verification steps.

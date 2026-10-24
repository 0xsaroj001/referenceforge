# ReferenceForge

ReferenceForge 0.2.1 serves numeric references from the European Central Bank and World Bank. It also includes an original Rust WASM comparator, a structured-context evaluation harness, and a Cloudflare Workers package.

The service has been tested locally with fixtures and real upstream responses. Public deployment, Telegraph validation, network admission and submission remain pending. Local correctness does not establish a competitive ranking advantage.

## Run locally

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

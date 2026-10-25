# ReferenceForge demo

## Offline service checks

```powershell
npm ci
npm test
npm run bench:miner
npm run bench:input-cache
```

Expected: 37 Node tests, including ten terminal-registration safeguards, 35 authored miner cases, 14 input/cache cases, and 200 successful warm loopback requests. Historical comparison fields are null in a fresh checkout because local archives are not included. Timing varies by machine and run.

## Comparator checks

Requires Rust with the WASM target and Go 1.26.

```powershell
rustup target add wasm32-unknown-unknown
npm run test:rust
npm run build:wasm
npm run test:wasm
npm run test:wazero
npm run test:official
npm run bench:wasm
```

Expected: six Rust tests; 2,400 vectors in Node and wazero; 2,370 matches against the pinned official source plus 30 overflow-domain exceptions. The official check may download the reviewed source and license if its local cache is empty.

## Live source demonstration

```powershell
npm start
```

In another PowerShell terminal:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8787/health'
Invoke-RestMethod 'http://127.0.0.1:8787/fx?base=USD&quote=INR&amount=20'
Invoke-RestMethod 'http://127.0.0.1:8787/macro?country=US&indicator=unemployment&year=2019'
```

Inspect the observation period, units, numeric string and source fields. A request for spot FX returns a refusal rather than a daily value.

Optional live comparison and context demonstration, after building WASM and with Python 3 available:

```powershell
npm run bench:live
npm run bench:evaluator
```

These commands call free public data endpoints and save results locally. The prior six-read FX comparison tied the public API baseline under the pinned scoring rule. The context demonstration checks 27 authored cases; it is outside the WASM ABI.

For the local Worker package and eventual public checks, follow [deployment preparation](docs/DEPLOYMENT.md). A demo is not a Telegraph registration or submission.

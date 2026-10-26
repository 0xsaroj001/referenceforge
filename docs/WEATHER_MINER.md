# ReferenceForge weather Provider

ReferenceForge now serves WEATHER_FORECAST, WEATHER_CHECK and STORM_ALERT alongside the existing seven capabilities, using the same permanent Cloudflare Worker and identity. The weather implementation is original and uses NOAA National Weather Service data. It does not require a weather subscription. Alchemy remains the encrypted provider credential for blockchain capabilities only.

The complete contract is [WEATHER_REQUIREMENTS.md](WEATHER_REQUIREMENTS.md). Weather coverage is NWS-covered US land coordinates. City-name geocoding, global forecasts, flight disruption, internal private observations and predictions of unissued warnings are outside scope. Telegraph callers must resolve the requested place to coordinates and respect those limits.

## Try the deployed service

```powershell
curl.exe "https://referenceforge.0xsaroj001.workers.dev/weather/forecast?lat=25.7617&lon=-80.1918&hours=24"
curl.exe "https://referenceforge.0xsaroj001.workers.dev/weather/current?lat=25.7617&lon=-80.1918&metric=temperature"
curl.exe "https://referenceforge.0xsaroj001.workers.dev/weather/alerts?lat=25.7617&lon=-80.1918"
```

Forecasts contain complete future hourly intervals, temperatures in Celsius, wind speed ranges in km/h and hourly precipitation probability percent. These are distinct from station observations and issued warnings. The maximum of hourly precipitation probabilities is explicitly labelled; it is not the probability of any rain over the full day. Unknown source values remain null; requesting an unavailable scalar fails explicitly. Temperature/wind conversion rounds to 0.001 units and does not imply additional source precision.

The service reports both forecast update time and response generation time. Issue age is capped at 24 hours; response generation age is capped at two hours. Those are declared product limits, not an NWS guarantee of freshness. The initial six-hour issue cutoff rejected a New York response whose generation was recent and issue was about 12 hours old; that sample remains in local evidence. Changing the policy is disclosed rather than relabelling generatedAt as a new meteorological issuance. Observations independently retain their stricter 90-minute age limit and a disclosed station distance of at most 50 km.

Alerts preserve NWS validity, severity, certainty, urgency and instructions. Test, cancelled, expired and unrelated alerts are excluded. A successful empty result says no matching issued alerts were returned. It never asserts no risk. Failed, malformed or truncated feeds cannot return an all-clear. This API is not an emergency warning dissemination or safety certification system.

Requests use the identifying ReferenceForge User-Agent, a bounded source allowlist, no redirects, a ten-second overall source deadline and at most six source HTTP requests. Cache entries hold validated resolved source text, never pending request I/O. Isolate and Cloudflare Cache API storage revalidate data on use and respect upstream max-age/no-cache/no-store. Caches are best-effort and do not eliminate duplicate cold requests across locations. A fresh current-observation request may need point lookup, station catalogue and up to three station reads; cached lookup data reduces those calls. No weather source subscription was purchased.

## User-run ten-intent update

Use this upgrade instead of the earlier seven-intent command if that update has not been run:

```powershell
cd "C:\Users\hyada\OneDrive\Documents\Work-Related\Hackathons\Telegraph hackathon sarojyadav"
node tools/upgrade-weather-miner.mjs --check
node tools/upgrade-weather-miner.mjs --interactive
```

Review the fixed account, current registration, ten intents, fee recipient, 0.01 USDC floor, exact artifact and gas ceiling. Type `UPGRADE_REFERENCEFORGE_10` and enter the matching wallet private key at the hidden local prompt. The helper sends one updateMiner transaction; it replaces the current registration with a new ID, retaining one ReferenceForge miner. It does not send USDC or add a separate miner. The agent never receives the signing key or broadcasts this transaction.

| Field | Exact value |
|---|---|
| YAML URL | https://referenceforge.0xsaroj001.workers.dev/referenceforge-weather.yaml |
| SHA-256 bytes32 | `0xde4f29445f76a1679c832ab19f5d92eaf2e5c56f893528cad329d8fd59641e68` |
| Network | Base Sepolia 84532 |
| Last checked current registration | 4844, four intents |
| Default final capabilities | FX_NOW, MACRO_ECONOMIC_INDICATOR, CRYPTO_TRANSFER_VERIFY, ONCHAIN_METRIC_VERIFY, CURRENCY_EXCHANGE, ONCHAIN_TX_LOOKUP, WALLET_BALANCE_CHECK, WEATHER_FORECAST, WEATHER_CHECK, STORM_ALERT |

If a seven-intent update was already executed, this helper requires its verified receipt and matching original journal before updating that newly issued registration. Unknown, pending or changed state stops signing. Both helpers share an exclusive wallet-update lock and cross-check prior attempt journals. Preserve journals after an interrupted run. Never delete one to repeat a transaction.

```powershell
node tools/upgrade-weather-miner.mjs --status
```

A confirmed chain receipt and active Telegraph node entry are checked separately. Successful direct HTTP calls and a simulated update do not establish authenticated validator acceptance, routed requests or scores. FX_NOW still has the previously disclosed daily-reference scope mismatch; it was retained at the owner's request, and is not claimed to fulfil live institutional spreads.

## Reproduce the evidence

```powershell
npm test
npm run bench:weather
npm run check:weather:source
npm run prepare:weather:deploy
npm run build:weather:worker
npm run audit:weather:bundle
npm run dev:weather:worker
# In another terminal:
npm run smoke:weather
npm run smoke:weather -- https://referenceforge.0xsaroj001.workers.dev
npm run smoke:expanded -- https://referenceforge.0xsaroj001.workers.dev
```

The final public weather sample passes 32/32 checks and the seven-capability regression sample passes 29/29. Local live cases and independent Python source-conformance checks each pass 9/9 for Miami, New York and Kansas. These compare the same NWS source facts, not independent meteorological ground truth or competitor performance. The first local sample was 8/9 under the initial freshness policy. Timestamped successes and failures stay local. The original six public artifacts are preserved byte-for-byte; the seventh asset is the weather descriptor. Bundle audit permits twelve original runtime modules and seven explicit assets. Local research, credentials, signing tools and reports are excluded from public assets.

## Workflow and prospective accuracy evidence

```powershell
node tools/weather-brief.mjs
node tools/weather-forecast-skill.mjs --status
# Only after the displayed target time:
node tools/weather-forecast-skill.mjs --evaluate
```

The brief combines all three capabilities for an illustrative outdoor-operations workflow, preserves official instructions and flags review thresholds. It uses direct HTTP and is our own integration demonstration, not an independent H2 app, safety decision or Telegraph receipt. Missing/mismatched input yields insufficient_data. Thresholds are illustrative and require review by a real operator before operational use.

A frozen prospective sample contains 72 future forecast hours across three locations. Capture preceded every target time and the plan is hashed and cannot be overwritten by the capture command. The first full observation comparison can run after 27 October 2026 at 06:30 UTC (12:00 IST). No scheduled automation was installed. Future temperature evaluation pairs nearby station observations within 30 minutes, reports missing hours and station distance, and computes MAE/RMSE only when observations exist. It does not establish same-point truth, precipitation verification or a Telegraph quality score. No forecast skill has yet been measured.

The next network gate is owner-run update, followed by node activation and genuine Telegraph-routed samples for each claimed intent. The competition campaign then needs event-period, independently repeatable workflow evidence and an honest Provider submission. Registration, an internal demo and Explorer demand estimates do not establish awards or real paid adoption.

Source references: [NWS API](https://www.weather.gov/documentation/services-web-api), [OpenAPI](https://api.weather.gov/openapi.json), [NWS public information and delivery disclaimer](https://www.weather.gov/disclaimer), [Telegraph YAML](https://docs.telegraphprotocol.com/docs/miners/yaml-config), [Season II rules](https://hackathon.telegraphprotocol.com/rules).

## Terminal review timestamp correction, 26 October 2026

The first user-run weather upgrade stopped after hidden key entry with a review-changed/expired error. Root cause was our makeWeatherPlan omitting checkedAt, causing the common refresh safeguard to see an invalid review age. No journal or broadcast was produced; live status still shows active registration 4844 and nonce 6. The helper now emits the required timestamp. Error messages separately identify invalid timestamp, expiry, nonce change, changed transaction details, gas ceiling and funding. New regression checks exercise actual weather plans through refreshReviewed and sendOnce to a mock signer boundary, with no broadcast. Full suite: 286/286. Two successive live read-only preflights also pass the actual shared refresh guard; both are funded at nonce 6. No wallet private key was supplied to the agent. This is a local helper repair; deployed runtime and descriptor bytes are unchanged.

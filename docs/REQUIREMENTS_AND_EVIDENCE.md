# Concrete Intent requirements and evidence

Observed 29 October 2026 from GET https://devnode.telegraphprotocol.com/engine/v1/intents and each selected detail. All twelve candidate detail calls returned HTTP 200. Their presence is not our registration or conformance. The ten existing service families remain implemented. Five concrete subsets now have an original local adapter, descriptor and contract-version/unit tests: see [V2 contract mapping](ANJOMAN_V2.md). The complete list below is not a ready-to-upload registration list.

| Candidate concrete Intent | Class | Request version / inputs | Output version / fields |
|---|---|---|---|
| FX_NOW_CAD | deterministic | 3 / currency (required) | 1 / rate [scored] |
| FX_NOW_EUR | deterministic | 3 / currency (required) | 1 / rate [scored] |
| FX_NOW_SEK | deterministic | 3 / currency (required) | 1 / rate [scored] |
| MACRO_ECONOMIC_INDICATOR_GENERAL | judgment | 4 / indicator (required), country (required), year (required) | 4 / rate_pct [scored] |
| CRYPTO_TRANSFER_VERIFY_GENERAL | judgment | not published (null) | not published (null) |
| ONCHAIN_METRIC_VERIFY_GENERAL | judgment | 3 / address (required), block (required) | 3 / balance_gwei [scored], address, block, chain |
| CURRENCY_EXCHANGE_CONVERT | deterministic | 3 / from_currency (required), to_currency (required), amount (required) | 1 / converted_amount [scored] |
| ONCHAIN_TX_LOOKUP_GENERAL | judgment | 4 / tx_hash (required), chain (required) | 4 / tx_hash, status, from, to, block_number [scored], value_eth |
| WALLET_BALANCE_CHECK_GENERAL | judgment | 5 / address (required), chain (required), token | 5 / address, chain, balance [scored], token_symbol, as_of |
| WEATHER_FORECAST_GENERAL | judgment | 3 / location (required), window_hours (required) | 3 / location, when, temp_max_c [scored], temp_min_c, precipitation_probability_pct, condition |
| WEATHER_CHECK_TEMPERATURE | deterministic | 3 / location (required) | 1 / temperature_c [scored] |
| STORM_ALERT_GENERAL | judgment | 4 / location (required), window_hours (required) | 4 / location, risk_score [scored], risk_level, peak_gust_kmh, precipitation_mm, window |

## Actual compatibility gaps

FX_NOW_CAD/EUR/SEK score current USD-to-target mid-market rate. Preserve quote orientation; ECB daily references do not establish live pricing. CURRENCY_EXCHANGE_CONVERT uses from_currency, to_currency and amount; its scored field description still mentions 100 USD while input allows other amounts. That inconsistency needs clarification, not hard-coded fabrication.

MACRO_ECONOMIC_INDICATOR_GENERAL currently restricts indicator to unemployment rate (World Bank SL.UEM.TOTL.ZS), with country and year; output is rate_pct. Broad macro capability does not mean this schema accepts all indicators.

ONCHAIN_METRIC_VERIFY_GENERAL asks for address and pinned block, scores balance_gwei, and has no chain input in the inspected request. Our Base support must not silently substitute for another chain. WALLET_BALANCE_CHECK_GENERAL and ONCHAIN_TX_LOOKUP_GENERAL need exact current inputs and output enums/units; support remains Base/Base Sepolia only until deliberately extended.

CRYPTO_TRANSFER_VERIFY_GENERAL returns null request and response in this snapshot. Define and test an accepted native/query integration rather than inventing typed params.

WEATHER_CHECK_TEMPERATURE takes location, including city or coordinates, and scores temperature_c. WEATHER_FORECAST_GENERAL takes location/window_hours with a maximum of 240, while our current API accepts coordinates and at most 48 hours. Correct location resolution and compatibility limits are required.

STORM_ALERT_GENERAL takes location/window_hours and scores a 0–1 risk_score, with LOW/MODERATE/HIGH/SEVERE grade and optional gust/precipitation context. Issued-warning counts, absent alerts and a forecast probability are not an implemented storm risk model. No ready V2 risk claim.

The WEATHER_FORECAST_VERIFY_GENERAL entry is a different family/task; it was not added to these candidates just because its name shares a prefix.

## Evidence requirements per claimed pair

Pin discovery/schema version and selected concrete name; adapt request and exact answer field/unit; prove realistic fresh-input and failure cases; measure latency/cost and declared limits; validate the actual V2 descriptor; then independently verify current deployment, registration, shaped result and mission impact. Raw captures remain local under reports/site-refresh-2026-10-29/. No paid ask, validator sandbox POST, registration or deployment was run for this snapshot.

Useful mission candidates: [Stablecoin](https://hackathon.telegraphprotocol.com/missions/stablecoin) transfer/payment evidence and [Web3/DeFi](https://hackathon.telegraphprotocol.com/missions/web3-defi) transfer or pinned-state evidence. These are proposed test targets, not accepted missions, affiliated buyers or production use. Mission-page family labels and kinds may differ from current live schemas; use the concrete live contract for implementation.

## Acceptance record template

For each pair record: concrete Intent/version; supported subset; supplied native and canonical inputs; independent source/truth; expected output and unit; actual result/field_status; errors tested; source and capture dates; runtime/descriptor hashes; costs/latency; platform validation; registration/routing/accounting evidence; mission-specific result; reviewer reproduction. Label each item local, public, indexed, independently reproduced, event-period or submitted accurately.

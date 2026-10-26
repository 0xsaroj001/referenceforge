# ReferenceForge weather requirements map

Checked 26 October 2026 against the canonical intent catalogue and official NWS API specification. Original implementation; no participant code or research is a dependency.

| Intent | Required result | Implementation boundary | Acceptance test |
|---|---|---|---|
| WEATHER_FORECAST | Future weather for an explicit location and window | NWS-covered US land points; coordinates, 1–48 complete future hours; temperature, precipitation probability, wind and condition text | Correct UTC intervals across DST, complete hourly coverage, issue age <=24 hours and response generation age <=2 hours, explicit nulls and refusal for missing requested fields |
| WEATHER_CHECK | Current atmospheric conditions | A reporting station within 50 km of the supplied NWS-covered point; observation <=90 minutes old; timestamp and distance disclosed | Model forecasts cannot substitute for observations; choose nearest fresh station among at most three; null is never zero |
| STORM_ALERT | Active or upcoming severe-weather warnings at the location | Issued NWS storm/wind/flood/winter alerts overlapping now through the next 24 hours; no global or unissued-storm prediction | Exclude tests, cancellations, expired and unrelated alerts; preserve official instructions; empty successful response means no matching issued alerts, not no hazard |

All endpoints accept latitude/longitude, not an ambiguous city string. The Telegraph descriptor explains coordinate extraction and coverage. Supported coordinates must resolve through NWS /points; this does not claim global coverage or station measurements at the exact request point. Each response includes source URLs, fetched timestamps, SHA-256 hashes, units and an explicit scope. No source failure becomes an all-clear answer. A selected scalar metric must be available throughout the requested window. Default text answers preserve context for the common signal mapping.

Ranked failures to prevent: false all-clear after an upstream failure; stale observation presented as current; shifted/partial forecast window; incorrect wind/temperature units; unsupported region presented as covered; alert filtering that drops severe events; unconstrained source requests; unverified ranking or income claims.

Sources: [canonical intents](https://devnode.telegraphprotocol.com/engine/v1/intents), [NWS API](https://www.weather.gov/documentation/services-web-api), [NWS specification](https://api.weather.gov/openapi.json), [NWS data disclaimer](https://www.weather.gov/disclaimer). Open-Meteo's free API has a non-commercial restriction, so it is not used in this callable Provider. MET Norway was evaluated for later global forecasts; its global payload lacked precipitation probability in the inspected sample, so the first release uses the fuller NWS hourly forecast contract. No subscriptions are required.

# Weather requirement boundaries

This page covers existing source behavior. Concrete V2 eligibility is in [requirements and evidence](REQUIREMENTS_AND_EVIDENCE.md), checked 29 October 2026.

Forecast acceptance: complete consecutive UTC intervals, correct C/F and wind conversions, source issue age at most 24 hours, generated response at most two hours old, no missing selected scalar disguised as zero.

Current conditions: accepted observation quality, age at most 90 minutes, station within 50 km, exact timestamp/distance disclosed. Latest-report failure may use bounded same-station recent history in prepared 0.5.4. A model forecast cannot substitute for a current observation.

Issued warnings: preserve official event/instruction text, filter tests/cancellations/expired or unrelated alerts correctly, and respect event end as well as message expiry. No all-clear on source failure.

These checks do not implement the V2 storm risk_score, global weather coverage, city resolution or a 240-hour forecast. The older broad family descriptions are insufficient registration requirements.

Sources: [NWS API](https://www.weather.gov/documentation/services-web-api), [V2 YAML](https://anjoman.ai/docs/miners/yaml-config), [live intent schemas](https://devnode.telegraphprotocol.com/engine/v1/intents).

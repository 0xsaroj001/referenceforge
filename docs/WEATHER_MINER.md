# Original weather service

Current native API, with V2 migration still required. Source: NOAA/NWS for covered US land coordinates.

| Route | Scope |
|---|---|
| /weather/forecast | Complete future hourly forecast, 1–48 hours, Celsius, wind, peak hourly precipitation probability |
| /weather/current | Fresh accepted-quality station observation within 50 km and 90 minutes |
| /weather/alerts | Issued matching storm/wind/flood/winter alerts for the supported next-24-hour window |

Source URLs, timestamps, units and hashes are returned. Invalid/stale/missing source data is refused. Empty issued-alert results do not mean zero future hazard probability. The prepared Kansas fix can inspect one bounded recent-history page when latest station reports lack required measurements; public runtime remains the earlier 0.5.2 checkpoint.

Native parameters are coordinates; a V2 place-name request needs a trustworthy location mapping. Weather schema requests can span up to 240 hours while this implementation supports 48. Declare or enforce compatibility; do not truncate silently.

WEATHER_CHECK_TEMPERATURE scores temperature_c. WEATHER_FORECAST_GENERAL includes temp_max_c, temp_min_c and other context. STORM_ALERT_GENERAL scores a 0–1 risk_score with a risk grade; the current issued-alert API does not implement that assessment. See [exact map](REQUIREMENTS_AND_EVIDENCE.md).

The completed frozen pilot matched 52/72 hours. Forecast MAE 1.563250 C versus persistence 1.550000 C; 20 hours missing. This gives no general superiority claim. Later protocol/byte/analysis integration tests are synthetic. Broader weather collection is not active and is not the next campaign priority until a concrete mission requires it.

```powershell
npm run dev:weather:worker
npm run smoke:weather
```

These commands test existing service behavior, not V2 network acceptance. Keep the legacy WASM comparator stopped and use the current [Provider requirements](SEASON_II_RULES.md). The separately authorized V2 Evaluator contribution is evaluation material, not that comparator.

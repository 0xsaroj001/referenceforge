> Current checkpoint, 29 October 2026: this is an original implementation/tooling reference. Current competition and deployment requirements are in [Anjoman V2](ANJOMAN_V2.md). Legacy signing/descriptor examples do not establish V2 readiness; WASM stays stopped.

# Alternative weather windows

This original offline consumer combines the existing WEATHER_FORECAST,
WEATHER_CHECK and STORM_ALERT answers. It proposes three-hour alternatives
under explicit illustrative thresholds and preserves timestamps, station
distance, units, source hashes and official instructions. It is our own Provider
demonstration, not an App-track entry, independent user or Telegraph receipt.
It adds no miner intent or Worker endpoint.

## Run and replay

```powershell
node tools/weather-window-plan.mjs --live
# Or an explicit NWS-covered US point:
node tools/weather-window-plan.mjs --live 39.7456 -97.0892
```

The command uses the original local weather runtime and bounded public NWS
reads. It does not call Telegraph, use a wallet, pay, deploy or register anything.
It writes a local capture and prints its path. Reproduce the result without
network calls using that path:

```powershell
node tools/weather-window-plan.mjs --replay reports/weather/window-plan-TIMESTAMP.json
```

Replace TIMESTAMP with the actual filename printed by the live command. Replay
uses the original capture time, verifies source/input hashes and compares the
deterministic result. It is labelled historical; it is not current planning data.
Raw captures and generated reports stay local. The CLI uses the prepared 0.5.3
weather implementation; it does not establish that runtime is publicly uploaded.

## Decision contract

By default, wind must remain below 30 km/h and each hourly precipitation
probability below 60%, with temperature between -10 and 40 C throughout the
three-hour window. These are illustrative configuration values, not validated
operational limits. The pure `planWeatherWindows` function accepts explicit
thresholds and durations of 1–24 hours.

Every candidate must contain complete contiguous forecast hours and fit within
the checked alert horizon. Every supplied issued alert blocks overlapping
candidates, independent of its severity label. Alert onset is inclusive. The
later of message expiry and a supplied event end is used as the exclusive block
boundary: expiring a message must not imply that a hazard with a later stated
end has ended. Official instructions remain visible even when an
alternative lies outside the alert interval. No future unissued warning is
predicted; users must review and refresh the information before operational use.

The planner rejects stale source captures, stale forecast issue/generation times,
stale/distant station observations, missing temperature quality metadata,
location mismatches, malformed alerts, incomplete probability coverage and
invalid units/values. It recomputes age from timestamps rather than trusting a
self-reported age. This is stricter than legacy outputs without quality fields.
It returns `insufficient_data` when no candidate has complete temporal coverage,
and `no_window_meets_thresholds` when fully covered candidates all fail the rules.
Neither state produces invented weather or an all-clear.

Acceptable candidates are ranked by lowest maximum individual hourly
precipitation probability, then lowest maximum wind, then earliest UTC start.
Up to three non-overlapping alternatives are selected greedily. This is not a
globally optimal schedule. The maximum hourly probability is explicitly not a
probability for the whole work window, and probabilities are never summed.

Tests cover alert boundaries, missing/stale records, zero values, invalid units,
threshold limits, deterministic ranking and incomplete alert coverage. Passing
these checks does not establish forecast skill, sustained availability, useful
independent adoption or award eligibility.

## Real-source checkpoint, 27 October 2026

A Miami sample returned a Coastal Flood Warning whose message expiry preceded
its expected event end. The initial expiry-only planner incorrectly admitted
post-expiry alternatives; a regression check now blocks through the later stated
boundary. Corrected replay of the identical captured inputs and a fresh NWS
sample both return no_window_meets_thresholds, preserving the instructions.
This is a successful refusal case, not evidence of usable real-world work windows.
The initial capture/result is retained locally. The distinction follows the
[official NWS Alert schema](https://api.weather.gov/openapi.json): `expires` is
information/message expiry and `ends` is the expected subject-event end.

A separate Kansas check returned NO_FRESH_OBSERVATION. No alternatives were
fabricated and the failure is retained locally. The collector now retains source
failure bodies/hashes as well as successes. Deterministic synthetic acceptance
cases demonstrate selection and ranking of valid alternatives; the real-source
sample demonstrates warning rejection. Neither is independent adoption.

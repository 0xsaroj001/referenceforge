# US place weather support

Live status updated 3 November 2026. Runtime 0.7.0 adds explicit US place and state inputs to the existing weather Provider. Active node miner **4889** now indexes the place descriptor and all five concrete Intents; downloaded and indexed SHA-256 agree. See [live status](LIVE_STATUS_2026-11-03.md). The release and update simulations below retain their original capture dates.

Examples are `Miami, FL`, `Miami, Florida` and the existing `25.7752,-80.2086` coordinate form. The resolver requires an exact normalized name and an explicit state. It removes diacritics and selected punctuation, but does not guess misspellings, a state, street addresses or popular cities. Foreign city search is outside scope. The forecast limit remains 1..48 hours and NWS geographic coverage still applies after resolution.

The authoritative [2026 Census Gazetteer](https://www.census.gov/geographies/reference-files/2026/geo/gazetter-file.html) provides the place name, state, GEOID and internal reference point. Its [record layout](https://www.census.gov/programs-surveys/geography/technical-documentation/records-layout/gaz-record-layouts/gaz26-record-layouts.html) defines these fields. The internal point is rounded to four decimals for the weather API; original coordinates and provenance are retained under `interpretation.location_resolution`. It is not a street address, population centroid or weather measurement for every part of a city.

All matching candidates are merged by GEOID before selection. A legal suffix can also be part of another place's proper name. For example, `Rockwell City, IA` could identify Rockwell city or Rockwell City city, so it is refused. `Rockwell City city, Iowa` explicitly identifies the latter. A similar conflict affects `Webster City, IA`. The independent agent review found nine such conflicts in the real dataset; all are retained locally and must refuse.

## Reproduce locally

```powershell
python tools/prepare-us-places.py
node tools/weather-place-brief.mjs --location "Miami, Florida" --resolve-only
node tools/weather-place-brief.mjs --location "Miami, Florida" --hours 24
node tools/release-places.mjs --check
```

Preparation verifies both source ZIPs and expected members, layouts, coordinate bounds and unique GEOIDs before generating the 32,363-place, 52-state/territory table. Source ZIP SHA-256 values are `af678e2d990827c89ee39b98c82de6e90b693c7361ff0e559ae3076670dd2863` for places and `54352ca34f869b4deca03a65da72cccb8e9f0c2702340061949b63c76c63f852` for states. Prepared data SHA-256 is `7ca6c01a06552fdfb0844973c8a18c48f107ca399d9a4a71412dfbf33a34e826`. Source archives, compiled data and reports remain ignored; the deployed Worker bundles only the public place table and original runtime code.

The client brief makes two direct free Provider GETs and preserves the actual responses. Maximum hourly precipitation probability is not whole-window event probability. These author-run calls are not Telegraph Engine traffic, paid use or independent adoption. This is supporting tooling and Provider coverage work, with no App-track entry.

## Release status

Runtime 0.7.0 was deployed on 2 November at 09:56 UTC to the existing [ReferenceForge Worker](https://referenceforge.0xsaroj001.workers.dev/health), Cloudflare version `1ec7280b-6359-47c9-9395-3044e7e67f9f`. Local release gates pass 561 tests, a 17-module/12-asset boundary audit and local workerd live current/forecast checks. Public checks pass both Miami current/forecast calls, all twelve asset hashes, invalid/ambiguous location refusals and protected-path checks. Deployment requires a successful local live receipt bound to the exact bundle, data, configuration and descriptor hashes, no older than one hour. Starting a smoke run invalidates any previous success until completion.

The place descriptor is a separate artifact at `/referenceforge-places-v2.yaml`, SHA-256 `0x431fe66212568d452c647c69c9c3c26f464bc0babbac79ff83e03f74a860a168`. It preserves the same five concrete intent mappings. The original `/referenceforge-v2.yaml` and other existing assets retain their bytes. At the 3 November 14:12 UTC refresh, active miner 4889 indexes this exact place descriptor and replaces 4864. This establishes indexed admission and hosted-byte identity, not a separately inspected replacement transaction, full node request shaping or independent forecast quality. Old Base helpers must not be redirected.

At Sepolia block 12047408, the existing miner 4864 and node remained active on the original descriptor. A read-only original-contract `updateMiner` simulation for the new hosted descriptor succeeded with the owner's actual balance and allowance. The owner then held 5.513449809782512684 test MACHINA and registry allowance 0.104632235149384664; no extra funding was required by that simulation. The full new-registration quote is not the update cost. These are time-bound reads; no transaction was signed or broadcast, and authenticated platform validation of the new descriptor is still separate.

Current verification receipts are local under `reports/places-provider/` and `reports/improvement-2026-11-02/`. A post-deployment compatibility recheck also passed all five original public V2 source workflows at 10:01 UTC. The full-table post-review audit resolves 32,168 full legal name/state inputs to their own GEOID and refuses 195 ambiguous inputs, with zero unexpected results across all 32,363 rows. This is a development consistency audit, not unseen accuracy evidence.

At the original 2 November handoff, the intended Optimus Chrome profile was absent from browser-control inventory; the other profile was not used. That dated access limitation does not make the now-indexed place descriptor pending again. No new signup, repeated registration or funding request is required by the current node evidence.

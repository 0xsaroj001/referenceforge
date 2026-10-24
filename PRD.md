# ReferenceForge product scope

Updated 24 October 2026. Miner version 0.2.1; comparator version 0.2.0.

## Problem and intended behavior

Numeric answers need the right observation, units and period as well as the right number. ReferenceForge retrieves a narrow set of published observations and returns enough context to inspect them. Unsupported requests fail explicitly rather than substituting a nearby answer.

## Miner scope

| Capability | Source and supported behavior | Scope limits |
| --- | --- | --- |
| FX reference | Latest ECB daily reference rates, directed cross-rates and nonnegative amounts | No intraday, executable quotes, forecasts or requested historical dates |
| Macro reference | World Bank annual GDP in current USD, real GDP growth, inflation, ILO-modelled unemployment and population | No monthly observations, policy rates, GDP per capita or PPP substitution |
| Observation selection | Exact requested year; otherwise latest available within the configured six-year lookback | Missing or ambiguous observations are refused |

Structured fields take precedence over question inference. Conflicting aliases are refused. The original question is retained for unsupported-scope checks. Decimal strings preserve source precision; conversions use exact integer/rational arithmetic before rounding.

## Evaluator scope

The WASM comparator accepts fixed-point signed integers and a comparison specification. It returns a score from 0 to 10,000 or a refusal. The host must declare the numeric scale.

A separate host check validates structured country/currency, indicator, units, frequency and observation period before numeric scoring. This check is outside the WASM interface. It neither authenticates metadata nor verifies arbitrary prose.

## Acceptance gates

1. Fixture, HTTP, failure-recovery and source-precision tests pass.
2. The comparator passes in both Node and wazero with compatibility exceptions disclosed.
3. A fresh checkout reproduces the local checks without private archives.
4. Hosted descriptor and WASM bytes match locally generated hashes.
5. The authenticated Telegraph validator accepts the final descriptor and endpoint behavior.
6. Network admission and valid evaluation evidence are recorded before making ranking or participation claims.

Gate 4 passed on 24 October 2026: the public YAML and WASM match prepared bytes, and all eight public smoke checks pass. Gates 5 and 6 remain open. An earlier source timeout is recorded in the [upload handoff](UPLOAD_TO_TELEGRAPH.md). Payments, independent external usage and competition success are not established.

# Implemented interfaces

This document describes ReferenceForge's current code. A generated descriptor and local ABI checks still require live platform validation.

## Miner HTTP

`GET /health` reports version 0.2.1, supported intents and an explicit unregistered state. `GET` and JSON `POST` are supported for `/fx` and `/macro`. JSON bodies are limited to 64 KB and parameters must be scalar.

| Endpoint | Canonical inputs | Supported aliases |
| --- | --- | --- |
| `/fx` | `base`, `quote`, optional `amount`, `question` | `from`, `to`, `query`, `q` |
| `/macro` | `country`, `indicator`, optional `year`, `question` | `query`, `q` |

FX currency fields are three-letter supported codes. Macro country accepts supported two/three-letter codes; indicators are `gdp`, `gdp_growth`, `inflation`, `unemployment`, `population`. An omitted year means latest within the configured lookback; an explicit year must exist exactly.

Success includes `status: "ok"`, `mode: "reference"`, `fallback: false`, `numeric_value`, `summary`, units, period and source provenance. Decimal values are strings.

Errors include `status: "error"`, a code/message, `fallback: false` and `verified_answer: false`. Client scope/input errors use `mode: "refusal"`; server/upstream errors use `mode: "unavailable"`. Error responses contain no substitute numeric answer.

## Descriptor

`tools/render-miner.mjs` produces JSON, which is valid YAML 1.2. It declares `FX_NOW` and `MACRO_ECONOMIC_INDICATOR`, keyless authentication and `numeric_value`/`summary` signal fields. A candidate ID and bare origin are required. Identity availability and request routing remain platform validation gates.

## WASM comparator

| Export | Signature and behavior |
| --- | --- |
| `memory` | Linear memory for one comparison specification |
| `imw_alloc` | `(i32 size) -> i32 pointer`; accepts exactly 16 bytes |
| `imw_free` | `(i32 pointer, i32 size) -> void`; clears the fixed specification |
| `imw_score_deterministic` | `(i64 truth, i64 miner, i32 pointer) -> i64 score` |

The specification contains two little-endian i64 words: comparison code and tolerance. Only the low 32 bits of the code are used. Codes 0/3 use exact equality; 1 uses absolute tolerance; 2 uses relative error quantized to integer basis points. Unknown codes fall back to exact equality in this implementation.

Scores range from 0 to 10,000. Invalid allocation pointers, zero truth and unsafe arithmetic return -1. One static allocation supports serial calls. There are no host imports.

The build adds a `telegraph.adapter` custom section with `abi_version: 1` and `class: "comparator"`. Live admission remains unverified. The host context guard in `src/evaluation.mjs` is a separate layer.

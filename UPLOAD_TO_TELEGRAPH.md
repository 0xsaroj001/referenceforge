# Telegraph upload handoff

Verified public deployment on 24 October 2026. These values describe the exact hosted bytes checked after deployment. Telegraph validation, evaluator admission and network registration are still pending.

## Miner

Open [the integration console](https://integrate.telegraphprotocol.com/register).

| Field | Exact value |
| --- | --- |
| YAML URL | [https://referenceforge.0xsaroj001.workers.dev/miner.yaml](https://referenceforge.0xsaroj001.workers.dev/miner.yaml) |
| YAML hash (bytes32, SHA-256) | `0x5a676c4d038e763647772510967de4b381b9e149ac1d93423ad68e8669b12752` |
| Requires API Key | Off |
| API Key | Leave blank |
| Candidate descriptor ID | `1900999000`; not reserved or registered |

Validate endpoints first and retain the validator result. Resolve any identity conflict before registration. Changing the descriptor ID or any other YAML byte requires a new deployment and hash.

## WASM

Download [referenceforge-comparator.wasm](https://referenceforge.0xsaroj001.workers.dev/referenceforge-comparator.wasm). The verified local copy is `dist/upload-verified/referenceforge-comparator.wasm`; the verified YAML copy is `dist/upload-verified/miner.yaml`. Both were downloaded and compared byte for byte with the prepared deployment assets.

| Field | Exact value |
| --- | --- |
| File | `referenceforge-comparator.wasm` |
| Size | 2,202 bytes |
| Ethereum Keccak-256 | `0xc6943a7d9d0af1d20a76dc88020bbd6a78b0fc687e681e58912080053c73e2a7` |
| SHA-256, for integrity | `c82ad16c8baa95a1da2247eb3db819f8a8fc333fd245bc368289e0dff70fc507` |
| Intended initial target | `FX_NOW`; admission not verified |

Confirm that the live upload flow accepts the comparator ABI before registration. The binary has 2,370 matching arithmetic-safe vectors against the pinned official reference and 30 deliberate overflow-domain refusals. These are compatibility exceptions, not full-domain equivalence. The host context guard is outside this binary.

## Deployment evidence and limits

The permanent origin is [referenceforge.0xsaroj001.workers.dev](https://referenceforge.0xsaroj001.workers.dev). Deployment version: `628f341a-afce-45e7-baa2-dffa67acdc45`.

The final public smoke check passed health, actual ECB FX, actual World Bank macro, scope refusal, all three public assets and private-path refusal. Artifact responses used `text/yaml` and `application/wasm` as appropriate. The public YAML contains 4,301 bytes.

Initial TLS requests failed during first provisioning, then succeeded. One early macro request returned 503 at the eight-second source deadline; later reads recovered. A small runtime tail sample measured 3 to 5 ms CPU for successful data requests. This is not sustained uptime, a latency target pass or a capacity guarantee.

Competitor research, private analysis and credentials were excluded from both the repository and the deployment. No paid upgrade, wallet transaction, registration or competition submission was performed.

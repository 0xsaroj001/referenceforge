# Legacy 0.5.4 release and V2 migration gate

The notes below describe the historical release. Use [deployment](DEPLOYMENT.md) and [live status](LIVE_STATUS_2026-11-03.md) for the current Provider.

The original 0.5.4 runtime is prepared locally, including the Kansas observation-history fix. Public runtime was last checked at 0.5.2. Neither version has been validated as a complete V2 Provider entry.

The earlier finalize-referenceforge / repair-from-4864 path targets the previous family-based registration state. It is **not the current V2 migration procedure**. Do not run its interactive mode to migrate. Its pre-upload guard remains useful historical protection, and attempt journals must be preserved.

Use [Anjoman V2](ANJOMAN_V2.md), [requirements](REQUIREMENTS_AND_EVIDENCE.md) and [deployment gates](DEPLOYMENT.md). A new final CLI must follow verified deployment/ABI, actual imported registration, concrete intents, validated descriptor and owner review. No new migration command is approved as ready in this documentation refresh.

Read-only historical status, if specifically needed, remains:
```powershell
node tools/finalize-referenceforge.mjs --status
```
It reports the old pinned contract; it is not authoritative evidence of the current V2 deployment.

No journal deletion, blind ID replacement, duplicate registration or agent signing.

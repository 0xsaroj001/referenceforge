# ReferenceForge product scope

Updated 29 October 2026 for Telegraph Season II and Anjoman V2.

## Mapping before implementation

An Intent is a standardized task; a prefix is its family. A Provider is our callable service. An Evaluator measures answer quality. Ranked routing chooses among eligible Providers. Anjoman is a user interface, while the hackathon has its own registration/submission flow.

Today ReferenceForge exposes original numeric, blockchain and US-weather APIs. A new local V2 compatibility layer maps five concrete subsets while retaining ten legacy service families. The next problem is platform acceptance and a useful mission-specific result reviewers can reproduce independently.

Who cares: H2 app builders needing accurate payment verification, pinned blockchain facts or published numeric observations, and reviewers who must distinguish a real result from a registration claim. We have no verified customer or partner commitment.

## Current scope

One Provider identity, original source-backed service, explicit limitations, independently repeatable correctness and failure behavior. Retain the ten existing capability families in code; advertise a concrete V2 Intent only after its own requirements pass.

Priority workflow candidates are payment/transaction evidence for the Stablecoin and Web3/DeFi missions. Those are proposed Provider contributions, not completed apps or verified enabled missions. A separate V2 Evaluator evaluation-material seed is now authorized and implemented locally. App building and automated transactions are not activated; legacy comparator work stays stopped.

## Ranked failures to eliminate

1. Registering against the wrong deployment or submitting a family prefix.
2. Returning plausible JSON that fails the Intent's actual scored field or unit.
3. Wrong chain, block, transaction status, currency orientation or time period.
4. Issued alerts presented as a numerical future storm-risk assessment.
5. Incorrect coverage claims: global weather, 240-hour forecasts, live FX or unsupported chains.
6. Missing source data converted to success, zero or all-clear.
7. Internal tests or direct HTTP traffic presented as ranked requests, independent adoption or a prize.

Success requires a validated concrete Miner–Intent pair, current deployment admission and repeatable mission-specific tests, followed by event-period network evidence and a complete official submission. Local test counts alone do not satisfy these gates.

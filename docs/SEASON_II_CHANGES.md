# Season II and V2: changes that affect ReferenceForge

Rechecked 29 October 2026 against the [official rules](https://hackathon.telegraphprotocol.com/rules), [tracks](https://hackathon.telegraphprotocol.com/tracks) and [current V2 changelog source](https://github.com/telegraphprotocol/telegraph-docs/blob/main/whats-new-v2.md). These are major changes from our earlier setup, not a claim that each was announced today. No new deadline extension was found in this check.

| Change | Consequence for us |
|---|---|
| Three tracks remain: Providers, Evaluators, Apps & Agents | We have two distinct original contributions; no App-track entry is active. Track numbering differs between pages, so use names. |
| Fifteen commercial missions direct apps; Providers/Evaluators compete on shared Intents | Useful mission impact and independently repeatable workflows matter more than adding labels. A suitable mission-critical test can qualify while downstream apps are still being built. |
| Delivery and excellence awards are separate | A qualifying entrant can receive one delivery and one excellence award per track; related wallets do not create independent entrants. |
| Main pool is7,000 USD; reserved December challenges are3,000 USD | December has separate rules, entry and deadlines. It is not extra time for the main submission. |
| Main deadline remains 1 December 2026, 23:59 UTC | This is 2 December 05:29 IST. Event-specific activity/transaction evidence must come from the event period beginning 1 November. |
| V2 moved from Base Sepolia to Ethereum Sepolia 11155111 | Registry, tokens and imported identity changed. Our current import is 4840. Old Base signing helpers are historical. |
| Canonical typed inputs and output fields, plus concrete sub-intents | Five explicit subsets have local adapters and unit/version tests. Broad legacy labels are not a new registration list. |
| Miner registration/update now involves a refundable MACHINA bond | Fresh inspection is necessary. Our specific four-to-five update delta was about 0.08802 MACHINA, not the full 1.76043 MACHINA quote. Free faucet funding is an owner action. |
| Old MiniLM/Q32.32 evaluator packages are refused | A new adapter would need the float-model format, runnable endpoint and documented 5 USD-equivalent MACHINA bond. We are currently building evaluation material separately. |
| Evaluator material can qualify independently of a live adapter | Our synthetic seed and baseline harness are valid local work, but still need reference quality/useful discrimination evidence. |

Current docs also describe new mintable test USDC on Ethereum Sepolia and EVM-only payments. Old Circle test-USDC funding does not fund a MACHINA bond. The documented emissions allocation now includes 50% for Evaluators, split within each Intent between adapter and evaluation material. These are protocol documentation statements, not verified personal earnings or prize eligibility.

Important interface discrepancies remain visible: the older validation documentation points to an endpoint that currently returns404; the current Anjoman registration-validation route requires authentication and returned 401 without a session. Some rendered/cache copies of deployment docs lag current source and live chain state. Use [deployment](DEPLOYMENT.md) and [live status](LIVE_STATUS_2026-11-03.md).

Our next gates are owner runtime upload, authenticated platform validation, free MACHINA funding/fresh approval/update review, then actual admission and event-period evidence. No network ranking, independent adoption, cash-prize eligibility or submission is inferred from local tests.

# Original blockchain service

Implementation reference for the existing Base/Base Sepolia service. Its integration descriptors require [V2 migration](ANJOMAN_V2.md); current source functionality does not imply current platform admission.

| Native route | Existing purpose |
|---|---|
| /verify-transfer | Native/ERC20 transfer verification using transaction, receipt and logs |
| /onchain-metric | Block-pinned metrics; explicit metric subroutes avoid ambiguous inputs |
| /onchain-metric/native-balance | Native balance with address and block context |
| /onchain-metric/erc20-balance | Explicit token/address balance |
| /onchain-metric/transaction | Explicit transaction metric |
| /onchain-metric/gas | Explicit gas metric |
| /onchain-metric/logs | Explicit event/log query |
| /tx | Transaction lookup and supported scalar fields |
| /wallet-balance | Current supported native/token balance |

The service uses bounded RPC requests, exact units, explicit chain/scope errors and source/block provenance. Supported networks remain Base and Base Sepolia; Ethereum mainnet, ENS and arbitrary chains are not inferred from an omitted chain.

Review source under src/onchain/ and its tests for exact parameter/field support. Alchemy remains a Worker secret and is not a wallet key. Existing unsupported-domain and RPC failures remain visible.

The V2 ONCHAIN_METRIC_VERIFY_GENERAL schema currently asks for address and block and scores balance_gwei. It does not expose a chain input in the inspected request. Clarify intended chain before advertising a mapping. A Base balance must not silently stand in for another chain's balance. CRYPTO_TRANSFER_VERIFY_GENERAL has null typed request/response schemas in the saved live snapshot; its free-query/native contract still needs validation.

Candidate mission work: payment evidence for Stablecoin and conditional settlement for Web3/DeFi, following the official mission examples. No app workflow or mission has been independently accepted for this Provider.

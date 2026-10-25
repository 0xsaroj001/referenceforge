# User-run WASM registration

This optional helper bypasses the website's RPC dependency by using the official Base Sepolia public RPC. It prepares exactly one `registerWasm` call for the pinned ReferenceForge comparator and `FX_NOW`. It never registers, updates or deregisters the miner.

On-chain registration, node indexing and evaluator admission remain separate. Direct registration cannot repair a node indexer. The comparator still has 30 documented overflow-domain refusals, and live admission is unverified.

## Read-only check

From the project folder, with Node.js 24 and locked dependencies installed, replace `YOUR_PUBLIC_WALLET` with the public address already connected in Telegraph:

```powershell
node tools/register-wasm.mjs --check --account YOUR_PUBLIC_WALLET
```

This requires no private key and sends no transaction. It checks chain ID 84532, contract code, hosted SHA-256 and Keccak-256, the on-chain canonical intent, contract simulation, nonce state, balance and gas estimates. The live user check on 25 October stopped for insufficient testnet gas before requesting a key.

If gas is insufficient, obtain free **Base Sepolia test ETH** from a testnet faucet. Do not buy or bridge mainnet funds for this helper. The latest fee estimate is printed by the command; it includes an L2 gas ceiling and a separate reserve for the network's L1 data fee. The reserve is not an exact L1-fee guarantee.

## Interactive user execution

```powershell
node tools/register-wasm.mjs --interactive --account YOUR_PUBLIC_WALLET
```

Run this yourself in an ordinary local terminal. It displays the target, artifact, account and gas ceiling. Type `REGISTER_FX_NOW` only if you want that specific WASM registration. The next prompt reads the key without echoing it. Paste a 32-byte hex private key, not a seed phrase. The derived address must match `--account`.

The key is used in local process memory and is not intentionally written to files, environment variables, command arguments, history or logs. Do not put it into a command or chat. This helper does not use the browser's gas sponsorship, so the wallet needs its own testnet ETH.

Before signing, the helper refreshes the preflight and rejects a changed nonce, expired review or increased cost above the displayed approved ceiling. It verifies the signed chain, destination, zero transfer value, calldata and fee fields before broadcasting.

A Windows PowerShell alternative uses `Read-Host -AsSecureString` and an anonymous stdin pipe:

```powershell
.\tools\register-wasm.ps1 -Account YOUR_PUBLIC_WALLET
```

## After a submission or interruption

```powershell
node tools/register-wasm.mjs --status --account YOUR_PUBLIC_WALLET
```

The helper durably records the deterministic transaction hash **before** its single broadcast attempt. A prior attempt, including an ambiguous RPC failure, blocks every later send from this helper. It does not automatically retry with a new nonce or replace the transaction. If a local lock remains after a crash, inspect the status and transaction before any manual cleanup.

A successful receipt must contain the registry's matching author, URL and hash event before a registration ID is reported. `--status` also queries the node's admission endpoint when an ID is known. A mined receipt alone is not proof of activation.

Public transaction records and local locks live under ignored `reports/wasm-terminal-registration/`. They contain no private key or signed transaction payload. Keep those records so future runs can avoid duplicates.

## Validation of the helper

Ten mocked tests cover network and artifact rejection, canonical intent/simulation failure, insufficient funds, pending nonces, wrong signer, changed signed destination, journal-before-broadcast ordering, ambiguous failure and duplicate-run prevention, receipt matching, hidden input and terminal restoration. All 37 project Node tests passed. PowerShell syntax parsing passed. Agent-run live checks were read-only; the agent did not read a user key, sign or broadcast.

Implementation references: [ethers v6 documentation](https://docs.ethers.org/v6/single-page/) and the contract ABI inspected from the official integration frontend. The signing dependency is locked to ethers 6.17.0.

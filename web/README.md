# Match quadratic funding — web

One static page for the Sepolia deployment of **QuadraticFunding** and the **Match (MTCH)** launch
token. It creates rounds, registers projects (round creator only), funds matching pools, contributes
to projects, finalizes, claims and reclaims, and shows each project's contributions and live match
estimate. Every paying action has an explicit **Approve MTCH** step first.

Stack: Vite 6, React 19, TypeScript 5, viem 2. No backend, no indexer, no server rewrites: the export
in `../dist/` works from any static host, a gateway subpath or an ENS name (Vite `base: "./"`).

## Configuration: one source of truth

| What | Where | Notes |
| --- | --- | --- |
| Deployment handoff (launch id, chain id, source commit, attestation, contract addresses, ABI hashes) | `deployment/handoff.json` | Byte copy of the workflow's `.imd/reads/deployment.json` |
| Vetted network block (name, public RPC URLs, explorer, native currency, faucets, Uniswap v4 addresses) and `walletAddChain` | `deployment/network.json` | Byte copy of the workflow's `.imd/reads/network.json` |
| Implementation-derived ABIs | `../docs/abi/<Contract>.json` | Produced with `forge inspect` at the pinned source commit |
| Runtime deployment configuration | `../dist/imd-deployment.json` | **Generated** by `plugins/imd-deployment.ts` from the three inputs above; the app fetches it at startup and then fetches each `abiPath` |
| Launch pool parameters, deployment block, log window, refresh interval, optional WalletConnect id | `src/config.ts` | Values the manifest schema does not carry; they come from the handoff/launch manifest |

The app never carries a contract address, chain id, RPC URL or ABI in source. `src/config.ts` only
loads and validates `./imd-deployment.json` and derives helpers from it (explorer links, the exact
`wallet_addEthereumChain` parameters, which equal the handoff's `walletAddChain` block; see
`src/test/config.test.ts`). The Uniswap quoter address for the read-only ETH→MTCH rate also comes
from the manifest's `network.uniswapV4` block; there is no in-page swap (the approved page tells
visitors to swap Sepolia ETH in the launch pool with their own wallet or the Uniswap interface).

No private credentials exist anywhere: reads go to the network block's public RPC URLs with
fallback, signing stays in the visitor's browser wallet (EIP-6963 discovery, `window.ethereum`
fallback). `WALLETCONNECT_PROJECT_ID` in `src/config.ts` is optional and unset; browser wallets work
without it.

### Build plugin

`plugins/imd-deployment.ts`:

1. reads the handoff, the network file and `docs/abi/*.json`;
2. verifies every ABI's canonical keccak (sorted keys, no whitespace) against the handoff's
   `abiHash` and **fails the build on mismatch**;
3. emits `abi/<Contract>.json` (raw ABI array) into the export;
4. after the bundle is written, walks `dist/`, hashes every file except `imd-deployment.json`
   (lowercase SHA-256) and writes the manifest with `network` copied unchanged;
5. enforces the limits: at most 128 assets, 8 MiB per file, 24 MiB total.

In `vite dev` the same plugin serves `/imd-deployment.json` and `/abi/*.json` from memory.

## Install, develop, build

```sh
cd web
npm ci                 # or npm install; Node 20+ (validated with Node 24)
npm run dev            # http://localhost:5173, live reads against Sepolia public RPCs
npm run typecheck      # tsc --noEmit
npm run test           # vitest: config binding + interaction tests with a mocked chain and wallet
npm run build          # vite build → ../dist (cleans it first) + imd-deployment.json
npm run preview        # serves ../dist locally
npm run check          # typecheck + test + build
```

Rebuild after **any** source change and commit `dist/` together with the source and
`package-lock.json`. The manifest's asset hashes are regenerated on every build; never edit it by
hand. To preview the export the way a gateway serves it (under a subpath), any static server works,
for example `python3 -m http.server --directory ../dist`.

## Using the page

1. **Connect wallet.** If the wallet is on another chain, one **Switch to Sepolia** control requests
   `wallet_switchEthereumChain`; on error 4902 (or an equivalent "unknown chain" report) it requests
   `wallet_addEthereumChain` with the manifest's network block, then switches again.
2. **Get MTCH.** The panel shows the connected wallet's MTCH balance and allowance for
   QuadraticFunding, a read-only rate from the launch pool (quoter `quoteExactInputSingle` via
   `simulateContract`, never a transaction) and a faucet link.
3. **Approve, then pay.** Funding and contributing are two visible steps: `approve(QuadraticFunding,
   amount)` on MTCH, then `fund` / `contribute`. Step 2 is disabled until the allowance covers the
   amount. Every transaction is simulated first so the contract's custom error (for example
   `OutsideContributionWindow`, `OnlyCreator`) is shown in plain words before the wallet opens.
4. **Rounds** list from `roundCount()` / `round(id)`; projects from `project(id, pid)` with
   `estimateMatch` and the connected wallet's `contributionOf` / `fundingOf`. The **Activity**
   disclosure loads the round's events (`RoundCreated`, `Funded`, `Registered`, `Contributed`,
   `Finalized`, `Claimed`, `Reclaimed`) with bounded `eth_getLogs` windows from the deployment block.
5. **Finalize** after the end (anyone), **Claim** (payout address, once), **Reclaim** (funders, only
   when a finalized round had no contributions). Controls appear only in the states where the
   contract accepts them, and all transaction controls stay disabled while disconnected or on the
   wrong chain.

Live reads refresh every 20 s while the tab is visible and immediately after each confirmed
transaction.

## Validation

See [`../docs/FRONTEND-VALIDATION.md`](../docs/FRONTEND-VALIDATION.md) for the recorded build,
typecheck, unit/interaction tests, headless-browser checks of the export (mocked chain and live
Sepolia reads), the Better Interface review and the untested live-chain behaviour. Design tokens and
components are documented in [`../docs/DESIGN.md`](../docs/DESIGN.md).

## Layout of this directory

```
web/
  deployment/handoff.json     copied workflow handoff (inputs to the build plugin)
  deployment/network.json     copied vetted network block + walletAddChain
  plugins/imd-deployment.ts   ABI verification + runtime manifest + asset inventory
  src/config.ts               manifest loader + the few non-manifest constants
  src/lib/                    chain client, wallet discovery/switching, contract reads, quoter, formatting
  src/hooks/                  deployment, wallet session, live snapshot, transaction runner
  src/components/             page sections and forms
  src/styles.css              design tokens and component styles
  src/test/                   fake chain + fake wallet, config and interaction tests
```

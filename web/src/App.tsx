import { useCallback } from "react";
import { ContractsFooter } from "./components/ContractsFooter";
import { CreateRoundForm } from "./components/CreateRoundForm";
import { RoundCard } from "./components/RoundCard";
import { TokenPanel } from "./components/TokenPanel";
import { WalletBar } from "./components/WalletBar";
import { useDeployment } from "./hooks/useDeployment";
import { useSnapshot } from "./hooks/useSnapshot";
import { useTransactions } from "./hooks/useTransactions";
import { useWallet } from "./hooks/useWallet";

export default function App() {
  const dep = useDeployment();
  const ready = dep.status === "ready" ? dep : undefined;
  const network = ready?.deployment.manifest.network;
  const session = useWallet(ready?.chain, network);
  const reads = useSnapshot(ready?.client, ready?.deployment, session.account);
  const refresh = useCallback(() => reads.refresh(), [reads.refresh]);
  const tx = useTransactions(ready?.client, session.walletClient, session.account, refresh);
  const snapshot = reads.snapshot;
  const readyText = !session.account
    ? "Connect a wallet to create a round."
    : !session.onChain
      ? `Switch to ${network?.name ?? "the configured network"} to create a round.`
      : undefined;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="brand">
          <h1>Match quadratic funding</h1>
          <p className="tagline">Curated matching rounds paid in MTCH on {network?.name ?? "Sepolia"}.</p>
        </div>
        <WalletBar session={session} chain={ready?.chain} network={network} />
      </header>

      <main id="main" className="page">
        {dep.status === "loading" && (
          <p className="notice" role="status">
            Loading deployment configuration…
          </p>
        )}
        {dep.status === "error" && (
          <p className="notice notice-error" role="alert">
            Unable to load the deployment configuration: {dep.message}. Reload the page; if it keeps failing, the
            export is incomplete.
          </p>
        )}

        {ready && (
          <>
            {!network && (
              <p className="notice notice-error" role="alert">
                No vetted network block was supplied, so RPC reads are unavailable and transactions stay disabled.
              </p>
            )}
            <section className="section" aria-labelledby="wallet-h">
              <h2 id="wallet-h" className="section-title">
                Wallet and MTCH
              </h2>
              <div className="card">
                <TokenPanel
                  deployment={ready.deployment}
                  network={network}
                  client={ready.client}
                  token={snapshot?.token}
                  tokenAddress={snapshot?.tokenAddress}
                  account={session.account}
                  onChain={session.onChain}
                  tx={tx}
                />
              </div>
            </section>

            <section className="section" aria-labelledby="rounds-h">
              <div className="section-head">
                <h2 id="rounds-h" className="section-title">
                  Rounds
                </h2>
                <div className="section-tools">
                  <span className="muted" role="status">
                    {reads.loading
                      ? "Refreshing…"
                      : snapshot
                        ? `Block ${snapshot.blockNumber.toString()}`
                        : ""}
                  </span>
                  <button type="button" className="button button-ghost button-small" onClick={() => void refresh()} disabled={reads.loading}>
                    Refresh
                  </button>
                </div>
              </div>
              {reads.error && (
                <p className="notice notice-error" role="alert">
                  {reads.error} Reads retry automatically; use Refresh to retry now.
                </p>
              )}
              {!snapshot && !reads.error && (
                <p className="notice" role="status">
                  Reading rounds from the contract…
                </p>
              )}
              {snapshot && snapshot.rounds.length === 0 && (
                <div className="card empty-state">
                  <p className="empty-title">No rounds yet</p>
                  <p className="muted">
                    A round collects a matching pool and contributions for curated projects. Create the first one
                    below.
                  </p>
                  <a className="button button-secondary" href="#create-h">
                    Go to Create a round
                  </a>
                </div>
              )}
              {snapshot && snapshot.token && (
                <div className="round-list">
                  {[...snapshot.rounds].reverse().map((round) => (
                    <RoundCard
                      key={round.id.toString()}
                      round={round}
                      deployment={ready.deployment}
                      network={network}
                      client={ready.client}
                      token={snapshot.token!}
                      account={session.account}
                      onChain={session.onChain}
                      chainNow={snapshot.blockTimestamp}
                      latestBlock={snapshot.blockNumber}
                      minContribution={snapshot.minContribution}
                      tx={tx}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="section" aria-labelledby="create-h">
              <h2 id="create-h" className="section-title">
                Create a round
              </h2>
              <div className="card">
                <CreateRoundForm
                  deployment={ready.deployment}
                  network={network}
                  tx={tx}
                  ready={session.onChain}
                  readyText={readyText}
                  chainNow={snapshot?.blockTimestamp}
                />
              </div>
            </section>

            <ContractsFooter deployment={ready.deployment} />
          </>
        )}
      </main>
    </>
  );
}

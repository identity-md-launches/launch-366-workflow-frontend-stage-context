import type { Chain } from "viem";
import { explorerAddress, type NetworkBlock } from "../config";
import type { WalletSession } from "../hooks/useWallet";
import { shortAddress } from "../lib/format";

interface Props {
  session: WalletSession;
  chain?: Chain;
  network?: NetworkBlock;
}

/** Connect / connected / wrong-network states with a single "Switch to <name>" control. */
export function WalletBar({ session, chain, network }: Props) {
  const chainName = network?.name ?? chain?.name ?? "the configured network";

  if (!session.account) {
    return (
      <div className="wallet-bar">
        {session.wallets.length === 0 ? (
          <p className="wallet-note">
            {session.discovered ? (
              <>
                No browser wallet found. Install a wallet extension such as MetaMask or Rabby, then reload this page.
                Reads below still work without one.
              </>
            ) : (
              "Looking for browser wallets…"
            )}
          </p>
        ) : (
          <div className="wallet-options">
            {session.wallets.map((w) => (
              <button
                key={w.id}
                type="button"
                className="button button-primary"
                disabled={session.connecting || !chain}
                onClick={() => void session.connect(w)}
              >
                {session.wallets.length === 1 ? "Connect wallet" : `Connect ${w.name}`}
              </button>
            ))}
          </div>
        )}
        {session.error && (
          <p className="inline-error" role="alert">
            {session.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-bar">
      <div className="wallet-identity">
        <span className={["chain-dot", session.onChain ? "is-ok" : "is-bad"].join(" ")} aria-hidden="true" />
        <span className="wallet-address">
          <span className="visually-hidden">Connected wallet </span>
          <a href={explorerAddress(network, session.account) ?? "#"} target="_blank" rel="noreferrer" title={session.account}>
            {shortAddress(session.account)}
          </a>
        </span>
        <span className="wallet-chain">
          {session.onChain ? chainName : `Wrong network (chain ${session.walletChainId ?? "?"})`}
        </span>
      </div>
      <div className="wallet-actions">
        {!session.onChain && (
          <button
            type="button"
            className="button button-primary"
            disabled={session.switching || !network}
            onClick={() => void session.switchChain()}
          >
            {session.switching ? "Switching…" : `Switch to ${chainName}`}
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={session.disconnect}>
          Disconnect
        </button>
      </div>
      {session.error && (
        <p className="inline-error" role="alert">
          {session.error}
        </p>
      )}
    </div>
  );
}

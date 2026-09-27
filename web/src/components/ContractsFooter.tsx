import { explorerAddress, type Deployment } from "../config";

/** Every configured contract with its explorer link, plus the attested deployment identifiers. */
export function ContractsFooter({ deployment }: { deployment: Deployment }) {
  const m = deployment.manifest;
  const network = m.network;
  return (
    <footer className="site-footer">
      <h2 className="section-title">Contracts and configuration</h2>
      <dl className="contracts">
        {m.contracts.map((c) => (
          <div className="stat" key={c.name}>
            <dt>{c.name}</dt>
            <dd>
              <a href={explorerAddress(network, c.address) ?? "#"} target="_blank" rel="noreferrer" className="mono break">
                {c.address}
              </a>
            </dd>
          </div>
        ))}
        {network && (
          <>
            <div className="stat">
              <dt>Network</dt>
              <dd>
                {network.name} (chain {network.chainId}
                {network.testnet ? ", testnet" : ""})
              </dd>
            </div>
            <div className="stat">
              <dt>Uniswap v4 quoter</dt>
              <dd>
                <a href={explorerAddress(network, network.uniswapV4.quoter) ?? "#"} target="_blank" rel="noreferrer" className="mono break">
                  {network.uniswapV4.quoter}
                </a>
              </dd>
            </div>
          </>
        )}
        <div className="stat">
          <dt>Source commit</dt>
          <dd className="mono break">{m.sourceCommit}</dd>
        </div>
        <div className="stat">
          <dt>Launch</dt>
          <dd className="mono break">{m.launchId}</dd>
        </div>
      </dl>
      <p className="fine-print">
        Quadratic funding is Sybil-able: splitting contributions across wallets raises the match, and there is no
        identity check on Sepolia. The round creator curates the project list; funding a round trusts that curation.
        Reads use the network's public RPC endpoints; signing stays in your wallet.
      </p>
    </footer>
  );
}

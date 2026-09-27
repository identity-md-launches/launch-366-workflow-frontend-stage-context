import { useEffect, useState, type FormEvent } from "react";
import type { Address, PublicClient } from "viem";
import { parseEther } from "viem";
import { explorerAddress, type Deployment, type NetworkBlock } from "../config";
import type { TxRunner } from "../hooks/useTransactions";
import type { TokenState } from "../lib/contracts";
import { describeError } from "../lib/contracts";
import { formatAmount, parseAmount, shortAddress } from "../lib/format";
import { quoteEthToToken } from "../lib/uniswap";
import { describedIds, Field, TextInput } from "./Field";
import { TxStatus } from "./TxStatus";

interface Props {
  deployment: Deployment;
  network?: NetworkBlock;
  client: PublicClient;
  token?: TokenState;
  tokenAddress?: Address;
  account?: Address;
  onChain: boolean;
  tx: TxRunner;
}

/** Wallet MTCH balance and allowance, a standalone approve step, and how to obtain MTCH. */
export function TokenPanel({ deployment, network, client, token, tokenAddress, account, onChain, tx }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [quote, setQuote] = useState<{ amountOut: bigint } | { error: string } | undefined>();
  const symbol = token?.symbol ?? "MTCH";
  const decimals = token?.decimals ?? 18;
  const key = "token-approve";
  const address = tokenAddress ?? deployment.token.address;

  // Read-only exchange rate from the launch pool through the vetted quoter. Never a transaction.
  useEffect(() => {
    if (!network || !tokenAddress) return;
    let cancelled = false;
    quoteEthToToken(client, network, tokenAddress, parseEther("0.01"))
      .then((amountOut) => !cancelled && setQuote({ amountOut }))
      .catch((e: unknown) => !cancelled && setQuote({ error: describeError(e) }));
    return () => {
      cancelled = true;
    };
  }, [client, network, tokenAddress]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseAmount(text, decimals);
    if (amount === undefined) {
      setError(`Enter an amount in ${symbol}, for example 100.`);
      return;
    }
    setError(undefined);
    const ok = await tx.run({
      key,
      label: `Approve ${formatAmount(amount, decimals)} ${symbol}`,
      address,
      abi: deployment.abis[deployment.token.name],
      functionName: "approve",
      args: [deployment.funding.address, amount],
    });
    if (ok) setText("");
  };

  return (
    <div className="panel-grid">
      <dl className="stats">
        <div className="stat">
          <dt>{symbol} balance</dt>
          <dd>{account && token ? `${formatAmount(token.balance, decimals)} ${symbol}` : "—"}</dd>
        </div>
        <div className="stat">
          <dt>Approved for QuadraticFunding</dt>
          <dd>{account && token ? `${formatAmount(token.allowance, decimals)} ${symbol}` : "—"}</dd>
        </div>
        <div className="stat">
          <dt>Token contract</dt>
          <dd>
            <a href={explorerAddress(network, address) ?? "#"} target="_blank" rel="noreferrer" title={address}>
              {shortAddress(address)}
            </a>
          </dd>
        </div>
      </dl>

      <form className="action-form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="approve-title">
        <h3 id="approve-title" className="action-title">
          Approve {symbol}
        </h3>
        <p className="action-description">
          Every payment into a round (funding the pool or contributing to a project) first needs an approval for
          the QuadraticFunding contract. Each paying form below also offers this step for its exact amount.
        </p>
        <Field
          id="approve-amount"
          label={`Amount to approve (${symbol})`}
          hint="Approve the total you plan to pay. The allowance shrinks as payments go through."
          error={error}
        >
          <TextInput
            id="approve-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="100"
            value={text}
            invalid={!!error}
            describedBy={describedIds("approve-amount", true, !!error)}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(undefined);
            }}
            disabled={!onChain}
          />
        </Field>
        <div className="steps">
          <button type="submit" className="button button-secondary" disabled={!onChain || tx.busy(key)}>
            {tx.busy(key) ? "Approving…" : `Approve ${symbol}`}
          </button>
        </div>
        {!onChain && (
          <p className="action-note">
            {account ? `Switch to ${network?.name ?? "the configured network"} to approve.` : "Connect a wallet to approve."}
          </p>
        )}
        <TxStatus record={tx.records[key]} network={network} onDismiss={tx.dismiss} />
      </form>

      <div className="how-to">
        <h3 className="action-title">Get {symbol}</h3>
        <p className="action-description">
          {symbol} comes from swapping Sepolia ETH in the launch pool on Uniswap v4 (pool manager{" "}
          {network ? (
            <a
              href={explorerAddress(network, network.uniswapV4.poolManager) ?? "#"}
              target="_blank"
              rel="noreferrer"
              title={network.uniswapV4.poolManager}
            >
              {shortAddress(network.uniswapV4.poolManager)}
            </a>
          ) : (
            "unknown"
          )}
          ). This page does not swap; use your wallet or the Uniswap interface, then return here.
        </p>
        <p className="rate" aria-live="polite">
          {quote === undefined && network && "Reading the pool rate…"}
          {quote && "amountOut" in quote && (
            <>
              Current rate: 0.01 ETH ≈ {formatAmount(quote.amountOut, decimals)} {symbol}{" "}
              <span className="muted">(quoter read, before slippage)</span>
            </>
          )}
          {quote && "error" in quote && <span className="muted">Pool rate unavailable right now.</span>}
          {!network && <span className="muted">No vetted network block; rate unavailable.</span>}
        </p>
        {network && network.faucets.length > 0 && (
          <p className="action-description">
            Need Sepolia ETH? Use the{" "}
            <a href={network.faucets[0]} target="_blank" rel="noreferrer">
              Sepolia faucet
            </a>
            .
          </p>
        )}
      </div>
    </div>
  );
}

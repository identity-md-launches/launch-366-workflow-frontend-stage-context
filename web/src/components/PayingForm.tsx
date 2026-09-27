import { useState, type FormEvent, type ReactNode } from "react";
import type { Address } from "viem";
import type { Deployment, NetworkBlock } from "../config";
import type { TxRunner } from "../hooks/useTransactions";
import type { TokenState } from "../lib/contracts";
import { formatAmount, parseAmount } from "../lib/format";
import { describedIds, Field, TextInput } from "./Field";
import { TxStatus } from "./TxStatus";

interface Props {
  /** Unique id prefix for inputs and status keys. */
  id: string;
  title: string;
  description: ReactNode;
  /** Label of the paying action, e.g. "Fund pool" or "Contribute". */
  actionLabel: string;
  /** Minimum amount in base units (inclusive); 1 for funding, 1 MTCH for contributions. */
  minAmount: bigint;
  minText: string;
  deployment: Deployment;
  network?: NetworkBlock;
  token: TokenState;
  account?: Address;
  ready: boolean;
  readyText?: string;
  tx: TxRunner;
  /** Extra controls rendered before the amount (e.g. project selector). */
  children?: ReactNode;
  /** Validate extra controls; return an error string to block submission. */
  validateExtra?: () => string | undefined;
  /** Build contract arguments for the paying call given the amount. */
  buildArgs: (amount: bigint) => unknown[];
  functionName: "fund" | "contribute";
}

/**
 * Two explicit steps for every paying action: approve MTCH for QuadraticFunding, then pay.
 * The pay button stays disabled until the allowance covers the entered amount.
 */
export function PayingForm(props: Props) {
  const { id, token, tx, deployment, network } = props;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const amount = parseAmount(text, token.decimals);
  const approveKey = `${id}-approve`;
  const payKey = `${id}-pay`;
  const symbol = token.symbol;

  const needsApproval = amount !== undefined && amount > 0n && token.allowance < amount;
  const covered = amount !== undefined && amount > 0n && token.allowance >= amount;

  const validate = (): bigint | undefined => {
    const extra = props.validateExtra?.();
    if (extra) {
      setError(extra);
      return undefined;
    }
    if (amount === undefined) {
      setError(`Enter an amount in ${symbol}, for example 10 or 2.5.`);
      return undefined;
    }
    if (amount < props.minAmount) {
      setError(props.minText);
      return undefined;
    }
    if (amount > token.balance) {
      setError(`This wallet holds ${formatAmount(token.balance, token.decimals)} ${symbol}. Enter that amount or less.`);
      return undefined;
    }
    setError(undefined);
    return amount;
  };

  const approve = async (e: FormEvent) => {
    e.preventDefault();
    const value = validate();
    if (value === undefined) return;
    await tx.run({
      key: approveKey,
      label: `Approve ${formatAmount(value, token.decimals)} ${symbol}`,
      address: deployment.token.address,
      abi: deployment.abis[deployment.token.name],
      functionName: "approve",
      args: [deployment.funding.address, value],
    });
  };

  const pay = async (e: FormEvent) => {
    e.preventDefault();
    const value = validate();
    if (value === undefined) return;
    if (token.allowance < value) {
      setError(`Approve at least ${formatAmount(value, token.decimals)} ${symbol} first (step 1).`);
      return;
    }
    const ok = await tx.run({
      key: payKey,
      label: `${props.actionLabel} ${formatAmount(value, token.decimals)} ${symbol}`,
      address: deployment.funding.address,
      abi: deployment.abis[deployment.funding.name],
      functionName: props.functionName,
      args: props.buildArgs(value),
    });
    if (ok) setText("");
  };

  const disabledAll = !props.ready;
  const busy = tx.busy(approveKey) || tx.busy(payKey);

  return (
    <form className="action-form" onSubmit={pay} noValidate aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="action-title">
        {props.title}
      </h4>
      <p className="action-description">{props.description}</p>
      {props.children}
      <Field
        id={`${id}-amount`}
        label={`Amount (${symbol})`}
        hint={`${props.minText} Balance ${formatAmount(token.balance, token.decimals)} ${symbol}, approved ${formatAmount(token.allowance, token.decimals)} ${symbol}.`}
        error={error}
      >
        <TextInput
          id={`${id}-amount`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="10"
          value={text}
          invalid={!!error}
          describedBy={describedIds(`${id}-amount`, true, !!error)}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(undefined);
          }}
          disabled={disabledAll}
        />
      </Field>
      <div className="steps" role="group" aria-label="Approve then pay">
        <button
          type="button"
          className={["button", needsApproval ? "button-primary" : "button-secondary"].join(" ")}
          disabled={disabledAll || busy || covered}
          onClick={(e) => void approve(e)}
        >
          {tx.busy(approveKey) ? "Approving…" : `Step 1: Approve ${symbol}`}
        </button>
        <button
          type="submit"
          className={["button", covered ? "button-primary" : "button-secondary"].join(" ")}
          disabled={disabledAll || busy || needsApproval}
        >
          {tx.busy(payKey) ? "Sending…" : `Step 2: ${props.actionLabel}`}
        </button>
      </div>
      {!props.ready && props.readyText && <p className="action-note">{props.readyText}</p>}
      {props.ready && needsApproval && amount !== undefined && (
        <p className="action-note">
          Approval covers {formatAmount(token.allowance, token.decimals)} {symbol}; approve{" "}
          {formatAmount(amount, token.decimals)} {symbol} to unlock step 2.
        </p>
      )}
      <TxStatus record={tx.records[approveKey]} network={network} onDismiss={tx.dismiss} />
      <TxStatus record={tx.records[payKey]} network={network} onDismiss={tx.dismiss} />
    </form>
  );
}

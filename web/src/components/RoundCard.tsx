import { useState, type FormEvent } from "react";
import { isAddress, type Address, type PublicClient } from "viem";
import { explorerAddress, explorerTx, type Deployment, type NetworkBlock } from "../config";
import type { TxRunner } from "../hooks/useTransactions";
import { describeError, readRoundActivity, type ActivityItem, type RoundView, type TokenState } from "../lib/contracts";
import { formatAmount, formatDuration, formatTimestamp, shortAddress } from "../lib/format";
import { describedIds, Field, Select, TextInput } from "./Field";
import { PayingForm } from "./PayingForm";
import { TxStatus } from "./TxStatus";

interface Props {
  round: RoundView;
  deployment: Deployment;
  network?: NetworkBlock;
  client: PublicClient;
  token: TokenState;
  account?: Address;
  onChain: boolean;
  chainNow: bigint;
  latestBlock: bigint;
  minContribution: bigint;
  tx: TxRunner;
}

type Phase = "upcoming" | "open" | "ended" | "finalized";

function phaseOf(r: RoundView, now: bigint): Phase {
  if (r.finalized) return "finalized";
  if (now < r.start) return "upcoming";
  if (now < r.end) return "open";
  return "ended";
}

const PHASE_LABEL: Record<Phase, string> = {
  upcoming: "Upcoming",
  open: "Open for contributions",
  ended: "Ended, awaiting finalization",
  finalized: "Finalized",
};

export function RoundCard(props: Props) {
  const { round: r, deployment, network, token, account, onChain, chainNow, tx } = props;
  const phase = phaseOf(r, chainNow);
  const isCreator = !!account && account.toLowerCase() === r.creator.toLowerCase();
  const decimals = token.decimals;
  const symbol = token.symbol;
  const fundingAbi = deployment.abis[deployment.funding.name];
  const id = `round-${r.id}`;
  const readyText = !account
    ? "Connect a wallet to take part."
    : !onChain
      ? `Switch to ${network?.name ?? "the configured network"} to take part.`
      : undefined;

  const [projectChoice, setProjectChoice] = useState("0");
  const [payout, setPayout] = useState("");
  const [payoutError, setPayoutError] = useState<string | undefined>();
  const [activity, setActivity] = useState<{ items?: ActivityItem[]; error?: string; loading: boolean }>({ loading: false });

  const loadActivity = async () => {
    setActivity({ loading: true });
    try {
      const items = await readRoundActivity(props.client, deployment, r.id, props.latestBlock);
      setActivity({ items, loading: false });
    } catch (e) {
      setActivity({ error: describeError(e), loading: false });
    }
  };

  const register = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = payout.trim();
    if (!isAddress(trimmed)) {
      setPayoutError("Enter a full 0x address (42 characters) that will receive this project's payout.");
      return;
    }
    if (/^0x0{40}$/.test(trimmed)) {
      setPayoutError("Enter a payout address other than the zero address.");
      return;
    }
    setPayoutError(undefined);
    const ok = await tx.run({
      key: `${id}-register`,
      label: `Register project paying ${shortAddress(trimmed)}`,
      address: deployment.funding.address,
      abi: fundingAbi,
      functionName: "register",
      args: [r.id, trimmed],
    });
    if (ok) setPayout("");
  };

  const simple = (key: string, label: string, functionName: string, args: unknown[]) =>
    tx.run({ key, label, address: deployment.funding.address, abi: fundingAbi, functionName, args });

  const canReclaim = r.finalized && r.refundable && r.myFunding > 0n;

  return (
    <article className="card round" aria-labelledby={`${id}-h`}>
      <header className="round-header">
        <div>
          <h3 id={`${id}-h`} className="round-title">
            Round {r.id.toString()}
          </h3>
          <p className="round-meta">
            Created by{" "}
            <a href={explorerAddress(network, r.creator) ?? "#"} target="_blank" rel="noreferrer" title={r.creator}>
              {shortAddress(r.creator)}
            </a>
            {isCreator && " (you)"}
          </p>
        </div>
        <span className={["badge", `badge-${phase}`].join(" ")}>{PHASE_LABEL[phase]}</span>
      </header>

      <dl className="stats stats-compact">
        <div className="stat">
          <dt>Schedule</dt>
          <dd>
            <time dateTime={new Date(Number(r.start) * 1000).toISOString()}>{formatTimestamp(r.start)}</time>
            {" – "}
            <time dateTime={new Date(Number(r.end) * 1000).toISOString()}>{formatTimestamp(r.end)}</time>
            <span className="muted">
              {phase === "upcoming" && ` (opens in ${formatDuration(r.start - chainNow)})`}
              {phase === "open" && ` (closes in ${formatDuration(r.end - chainNow)})`}
            </span>
          </dd>
        </div>
        <div className="stat">
          <dt>Matching pool</dt>
          <dd className="num">
            {formatAmount(r.pool, decimals)} {symbol}
          </dd>
        </div>
        <div className="stat">
          <dt>Contributions</dt>
          <dd className="num">
            {formatAmount(r.totalContributions, decimals)} {symbol}
          </dd>
        </div>
        <div className="stat">
          <dt>Projects</dt>
          <dd className="num">{r.projectCount.toString()} of 50</dd>
        </div>
      </dl>

      {r.projects.length === 0 ? (
        <p className="empty">
          No projects registered yet.{" "}
          {isCreator ? "Register the first project below." : "The round creator registers projects."}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="projects">
            <caption className="visually-hidden">Projects in round {r.id.toString()}</caption>
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Payout address</th>
                <th scope="col" className="num">
                  Contributions
                </th>
                <th scope="col" className="num">
                  {r.finalized ? "Match" : "Estimated match"}
                </th>
                {account && (
                  <th scope="col" className="num">
                    Yours
                  </th>
                )}
                {r.finalized && !r.refundable && <th scope="col">Payout</th>}
              </tr>
            </thead>
            <tbody>
              {r.projects.map((p) => {
                const isPayout = !!account && account.toLowerCase() === p.payout.toLowerCase();
                const claimKey = `${id}-claim-${p.id}`;
                return (
                  <tr key={p.id.toString()}>
                    <th scope="row">#{p.id.toString()}</th>
                    <td>
                      <a href={explorerAddress(network, p.payout) ?? "#"} target="_blank" rel="noreferrer" title={p.payout}>
                        {shortAddress(p.payout)}
                      </a>
                      {isPayout && <span className="muted"> (you)</span>}
                    </td>
                    <td className="num">{formatAmount(p.contributions, decimals)}</td>
                    <td className="num">{formatAmount(p.estimatedMatch, decimals)}</td>
                    {account && <td className="num">{formatAmount(p.myContribution, decimals)}</td>}
                    {r.finalized && !r.refundable && (
                      <td>
                        {p.claimed ? (
                          <span className="muted">Claimed</span>
                        ) : isPayout ? (
                          <>
                            <button
                              type="button"
                              className="button button-primary button-small"
                              disabled={!onChain || tx.busy(claimKey)}
                              onClick={() =>
                                void simple(
                                  claimKey,
                                  `Claim ${formatAmount(p.contributions + p.matchAmount, decimals)} ${symbol} for project #${p.id}`,
                                  "claim",
                                  [r.id, p.id],
                                )
                              }
                            >
                              {tx.busy(claimKey) ? "Claiming…" : `Claim ${formatAmount(p.contributions + p.matchAmount, decimals)} ${symbol}`}
                            </button>
                            <TxStatus record={tx.records[claimKey]} network={network} onDismiss={tx.dismiss} />
                          </>
                        ) : (
                          <span className="muted">Unclaimed</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {r.finalized && r.refundable && (
        <p className="notice">
          This round finalized with no contributions, so the matching pool is refundable: each funder reclaims
          their own deposit.
        </p>
      )}

      <div className="round-actions">
        {phase === "open" && r.projects.length > 0 && (
          <PayingForm
            id={`${id}-contribute`}
            title="Contribute to a project"
            description={`Your contributions to one project add up; the match uses the square root of your total. Each payment is at least 1 ${symbol}.`}
            actionLabel="Contribute"
            functionName="contribute"
            minAmount={props.minContribution}
            minText={`At least ${formatAmount(props.minContribution, decimals)} ${symbol} per payment.`}
            deployment={deployment}
            network={network}
            token={token}
            account={account}
            ready={onChain}
            readyText={readyText}
            tx={tx}
            buildArgs={(amount) => [r.id, BigInt(projectChoice), amount]}
          >
            <Field id={`${id}-project`} label="Project">
              <Select id={`${id}-project`} value={projectChoice} onChange={(e) => setProjectChoice(e.target.value)} disabled={!onChain}>
                {r.projects.map((p) => (
                  <option key={p.id.toString()} value={p.id.toString()}>
                    #{p.id.toString()} · {shortAddress(p.payout)}
                  </option>
                ))}
              </Select>
            </Field>
          </PayingForm>
        )}

        {(phase === "upcoming" || phase === "open") && (
          <PayingForm
            id={`${id}-fund`}
            title="Fund the matching pool"
            description="Matching funds are split among projects by the quadratic formula when the round is finalized. Funding cannot be withdrawn once any contribution exists."
            actionLabel="Fund pool"
            functionName="fund"
            minAmount={1n}
            minText={`Any positive amount of ${symbol}.`}
            deployment={deployment}
            network={network}
            token={token}
            account={account}
            ready={onChain}
            readyText={readyText}
            tx={tx}
            buildArgs={(amount) => [r.id, amount]}
          />
        )}

        {isCreator && (phase === "upcoming" || phase === "open") && (
          <form className="action-form" onSubmit={(e) => void register(e)} noValidate aria-labelledby={`${id}-register-title`}>
            <h4 id={`${id}-register-title`} className="action-title">
              Register a project
            </h4>
            <p className="action-description">
              Only you, the round creator, can register projects. Each project has a payout address that later claims
              its contributions plus match. Entries cannot be edited or removed.
            </p>
            <Field id={`${id}-payout`} label="Payout address" hint="The wallet that will claim this project's payout." error={payoutError}>
              <TextInput
                id={`${id}-payout`}
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="0x…"
                value={payout}
                invalid={!!payoutError}
                describedBy={describedIds(`${id}-payout`, true, !!payoutError)}
                onChange={(e) => {
                  setPayout(e.target.value);
                  if (payoutError) setPayoutError(undefined);
                }}
                disabled={!onChain}
              />
            </Field>
            <div className="steps">
              <button type="submit" className="button button-secondary" disabled={!onChain || tx.busy(`${id}-register`) || r.projectCount >= 50n}>
                {tx.busy(`${id}-register`) ? "Registering…" : "Register project"}
              </button>
            </div>
            {r.projectCount >= 50n && <p className="action-note">This round has reached the limit of 50 projects.</p>}
            <TxStatus record={tx.records[`${id}-register`]} network={network} onDismiss={tx.dismiss} />
          </form>
        )}

        {phase === "ended" && (
          <div className="action-form">
            <h4 className="action-title">Finalize the round</h4>
            <p className="action-description">
              Anyone can finalize once the end time has passed. This computes each project's match so payouts can be
              claimed. It runs once and cannot be undone.
            </p>
            <div className="steps">
              <button
                type="button"
                className="button button-primary"
                disabled={!onChain || tx.busy(`${id}-finalize`)}
                onClick={() => void simple(`${id}-finalize`, `Finalize round ${r.id}`, "finalize", [r.id])}
              >
                {tx.busy(`${id}-finalize`) ? "Finalizing…" : "Finalize round"}
              </button>
            </div>
            {readyText && <p className="action-note">{readyText}</p>}
            <TxStatus record={tx.records[`${id}-finalize`]} network={network} onDismiss={tx.dismiss} />
          </div>
        )}

        {r.finalized && r.refundable && account && (
          <div className="action-form">
            <h4 className="action-title">Reclaim funding</h4>
            <p className="action-description">
              Your funding in this round: {formatAmount(r.myFunding, decimals)} {symbol}.
            </p>
            <div className="steps">
              <button
                type="button"
                className="button button-primary"
                disabled={!onChain || !canReclaim || tx.busy(`${id}-reclaim`)}
                onClick={() =>
                  void simple(`${id}-reclaim`, `Reclaim ${formatAmount(r.myFunding, decimals)} ${symbol}`, "reclaim", [r.id])
                }
              >
                {tx.busy(`${id}-reclaim`) ? "Reclaiming…" : "Reclaim funding"}
              </button>
            </div>
            {!canReclaim && <p className="action-note">This wallet has nothing to reclaim in this round.</p>}
            <TxStatus record={tx.records[`${id}-reclaim`]} network={network} onDismiss={tx.dismiss} />
          </div>
        )}
      </div>

      <details
        className="activity"
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open && !activity.items && !activity.loading) void loadActivity();
        }}
      >
        <summary>Activity (from contract events)</summary>
        {activity.loading && <p className="muted">Loading events…</p>}
        {activity.error && <p className="inline-error">Unable to load events: {activity.error}</p>}
        {activity.items && activity.items.length === 0 && <p className="muted">No events for this round yet.</p>}
        {activity.items && activity.items.length > 0 && (
          <ul className="activity-list">
            {activity.items.map((item, i) => (
              <li key={`${item.txHash}-${i}`}>
                <span className="activity-event">{item.event}</span>{" "}
                <span className="muted">{describeActivity(item, decimals, symbol)}</span>{" "}
                <a href={explorerTx(network, item.txHash) ?? "#"} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </li>
            ))}
          </ul>
        )}
      </details>
    </article>
  );
}

function describeActivity(item: ActivityItem, decimals: number, symbol: string): string {
  const s = item.summary;
  const amt = (v: unknown) => (typeof v === "bigint" ? `${formatAmount(v, decimals)} ${symbol}` : "");
  const addr = (v: unknown) => (typeof v === "string" ? shortAddress(v) : "");
  switch (item.event) {
    case "RoundCreated":
      return `by ${addr(s.creator)}`;
    case "Funded":
      return `${amt(s.amount)} from ${addr(s.funder)}`;
    case "Registered":
      return `project #${String(s.projectId)} paying ${addr(s.payout)}`;
    case "Contributed":
      return `${amt(s.amount)} to project #${String(s.projectId)} from ${addr(s.contributor)}`;
    case "Finalized":
      return s.refundable ? "no contributions; pool refundable" : `pool ${amt(s.pool)} allocated`;
    case "Claimed":
      return `${amt(s.amount)} for project #${String(s.projectId)}`;
    case "Reclaimed":
      return `${amt(s.amount)} by ${addr(s.funder)}`;
    default:
      return "";
  }
}

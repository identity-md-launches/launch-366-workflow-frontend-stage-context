import {
  BaseError,
  ContractFunctionRevertedError,
  type Abi,
  type Address,
  type PublicClient,
  type Log,
} from "viem";
import { DEPLOYMENT_BLOCK, LOG_WINDOW, type Deployment } from "../config";

export interface RoundView {
  id: bigint;
  creator: Address;
  start: bigint;
  end: bigint;
  pool: bigint;
  projectCount: bigint;
  totalContributions: bigint;
  finalized: boolean;
  refundable: boolean;
  projects: ProjectView[];
  /** Connected wallet's funding deposit in this round (for reclaim). */
  myFunding: bigint;
}

export interface ProjectView {
  id: bigint;
  payout: Address;
  contributions: bigint;
  sumSqrt: bigint;
  matchAmount: bigint;
  claimed: boolean;
  /** Live estimate before finalization, stored allocation after. */
  estimatedMatch: bigint;
  /** Connected wallet's cumulative contribution to this project. */
  myContribution: bigint;
}

export interface TokenState {
  symbol: string;
  decimals: number;
  balance: bigint;
  allowance: bigint;
}

export interface ChainSnapshot {
  blockNumber: bigint;
  blockTimestamp: bigint;
  tokenAddress: Address;
  minContribution: bigint;
  rounds: RoundView[];
  token?: TokenState;
}

type RoundTuple = {
  creator: Address;
  start: bigint;
  end: bigint;
  pool: bigint;
  projectCount: bigint;
  totalContributions: bigint;
  finalized: boolean;
  refundable: boolean;
};
type ProjectTuple = { payout: Address; contributions: bigint; sumSqrt: bigint; matchAmount: bigint; claimed: boolean };

const ZERO: Address = "0x0000000000000000000000000000000000000000";

/** Read everything the page shows in one batched pass. */
export async function readSnapshot(
  client: PublicClient,
  deployment: Deployment,
  account: Address | undefined,
): Promise<ChainSnapshot> {
  const funding = deployment.funding.address;
  const fundingAbi = deployment.abis[deployment.funding.name];
  const tokenAbi = deployment.abis[deployment.token.name];
  const read = <T>(address: Address, abi: Abi, functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi, functionName, args }) as Promise<T>;

  const [block, tokenAddress, minContribution, roundCount] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    read<Address>(funding, fundingAbi, "token"),
    read<bigint>(funding, fundingAbi, "MIN_CONTRIBUTION"),
    read<bigint>(funding, fundingAbi, "roundCount"),
  ]);

  const roundIds = Array.from({ length: Number(roundCount) }, (_, i) => BigInt(i));
  const roundTuples = await Promise.all(
    roundIds.map((id) => read<RoundTuple>(funding, fundingAbi, "round", [id])),
  );

  const rounds: RoundView[] = await Promise.all(
    roundTuples.map(async (r, i) => {
      const id = roundIds[i];
      const projectIds = Array.from({ length: Number(r.projectCount) }, (_, p) => BigInt(p));
      const [projects, estimates, mine, myFunding] = await Promise.all([
        Promise.all(projectIds.map((p) => read<ProjectTuple>(funding, fundingAbi, "project", [id, p]))),
        Promise.all(projectIds.map((p) => read<bigint>(funding, fundingAbi, "estimateMatch", [id, p]))),
        account
          ? Promise.all(projectIds.map((p) => read<bigint>(funding, fundingAbi, "contributionOf", [id, p, account])))
          : Promise.resolve(projectIds.map(() => 0n)),
        account ? read<bigint>(funding, fundingAbi, "fundingOf", [id, account]) : Promise.resolve(0n),
      ]);
      return {
        id,
        ...r,
        myFunding,
        projects: projects.map((p, j) => ({
          id: projectIds[j],
          ...p,
          estimatedMatch: estimates[j],
          myContribution: mine[j],
        })),
      };
    }),
  );

  let token: TokenState | undefined;
  const [symbol, decimals] = await Promise.all([
    read<string>(tokenAddress, tokenAbi, "symbol"),
    read<number>(tokenAddress, tokenAbi, "decimals"),
  ]);
  if (account) {
    const [balance, allowance] = await Promise.all([
      read<bigint>(tokenAddress, tokenAbi, "balanceOf", [account]),
      read<bigint>(tokenAddress, tokenAbi, "allowance", [account, funding]),
    ]);
    token = { symbol, decimals, balance, allowance };
  } else {
    token = { symbol, decimals, balance: 0n, allowance: 0n };
  }

  return {
    blockNumber: block.number ?? 0n,
    blockTimestamp: block.timestamp,
    tokenAddress: tokenAddress === ZERO ? deployment.token.address : tokenAddress,
    minContribution,
    rounds,
    token,
  };
}

export interface ActivityItem {
  blockNumber: bigint;
  txHash: string;
  event: string;
  summary: Record<string, string | bigint | boolean | undefined>;
}

/** Event history for one round from the deployment block onward, in bounded windows. */
export async function readRoundActivity(
  client: PublicClient,
  deployment: Deployment,
  roundId: bigint,
  latest: bigint,
): Promise<ActivityItem[]> {
  const abi = deployment.abis[deployment.funding.name];
  const events = abi.filter((e) => e.type === "event");
  const items: ActivityItem[] = [];
  for (let from = DEPLOYMENT_BLOCK; from <= latest; from += LOG_WINDOW) {
    const to = from + LOG_WINDOW - 1n > latest ? latest : from + LOG_WINDOW - 1n;
    const logs = (await client.getLogs({
      address: deployment.funding.address,
      events: events as never,
      args: { roundId } as never,
      fromBlock: from,
      toBlock: to,
    })) as (Log & { eventName?: string; args?: Record<string, unknown> })[];
    for (const log of logs) {
      const args = (log.args ?? {}) as Record<string, string | bigint | boolean | undefined>;
      if (args.roundId !== roundId) continue;
      items.push({
        blockNumber: log.blockNumber ?? 0n,
        txHash: log.transactionHash ?? "",
        event: log.eventName ?? "Event",
        summary: args,
      });
    }
  }
  return items;
}

const ERROR_TEXT: Record<string, string> = {
  InvalidToken: "The token address is not a contract.",
  InvalidSchedule: "Start must be now or later and the round must last between 1 and 30 days.",
  InvalidRound: "That round does not exist.",
  InvalidProject: "That project does not exist in this round.",
  RoundEnded: "The round has ended, so this action is closed.",
  OutsideContributionWindow: "Contributions are accepted only between the round's start and end.",
  RoundStillOpen: "The round has not ended yet. Finalize after the end time.",
  OnlyCreator: "Only the round creator can register projects.",
  InvalidPayout: "Enter a payout address other than the zero address.",
  ProjectLimit: "This round already has the maximum of 50 projects.",
  InvalidAmount: "Enter a larger amount. Contributions must be at least 1 MTCH and funding must be above zero.",
  DepositLimit: "This amount would exceed the round's deposit limit.",
  UnexpectedTransferAmount: "The token did not deliver the exact amount.",
  AlreadyFinalized: "This round is already finalized.",
  NotFinalized: "Finalize the round before claiming or reclaiming.",
  OnlyPayout: "Only the project's payout address can claim.",
  AlreadyClaimed: "This project's payout has already been claimed.",
  NotRefundable: "Funding can be reclaimed only when a finalized round had no contributions.",
  NothingToReclaim: "This wallet has no funding to reclaim in this round.",
  ERC20InsufficientAllowance: "Approve enough MTCH for QuadraticFunding first.",
  ERC20InsufficientBalance: "This wallet does not hold enough MTCH.",
};

/** Human-readable reason for a failed simulation, transaction or wallet request. */
export function describeError(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? reverted.reason;
      if (name && ERROR_TEXT[name]) return ERROR_TEXT[name];
      if (name) return `The contract rejected this call (${name}).`;
    }
    if (/insufficient funds/i.test(error.shortMessage)) return "This wallet does not have enough ETH for gas.";
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

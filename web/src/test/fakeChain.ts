/**
 * In-memory Sepolia stand-in for interaction tests.
 *
 * It decodes every eth_call / eth_sendTransaction with the real implementation-derived ABIs and
 * applies the QuadraticFunding rules (windows, creator-only registration, minimum contribution,
 * sqrt weights, whole-pool allocation, claim/reclaim authorization) so the UI is exercised
 * against faithful reverts and state transitions without funds or a network.
 */
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  keccak256,
  toHex,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

const ETHER = 10n ** 18n;
const DAY = 86_400n;

export interface Round {
  creator: Address;
  start: bigint;
  end: bigint;
  pool: bigint;
  projectCount: bigint;
  totalContributions: bigint;
  finalized: boolean;
  refundable: boolean;
}
export interface Project {
  payout: Address;
  contributions: bigint;
  sumSqrt: bigint;
  matchAmount: bigint;
  claimed: boolean;
}

export interface SentTx {
  hash: Hex;
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
  /** Decoded call for assertions. */
  functionName: string;
  args: readonly unknown[];
}

interface StoredLog {
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
}

export class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: Hex,
  ) {
    super(message);
  }
  toJSON() {
    return { code: this.code, message: this.message, data: this.data };
  }
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export class FakeChain {
  chainId = 11155111;
  blockNumber = 11_791_600n;
  timestamp = 1_790_000_000n;
  balances = new Map<string, bigint>();
  allowances = new Map<string, bigint>();
  rounds: Round[] = [];
  projects = new Map<string, Project>();
  contributions = new Map<string, bigint>();
  fundingOf = new Map<string, bigint>();
  sent: SentTx[] = [];
  logs: StoredLog[] = [];
  /** Amount of MTCH the fake quoter returns for any input. */
  quoteOut = 12_345n * 10n ** 16n;
  /** Extra latency (ms) added to every RPC response, to observe loading states. */
  latency = 0;
  requests: { method: string; params: unknown }[] = [];

  constructor(
    public readonly token: Address,
    public readonly funding: Address,
    public readonly quoter: Address,
    public readonly tokenAbi: Abi,
    public readonly fundingAbi: Abi,
  ) {}

  // ---- state helpers -------------------------------------------------------

  setBalance(account: Address, amount: bigint) {
    this.balances.set(account.toLowerCase(), amount);
  }
  balanceOf(account: string) {
    return this.balances.get(account.toLowerCase()) ?? 0n;
  }
  setAllowance(owner: Address, amount: bigint) {
    this.allowances.set(`${owner.toLowerCase()}:${this.funding.toLowerCase()}`, amount);
  }
  allowanceOf(owner: string, spender: string) {
    return this.allowances.get(`${owner.toLowerCase()}:${spender.toLowerCase()}`) ?? 0n;
  }
  project(roundId: bigint, projectId: bigint): Project {
    return this.projects.get(`${roundId}:${projectId}`)!;
  }
  addRound(creator: Address, start: bigint, end: bigint): bigint {
    const id = BigInt(this.rounds.length);
    this.rounds.push({ creator, start, end, pool: 0n, projectCount: 0n, totalContributions: 0n, finalized: false, refundable: false });
    this.emit(this.funding, "RoundCreated", { roundId: id, creator, start, end });
    return id;
  }
  addProject(roundId: bigint, payout: Address): bigint {
    const r = this.rounds[Number(roundId)];
    const id = r.projectCount++;
    this.projects.set(`${roundId}:${id}`, { payout, contributions: 0n, sumSqrt: 0n, matchAmount: 0n, claimed: false });
    this.emit(this.funding, "Registered", { roundId, projectId: id, payout });
    return id;
  }

  private emit(address: Address, eventName: string, args: Record<string, unknown>, txHash: Hex = "0x" + "ab".repeat(32) as Hex) {
    this.logs.push({ address, eventName, args, blockNumber: this.blockNumber, txHash, logIndex: this.logs.length });
  }

  // ---- contract logic ------------------------------------------------------

  private revert(errorName: string, args: unknown[] = []): never {
    const abi = this.fundingAbi.some((e) => e.type === "error" && e.name === errorName) ? this.fundingAbi : this.tokenAbi;
    const data = encodeErrorResult({ abi, errorName, args });
    throw new RpcError(3, "execution reverted", data);
  }

  private getRound(id: bigint): Round {
    if (id >= BigInt(this.rounds.length)) this.revert("InvalidRound");
    return this.rounds[Number(id)];
  }
  private getProject(roundId: bigint, r: Round, projectId: bigint): Project {
    if (projectId >= r.projectCount) this.revert("InvalidProject");
    return this.project(roundId, projectId);
  }

  private pull(from: Address, amount: bigint) {
    const allowance = this.allowanceOf(from, this.funding);
    if (allowance < amount) this.revert("ERC20InsufficientAllowance", [this.funding, allowance, amount]);
    const balance = this.balanceOf(from);
    if (balance < amount) this.revert("ERC20InsufficientBalance", [from, balance, amount]);
    this.allowances.set(`${from.toLowerCase()}:${this.funding.toLowerCase()}`, allowance - amount);
    this.setBalance(from, balance - amount);
    this.setBalance(this.funding, this.balanceOf(this.funding) + amount);
  }

  private matching(roundId: bigint, r: Round): { amounts: bigint[]; total: bigint } {
    const n = Number(r.projectCount);
    const weights: bigint[] = [];
    let total = 0n;
    let largest = 0;
    let largestWeight = 0n;
    for (let i = 0; i < n; i++) {
      const w = this.project(roundId, BigInt(i)).sumSqrt ** 2n;
      weights.push(w);
      total += w;
      if (w > largestWeight) {
        largestWeight = w;
        largest = i;
      }
    }
    if (total === 0n) return { amounts: weights.map(() => 0n), total: 0n };
    let allocated = 0n;
    const amounts = weights.map((w) => {
      const a = (r.pool * w) / total;
      allocated += a;
      return a;
    });
    amounts[largest] += r.pool - allocated;
    return { amounts, total };
  }

  /** Execute a call against the funding or token contract; `mutate` false = eth_call semantics on a copy. */
  private execute(from: Address, to: Address, data: Hex, mutate: boolean): { result: Hex; functionName: string; args: readonly unknown[] } {
    const snapshot = mutate ? undefined : this.snapshot();
    try {
      return this.executeInner(from, to, data);
    } finally {
      if (snapshot) this.restore(snapshot);
    }
  }

  private snapshot() {
    return {
      balances: new Map(this.balances),
      allowances: new Map(this.allowances),
      rounds: this.rounds.map((r) => ({ ...r })),
      projects: new Map([...this.projects].map(([k, v]) => [k, { ...v }])),
      contributions: new Map(this.contributions),
      fundingOf: new Map(this.fundingOf),
      logs: [...this.logs],
    };
  }
  private restore(s: ReturnType<FakeChain["snapshot"]>) {
    this.balances = s.balances;
    this.allowances = s.allowances;
    this.rounds = s.rounds;
    this.projects = s.projects;
    this.contributions = s.contributions;
    this.fundingOf = s.fundingOf;
    this.logs = s.logs;
  }

  private executeInner(from: Address, to: Address, data: Hex) {
    const lower = to.toLowerCase();
    if (lower === this.quoter.toLowerCase()) {
      // quoteExactInputSingle(params) → (amountOut, gasEstimate)
      const out = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [this.quoteOut, 100_000n]);
      return { result: out, functionName: "quoteExactInputSingle", args: [] };
    }
    if (lower === this.token.toLowerCase()) {
      const { functionName, args = [] } = decodeFunctionData({ abi: this.tokenAbi, data });
      const enc = (result: unknown) => encodeFunctionResult({ abi: this.tokenAbi, functionName, result } as never);
      switch (functionName) {
        case "symbol":
          return { result: enc("MTCH"), functionName, args };
        case "name":
          return { result: enc("Match"), functionName, args };
        case "decimals":
          return { result: enc(18), functionName, args };
        case "balanceOf":
          return { result: enc(this.balanceOf(args[0] as string)), functionName, args };
        case "allowance":
          return { result: enc(this.allowanceOf(args[0] as string, args[1] as string)), functionName, args };
        case "approve": {
          const [spender, amount] = args as [Address, bigint];
          this.allowances.set(`${from.toLowerCase()}:${spender.toLowerCase()}`, amount);
          this.emit(this.token, "Approval", { owner: from, spender, value: amount });
          return { result: enc(true), functionName, args };
        }
        default:
          throw new RpcError(-32000, `token function ${functionName} not implemented`);
      }
    }
    if (lower === this.funding.toLowerCase()) {
      const { functionName, args = [] } = decodeFunctionData({ abi: this.fundingAbi, data });
      const enc = (result: unknown) => encodeFunctionResult({ abi: this.fundingAbi, functionName, result } as never);
      const a = args as unknown[];
      switch (functionName) {
        case "token":
          return { result: enc(this.token), functionName, args };
        case "MIN_CONTRIBUTION":
          return { result: enc(ETHER), functionName, args };
        case "roundCount":
          return { result: enc(BigInt(this.rounds.length)), functionName, args };
        case "round":
          return { result: enc(this.getRound(a[0] as bigint)), functionName, args };
        case "project": {
          const r = this.getRound(a[0] as bigint);
          return { result: enc(this.getProject(a[0] as bigint, r, a[1] as bigint)), functionName, args };
        }
        case "contributionOf": {
          const r = this.getRound(a[0] as bigint);
          this.getProject(a[0] as bigint, r, a[1] as bigint);
          return { result: enc(this.contributions.get(`${a[0]}:${a[1]}:${(a[2] as string).toLowerCase()}`) ?? 0n), functionName, args };
        }
        case "fundingOf":
          return { result: enc(this.fundingOf.get(`${a[0]}:${(a[1] as string).toLowerCase()}`) ?? 0n), functionName, args };
        case "estimateMatch": {
          const r = this.getRound(a[0] as bigint);
          const p = this.getProject(a[0] as bigint, r, a[1] as bigint);
          if (r.finalized) return { result: enc(p.matchAmount), functionName, args };
          return { result: enc(this.matching(a[0] as bigint, r).amounts[Number(a[1])]), functionName, args };
        }
        case "createRound": {
          const [start, end] = a as [bigint, bigint];
          if (start < this.timestamp || end <= start) this.revert("InvalidSchedule");
          const duration = end - start;
          if (duration < DAY || duration > 30n * DAY) this.revert("InvalidSchedule");
          const id = this.addRound(from, start, end);
          return { result: enc(id), functionName, args };
        }
        case "fund": {
          const [roundId, amount] = a as [bigint, bigint];
          const r = this.getRound(roundId);
          if (this.timestamp >= r.end) this.revert("RoundEnded");
          if (amount === 0n) this.revert("InvalidAmount");
          r.pool += amount;
          const key = `${roundId}:${from.toLowerCase()}`;
          this.fundingOf.set(key, (this.fundingOf.get(key) ?? 0n) + amount);
          this.pull(from, amount);
          this.emit(this.funding, "Funded", { roundId, funder: from, amount });
          return { result: "0x" as Hex, functionName, args };
        }
        case "register": {
          const [roundId, payout] = a as [bigint, Address];
          const r = this.getRound(roundId);
          if (from.toLowerCase() !== r.creator.toLowerCase()) this.revert("OnlyCreator");
          if (this.timestamp >= r.end) this.revert("RoundEnded");
          if (/^0x0{40}$/.test(payout)) this.revert("InvalidPayout");
          if (r.projectCount >= 50n) this.revert("ProjectLimit");
          const id = this.addProject(roundId, payout);
          return { result: enc(id), functionName, args };
        }
        case "contribute": {
          const [roundId, projectId, amount] = a as [bigint, bigint, bigint];
          const r = this.getRound(roundId);
          const p = this.getProject(roundId, r, projectId);
          if (this.timestamp < r.start || this.timestamp >= r.end) this.revert("OutsideContributionWindow");
          if (amount < ETHER) this.revert("InvalidAmount");
          const key = `${roundId}:${projectId}:${from.toLowerCase()}`;
          const previous = this.contributions.get(key) ?? 0n;
          const updated = previous + amount;
          this.contributions.set(key, updated);
          p.sumSqrt += isqrt(updated) - isqrt(previous);
          p.contributions += amount;
          r.totalContributions += amount;
          this.pull(from, amount);
          this.emit(this.funding, "Contributed", { roundId, projectId, contributor: from, amount, contributorTotal: updated });
          return { result: "0x" as Hex, functionName, args };
        }
        case "finalize": {
          const [roundId] = a as [bigint];
          const r = this.getRound(roundId);
          if (r.finalized) this.revert("AlreadyFinalized");
          if (this.timestamp < r.end) this.revert("RoundStillOpen");
          const { amounts, total } = this.matching(roundId, r);
          r.finalized = true;
          r.refundable = total === 0n;
          amounts.forEach((m, i) => (this.project(roundId, BigInt(i)).matchAmount = m));
          this.emit(this.funding, "Finalized", { roundId, pool: r.pool, totalWeight: total, refundable: r.refundable });
          return { result: "0x" as Hex, functionName, args };
        }
        case "claim": {
          const [roundId, projectId] = a as [bigint, bigint];
          const r = this.getRound(roundId);
          const p = this.getProject(roundId, r, projectId);
          if (!r.finalized) this.revert("NotFinalized");
          if (from.toLowerCase() !== p.payout.toLowerCase()) this.revert("OnlyPayout");
          if (p.claimed) this.revert("AlreadyClaimed");
          p.claimed = true;
          const amount = p.contributions + p.matchAmount;
          this.setBalance(this.funding, this.balanceOf(this.funding) - amount);
          this.setBalance(from, this.balanceOf(from) + amount);
          this.emit(this.funding, "Claimed", { roundId, projectId, payout: from, amount });
          return { result: "0x" as Hex, functionName, args };
        }
        case "reclaim": {
          const [roundId] = a as [bigint];
          const r = this.getRound(roundId);
          if (!r.finalized) this.revert("NotFinalized");
          if (!r.refundable) this.revert("NotRefundable");
          const key = `${roundId}:${from.toLowerCase()}`;
          const amount = this.fundingOf.get(key) ?? 0n;
          if (amount === 0n) this.revert("NothingToReclaim");
          this.fundingOf.set(key, 0n);
          this.setBalance(this.funding, this.balanceOf(this.funding) - amount);
          this.setBalance(from, this.balanceOf(from) + amount);
          this.emit(this.funding, "Reclaimed", { roundId, funder: from, amount });
          return { result: "0x" as Hex, functionName, args };
        }
        default:
          throw new RpcError(-32000, `funding function ${functionName} not implemented`);
      }
    }
    throw new RpcError(-32000, `no contract at ${to}`);
  }

  // ---- JSON-RPC ------------------------------------------------------------

  private block(number: bigint) {
    return {
      number: toHex(number),
      hash: keccak256(toHex(`block-${number}`)),
      parentHash: keccak256(toHex(`block-${number - 1n}`)),
      timestamp: toHex(this.timestamp),
      baseFeePerGas: "0x3b9aca00",
      gasLimit: "0x1c9c380",
      gasUsed: "0x0",
      miner: "0x0000000000000000000000000000000000000000",
      nonce: "0x0000000000000000",
      difficulty: "0x0",
      extraData: "0x",
      logsBloom: `0x${"0".repeat(512)}`,
      sha3Uncles: keccak256("0x"),
      size: "0x0",
      stateRoot: keccak256("0x01"),
      receiptsRoot: keccak256("0x02"),
      transactionsRoot: keccak256("0x03"),
      totalDifficulty: "0x0",
      transactions: [],
      uncles: [],
      mixHash: keccak256("0x04"),
    };
  }

  private encodeLog(log: StoredLog) {
    const abi = log.address.toLowerCase() === this.token.toLowerCase() ? this.tokenAbi : this.fundingAbi;
    const event = abi.find((e): e is AbiEvent => e.type === "event" && e.name === log.eventName)!;
    const topics = encodeEventTopics({ abi, eventName: log.eventName, args: log.args } as never);
    const nonIndexed = event.inputs.filter((i) => !i.indexed);
    const data = nonIndexed.length ? encodeAbiParameters(nonIndexed, nonIndexed.map((i) => log.args[i.name!])) : "0x";
    return {
      address: log.address,
      topics,
      data,
      blockNumber: toHex(log.blockNumber),
      blockHash: keccak256(toHex(`block-${log.blockNumber}`)),
      transactionHash: log.txHash,
      transactionIndex: "0x0",
      logIndex: toHex(log.logIndex),
      removed: false,
    };
  }

  /** Apply a wallet-submitted transaction and return its hash. */
  sendTransaction(tx: { from: string; to: string; data: string; value?: string }): Hex {
    const from = getAddress(tx.from);
    const to = getAddress(tx.to);
    const value = tx.value ? BigInt(tx.value) : 0n;
    if (value > 0n) throw new RpcError(3, "execution reverted", undefined);
    const hash = keccak256(toHex(`tx-${this.sent.length}-${tx.data}`));
    this.blockNumber += 1n;
    const { functionName, args } = this.execute(from, to, tx.data as Hex, true);
    // Re-stamp logs emitted by this transaction with its hash.
    for (const log of this.logs) if (log.txHash === ("0x" + "ab".repeat(32) as Hex)) log.txHash = hash;
    this.sent.push({ hash, from, to, data: tx.data as Hex, value, functionName, args });
    return hash;
  }

  async handle(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    if (this.latency) await new Promise((r) => setTimeout(r, this.latency));
    const p = (params ?? []) as never[];
    switch (method) {
      case "eth_chainId":
        return toHex(this.chainId);
      case "eth_blockNumber":
        return toHex(this.blockNumber);
      case "eth_getBlockByNumber": {
        const tag = p[0] as string;
        const n = tag === "latest" || tag === "pending" || tag === "safe" || tag === "finalized" ? this.blockNumber : BigInt(tag);
        return this.block(n);
      }
      case "eth_getBlockByHash":
        return this.block(this.blockNumber);
      case "eth_call": {
        const call = p[0] as { from?: string; to: string; data: string };
        const from = call.from ? getAddress(call.from) : ("0x0000000000000000000000000000000000000001" as Address);
        return this.execute(from, getAddress(call.to), call.data as Hex, false).result;
      }
      case "eth_estimateGas": {
        const call = p[0] as { from?: string; to: string; data: string };
        const from = call.from ? getAddress(call.from) : ("0x0000000000000000000000000000000000000001" as Address);
        this.execute(from, getAddress(call.to), call.data as Hex, false);
        return "0x30d40";
      }
      case "eth_getCode":
        return [this.token, this.funding, this.quoter].some((a) => a.toLowerCase() === (p[0] as string).toLowerCase())
          ? "0x6080604052"
          : "0x";
      case "eth_getBalance":
        return "0xde0b6b3a7640000";
      case "eth_getTransactionCount":
        return "0x1";
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return "0x3b9aca00";
      case "eth_feeHistory":
        return { baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"], gasUsedRatio: [0.5], oldestBlock: toHex(this.blockNumber), reward: [["0x3b9aca00"]] };
      case "eth_getTransactionReceipt": {
        const tx = this.sent.find((t) => t.hash === p[0]);
        if (!tx) return null;
        return {
          transactionHash: tx.hash,
          transactionIndex: "0x0",
          blockHash: keccak256(toHex(`block-${this.blockNumber}`)),
          blockNumber: toHex(this.blockNumber),
          from: tx.from,
          to: tx.to,
          cumulativeGasUsed: "0x5208",
          gasUsed: "0x5208",
          effectiveGasPrice: "0x3b9aca00",
          contractAddress: null,
          logs: [],
          logsBloom: `0x${"0".repeat(512)}`,
          status: "0x1",
          type: "0x2",
        };
      }
      case "eth_getTransactionByHash": {
        const tx = this.sent.find((t) => t.hash === p[0]);
        if (!tx) return null;
        return {
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          input: tx.data,
          value: toHex(tx.value),
          nonce: "0x1",
          blockHash: keccak256(toHex(`block-${this.blockNumber}`)),
          blockNumber: toHex(this.blockNumber),
          transactionIndex: "0x0",
          gas: "0x5208",
          gasPrice: "0x3b9aca00",
          type: "0x2",
          chainId: toHex(this.chainId),
          v: "0x0",
          r: "0x0",
          s: "0x0",
        };
      }
      case "eth_getLogs": {
        const filter = p[0] as { address?: string; fromBlock?: string; toBlock?: string; topics?: (string | string[] | null)[] };
        const from = filter.fromBlock ? BigInt(filter.fromBlock) : 0n;
        const to = filter.toBlock && filter.toBlock !== "latest" ? BigInt(filter.toBlock) : this.blockNumber;
        return this.logs
          .filter((l) => !filter.address || l.address.toLowerCase() === filter.address.toLowerCase())
          .filter((l) => l.blockNumber >= from && l.blockNumber <= to)
          .map((l) => this.encodeLog(l))
          .filter((l) => {
            const topics = filter.topics ?? [];
            return topics.every((t, i) => {
              if (t === null || t === undefined) return true;
              const want = Array.isArray(t) ? t : [t];
              return want.some((w) => w.toLowerCase() === String((l.topics as string[])[i] ?? "").toLowerCase());
            });
          });
      }
      default:
        throw new RpcError(-32601, `method ${method} not implemented in FakeChain`);
    }
  }
}

/** JSON-RPC over fetch, handling single and batched requests, as viem's http transport sends them. */
export async function rpcOverFetch(chain: FakeChain, body: string): Promise<Response> {
  const parsed = JSON.parse(body) as { id: number; method: string; params: unknown } | { id: number; method: string; params: unknown }[];
  const one = async (req: { id: number; method: string; params: unknown }) => {
    try {
      return { jsonrpc: "2.0", id: req.id, result: await chain.handle(req.method, req.params) };
    } catch (e) {
      const err = e instanceof RpcError ? e.toJSON() : { code: -32000, message: (e as Error).message };
      return { jsonrpc: "2.0", id: req.id, error: err };
    }
  };
  const result = Array.isArray(parsed) ? await Promise.all(parsed.map(one)) : await one(parsed);
  return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
}

/** Minimal EIP-1193 wallet bound to the fake chain. */
export class FakeWallet {
  listeners = new Map<string, Set<(arg: unknown) => void>>();
  /** Chains the wallet already knows. Sepolia missing → switch fails with 4902 until added. */
  knownChains = new Set<number>([1]);
  addedChains: unknown[] = [];
  rejectNext: "connect" | "switch" | "tx" | undefined;
  requests: { method: string; params: unknown }[] = [];

  constructor(
    public chain: FakeChain,
    public account: Address,
    public currentChainId = 11155111,
  ) {}

  on(event: string, cb: (arg: unknown) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }
  removeListener(event: string, cb: (arg: unknown) => void) {
    this.listeners.get(event)?.delete(cb);
  }
  private fire(event: string, arg: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(arg);
  }

  async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    this.requests.push({ method, params });
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        if (this.rejectNext === "connect") {
          this.rejectNext = undefined;
          throw new RpcError(4001, "User rejected the request.");
        }
        return [this.account];
      case "eth_chainId":
        return toHex(this.currentChainId);
      case "wallet_switchEthereumChain": {
        if (this.rejectNext === "switch") {
          this.rejectNext = undefined;
          throw new RpcError(4001, "User rejected the request.");
        }
        const id = Number.parseInt((params as [{ chainId: string }])[0].chainId, 16);
        if (!this.knownChains.has(id)) throw new RpcError(4902, "Unrecognized chain ID. Try adding the chain first.");
        this.currentChainId = id;
        this.fire("chainChanged", toHex(id));
        return null;
      }
      case "wallet_addEthereumChain": {
        const p = (params as [{ chainId: string }])[0];
        this.addedChains.push(p);
        this.knownChains.add(Number.parseInt(p.chainId, 16));
        return null;
      }
      case "eth_sendTransaction": {
        if (this.rejectNext === "tx") {
          this.rejectNext = undefined;
          throw new RpcError(4001, "User rejected the request.");
        }
        if (this.currentChainId !== this.chain.chainId) throw new RpcError(-32000, "wallet is on another chain");
        return this.chain.sendTransaction((params as [{ from: string; to: string; data: string; value?: string }])[0]);
      }
      default:
        return this.chain.handle(method, params);
    }
  }
}

import { useCallback, useState } from "react";
import type { Abi, Address, Hash, PublicClient, WalletClient } from "viem";
import { describeError } from "../lib/contracts";
import { isUserRejection } from "../lib/wallet";

export type TxPhase = "simulating" | "signing" | "pending" | "confirmed" | "failed";

export interface TxRecord {
  /** Stable key so each control shows only its own status. */
  key: string;
  label: string;
  phase: TxPhase;
  hash?: Hash;
  message?: string;
  startedAt: number;
}

export interface TxRequest {
  key: string;
  label: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args: unknown[];
}

export interface TxRunner {
  records: Record<string, TxRecord>;
  /** True while any transaction for this key is in flight. */
  busy: (key: string) => boolean;
  run: (request: TxRequest) => Promise<boolean>;
  dismiss: (key: string) => void;
}

/**
 * Simulate first (revert reasons surface before the wallet opens), then sign, then wait for the
 * receipt. `onConfirmed` re-reads live state.
 */
export function useTransactions(
  client: PublicClient | undefined,
  walletClient: WalletClient | undefined,
  account: Address | undefined,
  onConfirmed: () => Promise<void>,
): TxRunner {
  const [records, setRecords] = useState<Record<string, TxRecord>>({});

  const update = useCallback((key: string, patch: Partial<TxRecord>) => {
    setRecords((prev) => ({ ...prev, [key]: { ...(prev[key] as TxRecord), ...patch } }));
  }, []);

  const run = useCallback(
    async (req: TxRequest) => {
      if (!client || !walletClient || !account) return false;
      const base: TxRecord = { key: req.key, label: req.label, phase: "simulating", startedAt: Date.now() };
      setRecords((prev) => ({ ...prev, [req.key]: base }));
      try {
        const { request } = await client.simulateContract({
          address: req.address,
          abi: req.abi,
          functionName: req.functionName,
          args: req.args,
          account,
        });
        update(req.key, { phase: "signing" });
        const hash = await walletClient.writeContract({ ...request, account, chain: walletClient.chain });
        update(req.key, { phase: "pending", hash });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          update(req.key, { phase: "failed", message: "The transaction was mined but reverted." });
          await onConfirmed();
          return false;
        }
        update(req.key, { phase: "confirmed" });
        await onConfirmed();
        return true;
      } catch (e) {
        update(req.key, {
          phase: "failed",
          message: isUserRejection(e) ? "Signature request was rejected in the wallet." : describeError(e),
        });
        return false;
      }
    },
    [client, walletClient, account, onConfirmed, update],
  );

  const busy = useCallback(
    (key: string) => {
      const r = records[key];
      return !!r && (r.phase === "simulating" || r.phase === "signing" || r.phase === "pending");
    },
    [records],
  );

  const dismiss = useCallback((key: string) => {
    setRecords((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  return { records, busy, run, dismiss };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, PublicClient } from "viem";
import { REFRESH_MS, type Deployment } from "../config";
import { describeError, readSnapshot, type ChainSnapshot } from "../lib/contracts";

export interface SnapshotState {
  snapshot?: ChainSnapshot;
  loading: boolean;
  error?: string;
  /** Resolves after a read that started at or after the call, so post-transaction state is fresh. */
  refresh: () => Promise<void>;
}

/** Poll live contract state through the public RPC; refresh on demand after transactions. */
export function useSnapshot(
  client: PublicClient | undefined,
  deployment: Deployment | undefined,
  account: Address | undefined,
): SnapshotState {
  const [snapshot, setSnapshot] = useState<ChainSnapshot | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const queued = useRef<Promise<void> | undefined>(undefined);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!client || !deployment) return;
    const start = () => {
      const id = ++generation.current;
      setLoading(true);
      inFlight.current = readSnapshot(client, deployment, account)
        .then((s) => {
          if (id !== generation.current) return; // a newer read superseded this one
          setSnapshot(s);
          setError(undefined);
        })
        .catch((e: unknown) => {
          if (id === generation.current) setError(`Unable to read contract state: ${describeError(e)}`);
        })
        .finally(() => {
          if (id === generation.current) setLoading(false);
          inFlight.current = undefined;
        });
      return inFlight.current;
    };
    if (!inFlight.current) return start();
    // A read is running; queue exactly one follow-up so every caller sees state read after its call.
    if (!queued.current) {
      queued.current = inFlight.current.then(() => {
        queued.current = undefined;
        return start();
      });
    }
    return queued.current;
  }, [client, deployment, account]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}

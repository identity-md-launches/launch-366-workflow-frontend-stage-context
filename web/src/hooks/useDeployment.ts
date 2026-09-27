import { useEffect, useMemo, useState } from "react";
import type { Chain, PublicClient } from "viem";
import { loadDeployment, type Deployment } from "../config";
import { chainFromManifest, publicClientFor } from "../lib/chain";

export type DeploymentState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; deployment: Deployment; chain: Chain; client: PublicClient };

/** Load ./imd-deployment.json + ABIs once and derive the chain and read-only client from it. */
export function useDeployment(): DeploymentState {
  const [deployment, setDeployment] = useState<Deployment | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    loadDeployment()
      .then((d) => !cancelled && setDeployment(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo<DeploymentState>(() => {
    if (error) return { status: "error", message: error };
    if (!deployment) return { status: "loading" };
    try {
      const chain = chainFromManifest(deployment.manifest);
      return { status: "ready", deployment, chain, client: publicClientFor(chain) };
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }, [deployment, error]);
}

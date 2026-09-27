import { createPublicClient, defineChain, fallback, http, type Chain, type PublicClient } from "viem";
import type { DeploymentManifest, NetworkBlock } from "../config";

/** Build a viem chain from the manifest's vetted network block. */
export function chainFromManifest(manifest: DeploymentManifest): Chain {
  const n: NetworkBlock | undefined = manifest.network;
  return defineChain({
    id: manifest.chainId,
    name: n?.name ?? `Chain ${manifest.chainId}`,
    testnet: n?.testnet ?? true,
    nativeCurrency: n?.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: n?.rpcUrls ?? [] } },
    blockExplorers: n ? { default: { name: "Explorer", url: n.explorer } } : undefined,
  });
}

/** Read-only client over the public RPC list, first URL preferred, batching JSON-RPC calls. */
export function publicClientFor(chain: Chain): PublicClient {
  const urls = chain.rpcUrls.default.http;
  if (urls.length === 0) throw new Error("No public RPC URL is configured for this chain");
  return createPublicClient({
    chain,
    pollingInterval: 2_000,
    transport: fallback(
      urls.map((url) => http(url, { batch: { wait: 16 }, timeout: 15_000, retryCount: 1 })),
      { rank: false },
    ),
  });
}

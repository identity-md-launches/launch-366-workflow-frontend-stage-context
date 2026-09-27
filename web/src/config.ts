/**
 * Single place for deployment, chain and public RPC configuration.
 *
 * Addresses, chain id, ABI paths and the vetted network block (public RPC URLs, explorer,
 * Uniswap v4 addresses) are NOT written here: they are loaded at runtime from
 * `./imd-deployment.json`, the manifest generated from the workflow handoff by
 * `plugins/imd-deployment.ts`. Nothing else in the app may carry an address or chain id.
 *
 * The few values that the manifest schema does not carry live below and come from the same
 * handoff / launch manifest (see web/deployment/handoff.json).
 */
import type { Abi, Address, Hex } from "viem";

export interface ManifestContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
  };
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: { path: string; sha256: string }[];
  network?: NetworkBlock;
}

/** Manifest plus the ABI JSON each contract entry points at. */
export interface Deployment {
  manifest: DeploymentManifest;
  abis: Record<string, Abi>;
  /** Convenience lookups; every value is copied from `manifest.contracts`. */
  token: ManifestContract;
  funding: ManifestContract;
}

/** Contract names as they appear in the handoff / launch manifest. */
export const CONTRACT_NAMES = { token: "LaunchToken", funding: "QuadraticFunding" } as const;

/** Relative URLs so the export works from a gateway subpath or an ENS name. */
export const MANIFEST_URL = "./imd-deployment.json";

/**
 * Launch pool parameters from launch.json / the handoff manifest `pool` block. The pool is
 * hookless; currency0 is the paired currency (native ETH = zero address), currency1 is MTCH.
 */
export const LAUNCH_POOL = {
  pairedCurrency: "0x0000000000000000000000000000000000000000" as Address,
  hooks: "0x0000000000000000000000000000000000000000" as Address,
  fee: 3000,
  tickSpacing: 60,
} as const;

/** Block in which the handoff says both contracts were deployed; the log scan starts here. */
export const DEPLOYMENT_BLOCK = 11791425n;

/** Public RPCs cap eth_getLogs ranges; scan in bounded windows. */
export const LOG_WINDOW = 10_000n;

/** Optional WalletConnect project id. None is configured; browser wallets are used directly. */
export const WALLETCONNECT_PROJECT_ID: string | undefined = undefined;

/** How often live reads are refreshed while the tab is visible. */
export const REFRESH_MS = 20_000;

export function chainIdHex(chainId: number): Hex {
  return `0x${chainId.toString(16)}` as Hex;
}

/** Exact `wallet_addEthereumChain` parameters derived from the manifest's network block. */
export function walletAddChainParams(network: NetworkBlock) {
  return {
    chainId: chainIdHex(network.chainId),
    chainName: network.name,
    rpcUrls: network.rpcUrls,
    nativeCurrency: network.nativeCurrency,
    blockExplorerUrls: [network.explorer],
  };
}

export function explorerAddress(network: NetworkBlock | undefined, address: string) {
  return network ? `${network.explorer}/address/${address}` : undefined;
}

export function explorerTx(network: NetworkBlock | undefined, hash: string) {
  return network ? `${network.explorer}/tx/${hash}` : undefined;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Unable to load ${url} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** Load and validate the runtime deployment configuration and the ABIs it references. */
export async function loadDeployment(): Promise<Deployment> {
  const manifest = await fetchJson<DeploymentManifest>(MANIFEST_URL);
  if (manifest.version !== 1 || !Array.isArray(manifest.contracts)) {
    throw new Error("imd-deployment.json has an unexpected structure");
  }
  const abis: Record<string, Abi> = {};
  for (const c of manifest.contracts) {
    if (!isAddress(c.address)) throw new Error(`Contract ${c.name} has an invalid address`);
    if (c.abiPath.startsWith("/") || c.abiPath.includes("..") || c.abiPath.includes("://")) {
      throw new Error(`Contract ${c.name} has an unsafe ABI path`);
    }
    const abi = await fetchJson<Abi>(`./${c.abiPath}`);
    if (!Array.isArray(abi)) throw new Error(`ABI for ${c.name} is not a JSON array`);
    abis[c.name] = abi;
  }
  const token = manifest.contracts.find((c) => c.name === CONTRACT_NAMES.token);
  const funding = manifest.contracts.find((c) => c.name === CONTRACT_NAMES.funding);
  if (!token || !funding) throw new Error("imd-deployment.json does not list LaunchToken and QuadraticFunding");
  return { manifest, abis, token, funding };
}

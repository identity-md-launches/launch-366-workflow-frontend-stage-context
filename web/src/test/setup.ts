/**
 * Shared test environment: serves the real build inputs (handoff, network block, ABIs) through
 * a mocked fetch, routes the network's public RPC URLs to the FakeChain and injects a FakeWallet
 * as window.ethereum.
 */
import { vi } from "vitest";
import type { Abi, Address } from "viem";
import { baseManifest, loadDeploymentInputs } from "../../plugins/imd-deployment";
import { FakeChain, FakeWallet, rpcOverFetch } from "./fakeChain";

export const ACCOUNT: Address = "0x1111111111111111111111111111111111111111";
export const OTHER: Address = "0x2222222222222222222222222222222222222222";
export const PAYOUT: Address = "0x3333333333333333333333333333333333333333";
export const ETHER = 10n ** 18n;

export function manifestForTests() {
  const manifest = baseManifest();
  manifest.assets = [{ path: "index.html", sha256: "0".repeat(64) }];
  return manifest;
}

export interface TestEnv {
  chain: FakeChain;
  wallet: FakeWallet;
  manifest: ReturnType<typeof manifestForTests>;
  abis: Record<string, Abi>;
}

export function setupEnv(options: { walletChainId?: number; noWallet?: boolean; account?: Address } = {}): TestEnv {
  const manifest = manifestForTests();
  const inputs = loadDeploymentInputs();
  const abis: Record<string, Abi> = {};
  for (const a of inputs.abis) abis[a.name] = JSON.parse(a.text) as Abi;
  const token = manifest.contracts.find((c) => c.name === "LaunchToken")!.address as Address;
  const funding = manifest.contracts.find((c) => c.name === "QuadraticFunding")!.address as Address;
  const network = manifest.network as { rpcUrls: string[]; uniswapV4: { quoter: Address } };
  const chain = new FakeChain(token, funding, network.uniswapV4.quoter, abis.LaunchToken, abis.QuadraticFunding);
  const wallet = new FakeWallet(chain, options.account ?? ACCOUNT, options.walletChainId ?? 11155111);

  const w = window as unknown as { ethereum?: unknown };
  if (options.noWallet) delete w.ethereum;
  else w.ethereum = wallet;

  const norm = (u: string) => u.replace(/\/+$/, "");
  const rpcUrls = new Set(network.rpcUrls.map(norm));
  // viem builds a `Request` before calling fetch; under jsdom the AbortSignal comes from a different
  // realm than Node's undici Request and is rejected. The mocked fetch never reads the Request.
  globalThis.Request = class RequestShim {
    url: string;
    constructor(url: string | URL, public init?: RequestInit) {
      this.url = String(url);
    }
  } as unknown as typeof Request;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "./imd-deployment.json") return json(manifest);
    for (const a of inputs.abis) if (url === `./${a.path}`) return new Response(a.text, { status: 200 });
    if (rpcUrls.has(norm(url))) return rpcOverFetch(chain, String(init?.body ?? ""));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return { chain, wallet, manifest, abis };
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

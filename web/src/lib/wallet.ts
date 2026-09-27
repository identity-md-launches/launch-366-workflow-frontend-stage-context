import type { EIP1193Provider } from "viem";
import { chainIdHex, walletAddChainParams, type NetworkBlock } from "../config";

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: EIP1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

/**
 * Discover browser wallets: EIP-6963 announcements first, `window.ethereum` as the fallback.
 * Calls `onChange` with the current list whenever it grows. Returns a cleanup function.
 */
export function discoverWallets(onChange: (wallets: WalletOption[]) => void): () => void {
  const found = new Map<string, WalletOption>();
  const emit = () => onChange([...found.values()]);

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    if (!detail?.provider || found.has(detail.info.uuid)) return;
    found.set(detail.info.uuid, {
      id: detail.info.uuid,
      name: detail.info.name,
      icon: detail.info.icon,
      provider: detail.provider,
    });
    emit();
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  // Give EIP-6963 wallets a tick to announce before falling back to the legacy global.
  const timer = window.setTimeout(() => {
    if (found.size === 0 && injected) {
      found.set("injected", { id: "injected", name: "Browser wallet", provider: injected });
      emit();
    }
  }, 150);
  if (found.size === 0 && !injected) emit();

  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
  };
}

export function isUserRejection(error: unknown): boolean {
  const e = error as { code?: number; cause?: { code?: number }; message?: string; name?: string };
  return (
    e?.code === 4001 ||
    e?.cause?.code === 4001 ||
    e?.name === "UserRejectedRequestError" ||
    /user rejected|user denied|rejected the request/i.test(e?.message ?? "")
  );
}

function isUnknownChainError(error: unknown): boolean {
  const e = error as { code?: number; cause?: { code?: number }; data?: { originalError?: { code?: number } }; message?: string };
  return (
    e?.code === 4902 ||
    e?.cause?.code === 4902 ||
    e?.data?.originalError?.code === 4902 ||
    /unrecognized chain|unknown chain|not been added|4902/i.test(e?.message ?? "")
  );
}

/**
 * Ask the wallet to switch to the configured chain. When the wallet does not know the chain
 * (error 4902 or an equivalent report) offer `wallet_addEthereumChain` with the manifest's
 * network block, then switch again.
 */
export async function switchOrAddChain(provider: EIP1193Provider, network: NetworkBlock): Promise<void> {
  const chainId = chainIdHex(network.chainId);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    return;
  } catch (error) {
    if (isUserRejection(error)) throw error;
    if (!isUnknownChainError(error)) throw error;
  }
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [walletAddChainParams(network)],
  });
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
}

export async function readWalletChainId(provider: EIP1193Provider): Promise<number> {
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(hex, 16);
}

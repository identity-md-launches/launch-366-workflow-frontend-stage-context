import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, getAddress, type Address, type Chain, type WalletClient } from "viem";
import type { NetworkBlock } from "../config";
import { discoverWallets, isUserRejection, readWalletChainId, switchOrAddChain, type WalletOption } from "../lib/wallet";

export interface WalletSession {
  /** Wallets discovered in this browser. Empty means no browser wallet is installed. */
  wallets: WalletOption[];
  discovered: boolean;
  selected?: WalletOption;
  account?: Address;
  walletChainId?: number;
  /** True when the wallet is connected and on the configured chain. */
  onChain: boolean;
  connecting: boolean;
  switching: boolean;
  error?: string;
  connect: (wallet: WalletOption) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  walletClient?: WalletClient;
}

export function useWallet(chain: Chain | undefined, network: NetworkBlock | undefined): WalletSession {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [selected, setSelected] = useState<WalletOption | undefined>();
  const [account, setAccount] = useState<Address | undefined>();
  const [walletChainId, setWalletChainId] = useState<number | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const selectedRef = useRef<WalletOption | undefined>(undefined);

  useEffect(() => {
    const stop = discoverWallets((list) => {
      setWallets(list);
      setDiscovered(true);
    });
    const timer = window.setTimeout(() => setDiscovered(true), 400);
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, []);

  // Track account and chain changes from the selected wallet.
  useEffect(() => {
    selectedRef.current = selected;
    if (!selected) return;
    const provider = selected.provider as unknown as {
      on?: (event: string, cb: (arg: unknown) => void) => void;
      removeListener?: (event: string, cb: (arg: unknown) => void) => void;
    };
    const onAccounts = (arg: unknown) => {
      const list = arg as string[];
      setAccount(list.length ? getAddress(list[0]) : undefined);
    };
    const onChain = (arg: unknown) => setWalletChainId(Number.parseInt(String(arg), 16));
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [selected]);

  const connect = useCallback(async (wallet: WalletOption) => {
    setError(undefined);
    setConnecting(true);
    try {
      const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts.length) throw new Error("The wallet returned no account.");
      const chainId = await readWalletChainId(wallet.provider);
      setSelected(wallet);
      setAccount(getAddress(accounts[0]));
      setWalletChainId(chainId);
    } catch (e) {
      setError(isUserRejection(e) ? "Connection request was rejected in the wallet." : (e as Error).message);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setSelected(undefined);
    setAccount(undefined);
    setWalletChainId(undefined);
    setError(undefined);
  }, []);

  const switchChain = useCallback(async () => {
    const wallet = selectedRef.current;
    if (!wallet || !network) return;
    setError(undefined);
    setSwitching(true);
    try {
      await switchOrAddChain(wallet.provider, network);
      setWalletChainId(await readWalletChainId(wallet.provider));
    } catch (e) {
      setError(
        isUserRejection(e)
          ? "Network switch was rejected in the wallet."
          : `Unable to switch network: ${(e as Error).message}`,
      );
    } finally {
      setSwitching(false);
    }
  }, [network]);

  const onChain = !!account && !!chain && walletChainId === chain.id;

  const walletClient = useMemo(() => {
    if (!selected || !account || !chain) return undefined;
    return createWalletClient({ account, chain, transport: custom(selected.provider) });
  }, [selected, account, chain]);

  return {
    wallets,
    discovered,
    selected,
    account,
    walletChainId,
    onChain,
    connecting,
    switching,
    error,
    connect,
    disconnect,
    switchChain,
    walletClient,
  };
}

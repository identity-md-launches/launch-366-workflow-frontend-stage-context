import type { Address, PublicClient } from "viem";
import { LAUNCH_POOL, type NetworkBlock } from "../config";

/**
 * Minimal Uniswap v4 quoter binding. The quoter address always comes from the manifest's
 * network block; only the interface is fixed here. Quotes use `simulateContract` and never
 * send a transaction. There is no in-page swap: the approved page tells visitors to swap
 * Sepolia ETH for MTCH in the launch pool with their own wallet or Uniswap interface.
 */
export const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

/** Pool key for the launch pool: paired currency vs the token, sorted ascending by address. */
export function launchPoolKey(token: Address) {
  const paired = LAUNCH_POOL.pairedCurrency;
  const zeroForOne = BigInt(paired) < BigInt(token);
  const [currency0, currency1] = zeroForOne ? [paired, token] : [token, paired];
  return {
    key: { currency0, currency1, fee: LAUNCH_POOL.fee, tickSpacing: LAUNCH_POOL.tickSpacing, hooks: LAUNCH_POOL.hooks },
    /** true when the paired currency (ETH) is currency0, i.e. ETH → token swaps are zeroForOne. */
    zeroForOne,
  };
}

/** Quote how much MTCH `amountIn` of the paired currency buys. Read-only. */
export async function quoteEthToToken(
  client: PublicClient,
  network: NetworkBlock,
  token: Address,
  amountIn: bigint,
): Promise<bigint> {
  const { key, zeroForOne } = launchPoolKey(token);
  const { result } = await client.simulateContract({
    address: network.uniswapV4.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
  });
  return result[0];
}

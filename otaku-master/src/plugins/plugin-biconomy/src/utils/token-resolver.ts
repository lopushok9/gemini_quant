import { logger } from "@elizaos/core";
import {
  resolveTokenToAddress as relayResolveTokenToAddress,
  getTokenDecimals as relayGetTokenDecimals,
} from "../../../plugin-relay/src/utils/token-resolver";

/**
 * Native gas token address used by Biconomy MEE API.
 * Per Biconomy docs, native tokens use the zero address.
 * @see https://docs.biconomy.io/supertransaction-api/defi-examples
 */
export const NATIVE_TOKEN_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

/**
 * Chains that have native ETH as the gas token.
 * On these chains, "eth" should resolve to the zero address (native ETH).
 */
const NATIVE_ETH_CHAINS = new Set(["base", "ethereum", "arbitrum", "optimism"]);

/**
 * Chains where ETH refers to WETH (bridged ETH), not native gas token.
 * On Polygon, there is no native ETH - the gas token is POL.
 */
const ETH_IS_WETH_CHAINS = new Set(["polygon"]);

/**
 * WETH addresses per chain for when we need to resolve WETH explicitly
 * or when ETH should be treated as WETH (e.g., on Polygon).
 */
const WETH_ADDRESSES: Record<string, string> = {
  base: "0x4200000000000000000000000000000000000006",
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  polygon: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  optimism: "0x4200000000000000000000000000000000000006",
};

/**
 * Resolves a token symbol or address to a contract address for Biconomy MEE.
 *
 * Key differences from the relay resolver:
 * - Native ETH uses zero address (0x000...000) on ETH-native chains
 * - Only on Polygon does "eth" resolve to WETH (since Polygon has no native ETH)
 *
 * @param token - Token symbol (e.g., "eth", "usdc") or contract address
 * @param network - Network name (e.g., "base", "polygon")
 * @returns Token address or null if not found
 */
export async function resolveTokenForBiconomy(
  token: string,
  network: string,
): Promise<`0x${string}` | null> {
  const normalizedToken = token.toLowerCase().trim();
  const normalizedNetwork = network.toLowerCase().trim();

  logger.debug(
    `[Biconomy] Resolving token: ${normalizedToken} on ${normalizedNetwork}`,
  );

  // Handle zero address (native token) passed directly
  // This allows passing the zero address as a token parameter
  if (normalizedToken === NATIVE_TOKEN_ADDRESS) {
    logger.info(
      `[Biconomy] Token is already native token address (zero address) for ${normalizedNetwork}`,
    );
    return NATIVE_TOKEN_ADDRESS;
  }

  // Handle native ETH on chains that have it
  if (normalizedToken === "eth") {
    if (NATIVE_ETH_CHAINS.has(normalizedNetwork)) {
      logger.info(
        `[Biconomy] Using native ETH (zero address) for ${normalizedNetwork}`,
      );
      return NATIVE_TOKEN_ADDRESS;
    }

    if (ETH_IS_WETH_CHAINS.has(normalizedNetwork)) {
      const wethAddress = WETH_ADDRESSES[normalizedNetwork];
      if (wethAddress) {
        logger.info(
          `[Biconomy] ETH on ${normalizedNetwork} is WETH: ${wethAddress}`,
        );
        return wethAddress as `0x${string}`;
      }
    }

    // Fallback: use relay resolver (which maps to WETH)
    logger.warn(
      `[Biconomy] Unknown network ${normalizedNetwork} for ETH, falling back to relay resolver`,
    );
  }

  // Handle explicit WETH requests
  if (normalizedToken === "weth") {
    const wethAddress = WETH_ADDRESSES[normalizedNetwork];
    if (wethAddress) {
      logger.info(
        `[Biconomy] Using WETH address for ${normalizedNetwork}: ${wethAddress}`,
      );
      return wethAddress as `0x${string}`;
    }
  }

  // Handle native POL/MATIC on Polygon
  if (
    (normalizedToken === "pol" || normalizedToken === "matic") &&
    normalizedNetwork === "polygon"
  ) {
    logger.info(`[Biconomy] Using native POL (zero address) for Polygon`);
    return NATIVE_TOKEN_ADDRESS;
  }

  // For all other tokens, delegate to the relay resolver
  return relayResolveTokenToAddress(token, network);
}

/**
 * Gets token decimals, handling native tokens specially.
 *
 * @param tokenAddress - Token contract address
 * @param network - Network name
 * @returns Number of decimals (18 for native tokens, otherwise from CoinGecko)
 */
export async function getTokenDecimalsForBiconomy(
  tokenAddress: string,
  network: string,
): Promise<number> {
  // Native tokens always have 18 decimals
  if (tokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS) {
    return 18;
  }

  return relayGetTokenDecimals(tokenAddress, network);
}

/**
 * Checks if an address represents a native token.
 */
export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS;
}

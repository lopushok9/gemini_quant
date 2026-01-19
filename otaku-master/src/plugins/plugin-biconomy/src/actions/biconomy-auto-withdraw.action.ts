import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
} from "@elizaos/core";
import { parseUnits, type PublicClient, formatUnits } from "viem";
import { getEntityWallet } from "../../../../utils/entity";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { CdpNetwork } from "../../../plugin-cdp/types";
import {
  getTokenDecimals,
  getHardcodedTokens,
} from "../../../plugin-relay/src/utils/token-resolver";
import { BiconomyService } from "../services/biconomy.service";
import { type QuoteRequest, type ComposeFlow, BICONOMY_SUPPORTED_CHAINS } from "../types";
import { validateBiconomyService } from "../utils/actionHelpers";
import {
  resolveTokenForBiconomy,
  isNativeToken,
  NATIVE_TOKEN_ADDRESS,
} from "../utils/token-resolver";

// ERC20 ABI for balanceOf
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function",
  },
] as const;

// CDP network mapping (chain ID -> CDP network name)
const CDP_NETWORK_MAP: Record<number, CdpNetwork> = {
  1: "ethereum",
  8453: "base",
  10: "optimism",
  42161: "arbitrum",
  137: "polygon",
};

const resolveCdpNetworkFromChainId = (chainId: number): CdpNetwork => {
  const network = CDP_NETWORK_MAP[chainId];
  if (!network) {
    throw new Error(`CDP wallet does not support chain ID ${chainId}`);
  }
  return network;
};

// Get chain name from chain ID
const getChainNameFromId = (chainId: number): string => {
  const map: Record<number, string> = {
    1: "ethereum",
    8453: "base",
    10: "optimism",
    42161: "arbitrum",
    137: "polygon",
  };
  return map[chainId] || "unknown";
};

interface TokenBalance {
  chainId: number;
  chainName: string;
  tokenAddress: `0x${string}`;
  tokenSymbol: string;
  balance: bigint;
  decimals: number;
  isNative: boolean;
  valueUSD?: number;
}

/**
 * Get all token balances from a Nexus account on a specific chain
 * Checks common tokens (USDC, USDT, DAI, WETH, native token) + any additional tokens
 */
async function getNexusTokenBalances(
  publicClient: PublicClient,
  nexusAddress: `0x${string}`,
  chainId: number,
  chainName: string,
): Promise<TokenBalance[]> {
  const balances: TokenBalance[] = [];
  
  logger.info(`[BICONOMY_AUTO_WITHDRAW] Scanning tokens on ${chainName} (${chainId}) for Nexus ${nexusAddress}`);

  // Get hardcoded tokens for this chain
  const hardcodedTokens = getHardcodedTokens(chainName);
  
  // Priority tokens to check (most common/valuable tokens first)
  const priorityTokens = ["usdc", "usdt", "dai", "weth", "usdc.e", "usdce"];
  
  // Check native token balance first
  try {
    const nativeBalance = await publicClient.getBalance({ address: nexusAddress });
    const nativeSymbol = chainName === "polygon" ? "POL" : "ETH";
    logger.info(`[BICONOMY_AUTO_WITHDRAW] Native ${nativeSymbol} balance on ${chainName}: ${formatUnits(nativeBalance, 18)} (${nativeBalance.toString()} wei)`);
    
    if (nativeBalance > 0n) {
      logger.info(`[BICONOMY_AUTO_WITHDRAW] ✅ Adding native ${nativeSymbol} to withdrawal list`);
      balances.push({
        chainId,
        chainName,
        tokenAddress: NATIVE_TOKEN_ADDRESS as `0x${string}`,
        tokenSymbol: nativeSymbol,
        balance: nativeBalance,
        decimals: 18,
        isNative: true,
      });
    } else {
      logger.info(`[BICONOMY_AUTO_WITHDRAW] Native ${nativeSymbol} balance is zero, skipping`);
    }
  } catch (error) {
    logger.error(`[BICONOMY_AUTO_WITHDRAW] ❌ Error checking native balance on ${chainName}: ${(error as Error).message}`);
  }

  // Check priority ERC20 tokens
  for (const symbol of priorityTokens) {
    const address = hardcodedTokens[symbol];
    if (!address) continue;

    try {
      const balance = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [nexusAddress],
      }) as bigint;

      if (balance > 0n) {
        const decimals = await getTokenDecimals(address, chainName);
        const balanceFormatted = formatUnits(balance, decimals);
        logger.info(`[BICONOMY_AUTO_WITHDRAW] Found ${symbol.toUpperCase()} balance: ${balanceFormatted}`);
        
        balances.push({
          chainId,
          chainName,
          tokenAddress: address as `0x${string}`,
          tokenSymbol: symbol.toUpperCase(),
          balance,
          decimals,
          isNative: false,
        });
      }
    } catch (error) {
      logger.debug(`[BICONOMY_AUTO_WITHDRAW] Error checking ${symbol}: ${(error as Error).message}`);
    }
  }

  // Check other hardcoded tokens
  for (const [symbol, address] of Object.entries(hardcodedTokens)) {
    if (priorityTokens.includes(symbol)) continue; // Already checked

    try {
      const balance = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [nexusAddress],
      }) as bigint;

      if (balance > 0n) {
        const decimals = await getTokenDecimals(address, chainName);
        const balanceFormatted = formatUnits(balance, decimals);
        logger.info(`[BICONOMY_AUTO_WITHDRAW] Found ${symbol.toUpperCase()} balance: ${balanceFormatted}`);
        
        balances.push({
          chainId,
          chainName,
          tokenAddress: address as `0x${string}`,
          tokenSymbol: symbol.toUpperCase(),
          balance,
          decimals,
          isNative: false,
        });
      }
    } catch (error) {
      logger.debug(`[BICONOMY_AUTO_WITHDRAW] Error checking ${symbol}: ${(error as Error).message}`);
    }
  }

  return balances;
}

/**
 * Filter spam tokens based on minimum thresholds
 * Filters out tokens with very low balance (likely spam/dust)
 * Lower thresholds for auto-withdrawal to catch small balances
 */
function filterSpamTokens(balances: TokenBalance[]): TokenBalance[] {
  const SPAM_THRESHOLDS: Record<string, bigint> = {
    // Stablecoins: minimum $0.01 (0.01 tokens)
    USDC: parseUnits("0.01", 6),
    USDT: parseUnits("0.01", 6),
    DAI: parseUnits("0.01", 18),
    "USDC.E": parseUnits("0.01", 6),
    USDCE: parseUnits("0.01", 6),
    
    // WETH: minimum 0.00001 ETH (~$0.03 at $3000/ETH) - lower threshold for auto-withdraw
    WETH: parseUnits("0.00001", 18),
    
    // Native tokens: minimum 0.00001 (very low threshold to catch small balances)
    ETH: parseUnits("0.00001", 18),
    POL: parseUnits("0.001", 18), // POL is cheaper, but still low threshold
  };

  const filtered = balances.filter((balance) => {
    const threshold = SPAM_THRESHOLDS[balance.tokenSymbol] || parseUnits("0.00001", balance.decimals);
    
    if (balance.balance < threshold) {
      logger.info(
        `[BICONOMY_AUTO_WITHDRAW] Filtering out ${balance.tokenSymbol} on ${balance.chainName}: balance ${formatUnits(balance.balance, balance.decimals)} below threshold ${formatUnits(threshold, balance.decimals)}`
      );
      return false;
    }
    
    return true;
  });

  logger.info(`[BICONOMY_AUTO_WITHDRAW] Filtered ${balances.length - filtered.length} spam tokens, ${filtered.length} legitimate tokens remaining`);
  return filtered;
}

/**
 * Get token USD price from token metadata
 */
async function getTokenUsdPrice(address: string, chainName: string): Promise<number | null> {
  try {
    const { getTokenMetadata } = await import("../../../plugin-relay/src/utils/token-resolver");
    const metadata = await getTokenMetadata(address, chainName);
    return metadata?.usdPrice || null;
  } catch (error) {
    logger.debug(`[BICONOMY_AUTO_WITHDRAW] Error getting USD price: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Calculate minimum token amount needed for $0.25 USD worth
 */
async function getMinAmountInUsd(
  symbol: string,
  address: string,
  decimals: number,
  chainName: string,
): Promise<{ minAmount: bigint; usdValue: number }> {
  const lowerSymbol = symbol.toLowerCase();
  const MIN_USD_VALUE = 0.25; // $0.25 minimum
  
  // Stablecoins: assume 1:1 USD parity
  if (["usdc", "usdt", "dai", "usdce", "usdc.e"].includes(lowerSymbol)) {
    return {
      minAmount: parseUnits(MIN_USD_VALUE.toString(), decimals),
      usdValue: MIN_USD_VALUE,
    };
  }
  
  // For other tokens (WETH, WPOL, etc.), fetch actual USD price
  const usdPrice = await getTokenUsdPrice(address, chainName);
  
  if (!usdPrice || usdPrice <= 0) {
    logger.warn(`[BICONOMY_AUTO_WITHDRAW] No USD price found for ${symbol}, using fallback minimum`);
    // Fallback: use a small amount (0.0001) if price unavailable
    return {
      minAmount: parseUnits("0.0001", decimals),
      usdValue: 0,
    };
  }
  
  // Calculate how many tokens needed for $0.25
  // Formula: tokens = $0.25 / price_per_token
  const tokensNeeded = MIN_USD_VALUE / usdPrice;
  const minAmount = parseUnits(tokensNeeded.toFixed(decimals), decimals);
  
  logger.debug(`[BICONOMY_AUTO_WITHDRAW] ${symbol} price: $${usdPrice}, need ${tokensNeeded} tokens for $${MIN_USD_VALUE}`);
  
  return {
    minAmount,
    usdValue: MIN_USD_VALUE,
  };
}

/**
 * Find a suitable funding token from user's EOA balance
 * Priority: USDC → WETH/WPOL → Other stablecoins
 * Minimum requirement: $0.25 USD worth of tokens
 */
async function findFundingTokenWithBalance(
  publicClient: PublicClient,
  userAddress: `0x${string}`,
  chainName: string,
): Promise<{ symbol: string; address: `0x${string}` } | null> {
  const hardcodedTokens = getHardcodedTokens(chainName);

  // Priority order: USDC → Wrapped native → Other stablecoins
  const priorityOrder = [
    "usdc",           // 1. USDC (highest priority)
    "weth",           // 2. Wrapped ETH
    "wpol",           // 2. Wrapped POL (Polygon)
    "wmatic",         // 2. Wrapped MATIC (legacy Polygon)
    "usdt",           // 3. Other stablecoins
    "dai",
    "usdce",          // 4. Legacy/bridged USDC
    "usdc.e",
  ];
  
  // Check priority tokens first
  for (const symbol of priorityOrder) {
    const address = hardcodedTokens[symbol];
    if (!address) continue;
    
    try {
      const balance = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [userAddress],
      }) as bigint;
      
      const decimals = await getTokenDecimals(address, chainName);
      const { minAmount, usdValue } = await getMinAmountInUsd(symbol, address, decimals, chainName);
      
      if (balance >= minAmount) {
        const balanceFormatted = formatUnits(balance, decimals);
        const minFormatted = formatUnits(minAmount, decimals);
        logger.info(
          `[BICONOMY_AUTO_WITHDRAW] ✅ Found funding token on ${chainName}: ${symbol.toUpperCase()} ` +
          `balance=${balanceFormatted} (min=${minFormatted} ≈ $${usdValue.toFixed(2)})`
        );
        return { symbol, address: address as `0x${string}` };
      } else {
        const balanceFormatted = formatUnits(balance, decimals);
        const minFormatted = formatUnits(minAmount, decimals);
        logger.debug(
          `[BICONOMY_AUTO_WITHDRAW] ${chainName}: ${symbol.toUpperCase()} balance ${balanceFormatted} ` +
          `below minimum ${minFormatted} ($${usdValue.toFixed(2)})`
        );
      }
    } catch (error) {
      logger.debug(`[BICONOMY_AUTO_WITHDRAW] ${chainName}: Error checking ${symbol}: ${(error as Error).message}`);
    }
  }
  
  // Check other tokens as fallback
  for (const [symbol, address] of Object.entries(hardcodedTokens)) {
    if (priorityOrder.includes(symbol)) continue;
    
    try {
      const balance = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [userAddress],
      }) as bigint;
      
      const decimals = await getTokenDecimals(address, chainName);
      const { minAmount, usdValue } = await getMinAmountInUsd(symbol, address, decimals, chainName);
      
      if (balance >= minAmount) {
        const balanceFormatted = formatUnits(balance, decimals);
        logger.info(
          `[BICONOMY_AUTO_WITHDRAW] Found funding token on ${chainName}: ${symbol.toUpperCase()} ` +
          `balance=${balanceFormatted} (≈ $${usdValue.toFixed(2)} min)`
        );
        return { symbol, address: address as `0x${string}` };
      }
    } catch (error) {
      logger.debug(`[BICONOMY_AUTO_WITHDRAW] ${chainName}: Error checking ${symbol}: ${(error as Error).message}`);
    }
  }
  
  return null;
}

/**
 * Biconomy Auto Withdraw Action
 * 
 * Scans all supported chains for tokens in the user's Nexus Smart Account,
 * filters out spam tokens, and withdraws all legitimate tokens to the user's EOA.
 */
export const biconomyAutoWithdrawAction: Action = {
  name: "BICONOMY_AUTO_WITHDRAW",
  description: `Automatically scan all Biconomy Nexus Smart Accounts across supported chains (Ethereum, Base, Arbitrum, Optimism, Polygon) for available tokens, filter out spam/dust tokens, and withdraw all legitimate tokens to your main wallet.
This action will:
1. Check your Nexus account on each supported chain
2. Scan for common tokens (USDC, USDT, DAI, WETH, native tokens, etc.)
3. Filter out spam tokens (tokens with very low value/balance)
4. Withdraw all legitimate tokens back to your EOA wallet
No parameters needed - fully automatic!`,
  similes: [
    "AUTO_WITHDRAW_BICONOMY",
    "SWEEP_NEXUS_ACCOUNTS",
    "WITHDRAW_ALL_CHAINS",
    "CLEANUP_NEXUS_WALLETS",
  ],

  parameters: {
    fundingAmount: {
      type: "string",
      description: "Amount of funding token to use per chain for orchestration fees (e.g., '2'). System will auto-find USDC/USDT/DAI. Default: 2",
      required: false,
    },
    withdrawAddress: {
      type: "string",
      description: "Address to withdraw all tokens to. Default: user's EOA address",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateBiconomyService(runtime, "BICONOMY_AUTO_WITHDRAW", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info("[BICONOMY_AUTO_WITHDRAW] Handler invoked");

    try {
      // Get services
      const biconomyService = runtime.getService<BiconomyService>(BiconomyService.serviceType);
      if (!biconomyService) {
        callback?.({ text: "❌ Biconomy service not initialized" });
        return { text: "❌ Biconomy service not initialized", success: false, error: "service_unavailable" };
      }

      const cdpService = runtime.getService?.("CDP_SERVICE") as unknown as CdpService;
      if (!cdpService) {
        callback?.({ text: "❌ CDP service not available" });
        return { text: "❌ CDP service not available", success: false, error: "service_unavailable" };
      }

      // Extract parameters
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams || {}) as any;

      const fundingAmountPerChain = (params?.fundingAmount?.trim() || "2") as string;
      const withdrawAddressParam = params?.withdrawAddress?.trim() as string | undefined;

      callback?.({ text: "🔍 Starting auto-withdrawal scan across all chains..." });

      // Get user wallet
      const wallet = await getEntityWallet(runtime as any, message, "BICONOMY_AUTO_WITHDRAW", callback);
      if (wallet.success === false) {
        return wallet.result;
      }

      const accountName = wallet.metadata?.accountName as string;
      if (!accountName) {
        callback?.({ text: "❌ Could not resolve user wallet" });
        return { text: "❌ Could not resolve user wallet", success: false, error: "missing_wallet" };
      }

      // Get a CDP client for the default chain (Base) to get the user address
      const defaultCdpNetwork = "base";
      const defaultViemClient = await cdpService.getViemClientsForAccount({
        accountName,
        network: defaultCdpNetwork,
      });
      const userAddress = defaultViemClient.address as `0x${string}`;
      const withdrawAddress = (withdrawAddressParam || userAddress) as `0x${string}`;

      logger.info(`[BICONOMY_AUTO_WITHDRAW] User address: ${userAddress}, Withdraw to: ${withdrawAddress}`);

      // Scan all supported chains
      const supportedChains = Object.entries(BICONOMY_SUPPORTED_CHAINS);
      let totalTokensFound = 0;
      const allBalances: TokenBalance[] = [];
      const chainsWithBalances: string[] = [];

      for (const [chainName, chainId] of supportedChains) {
        try {
          callback?.({ text: `🔍 Scanning ${chainName} (${chainId})...` });
          
          // Get Nexus address for this chain
          const nexusAddress = await biconomyService.getNexusAddress(userAddress, chainId);
          if (!nexusAddress) {
            logger.info(`[BICONOMY_AUTO_WITHDRAW] No Nexus account found on ${chainName}, skipping`);
            continue;
          }

          logger.info(`[BICONOMY_AUTO_WITHDRAW] Found Nexus account on ${chainName}: ${nexusAddress}`);

          // Get viem client for this chain
          const cdpNetwork = resolveCdpNetworkFromChainId(chainId);
          const viemClient = await cdpService.getViemClientsForAccount({
            accountName,
            network: cdpNetwork,
          });
          const publicClient = viemClient.publicClient;

          // Get all token balances on this chain
          const balances = await getNexusTokenBalances(publicClient, nexusAddress, chainId, chainName);
          
          if (balances.length > 0) {
            totalTokensFound += balances.length;
            allBalances.push(...balances);
            chainsWithBalances.push(chainName);
            callback?.({ text: `✅ Found ${balances.length} token(s) on ${chainName}` });
          } else {
            callback?.({ text: `ℹ️ No tokens found on ${chainName}` });
          }
        } catch (error) {
          logger.error(`[BICONOMY_AUTO_WITHDRAW] Error scanning ${chainName}: ${(error as Error).message}`);
          callback?.({ text: `⚠️ Error scanning ${chainName}: ${(error as Error).message}` });
        }
      }

      if (allBalances.length === 0) {
        callback?.({ text: "ℹ️ No tokens found in any Nexus accounts" });
        return { 
          text: "ℹ️ No tokens found in any Nexus accounts", 
          success: true,
          data: { chainsScanned: supportedChains.length, tokensFound: 0 }
        };
      }

      callback?.({ text: `📊 Found ${totalTokensFound} total token(s) across ${chainsWithBalances.length} chain(s)` });

      // Filter spam tokens
      callback?.({ text: "🧹 Filtering spam tokens..." });
      const legitimateBalances = filterSpamTokens(allBalances);

      if (legitimateBalances.length === 0) {
        callback?.({ text: "ℹ️ All tokens filtered as spam/dust. No withdrawals needed." });
        return {
          text: "ℹ️ All tokens filtered as spam/dust. No withdrawals needed.",
          success: true,
          data: { 
            chainsScanned: supportedChains.length, 
            tokensFound: totalTokensFound,
            tokensFiltered: totalTokensFound,
          }
        };
      }

      callback?.({ text: `✅ ${legitimateBalances.length} legitimate token(s) to withdraw` });

      // Group balances by chain - execute separate withdrawals per chain
      // This matches the pattern in biconomy-withdraw-all where funding is from the same chain
      const balancesByChain: Record<number, TokenBalance[]> = {};
      for (const balance of legitimateBalances) {
        if (!balancesByChain[balance.chainId]) {
          balancesByChain[balance.chainId] = [];
        }
        balancesByChain[balance.chainId].push(balance);
      }

      const chainIds = Object.keys(balancesByChain).map(Number);
      logger.info(`[BICONOMY_AUTO_WITHDRAW] Executing ${chainIds.length} separate withdrawal(s) - one per chain with same-chain funding`);
      
      const successfulWithdrawals: Array<{ chainName: string; tokens: TokenBalance[]; supertxHash: string; explorerUrl: string }> = [];
      const failedWithdrawals: Array<{ chainName: string; error: string }> = [];

      // Execute withdrawals chain by chain
      for (const chainId of chainIds) {
        const balances = balancesByChain[chainId];
        const chainName = getChainNameFromId(chainId);
        
        callback?.({ text: `🔄 Processing ${balances.length} token(s) on ${chainName}...` });
        
        try {
          // Get viem client for this chain
          const cdpNetwork = resolveCdpNetworkFromChainId(chainId);
          const viemClient = await cdpService.getViemClientsForAccount({
            accountName,
            network: cdpNetwork,
          });
          
          // Find funding token on THIS chain (same-chain funding pattern)
          const fundingTokenInfo = await findFundingTokenWithBalance(viemClient.publicClient, userAddress, chainName);
          
          if (!fundingTokenInfo) {
            const errorMsg = `No funding token (USDC/USDT/DAI) found on ${chainName}. Need at least 1 token for gas.`;
            logger.warn(`[BICONOMY_AUTO_WITHDRAW] ${errorMsg}`);
            callback?.({ text: `⚠️ Skipping ${chainName}: ${errorMsg}` });
            failedWithdrawals.push({ chainName, error: errorMsg });
            continue;
          }
          
          callback?.({ text: `✅ Using ${fundingAmountPerChain} ${fundingTokenInfo.symbol.toUpperCase()} from ${chainName}` });
          
          // Build withdrawal flows for all tokens on this chain
          const withdrawalFlows: ComposeFlow[] = [];
          for (const balance of balances) {
            logger.info(
              `[BICONOMY_AUTO_WITHDRAW] Creating withdrawal for ${balance.tokenSymbol} on ${chainName}: ${formatUnits(balance.balance, balance.decimals)}`
            );

            if (balance.isNative) {
              const flow = biconomyService.buildNativeWithdrawalInstruction(
                balance.chainId,
                withdrawAddress,
                balance.balance.toString()
              );
              (flow as any).batch = true;
              withdrawalFlows.push(flow);
            } else {
              const flow = biconomyService.buildWithdrawalInstruction(
                balance.tokenAddress,
                balance.chainId,
                withdrawAddress
              );
              (flow as any).batch = true;
              withdrawalFlows.push(flow);
            }
          }
          
          // Get funding token decimals and amount
          const fundingDecimals = await getTokenDecimals(fundingTokenInfo.address, chainName);
          const fundingAmountWei = parseUnits(fundingAmountPerChain, fundingDecimals);

          // Build quote request with same-chain funding
          const quoteRequest: QuoteRequest = {
            mode: "eoa",
            ownerAddress: userAddress,
            composeFlows: withdrawalFlows,
            fundingTokens: [
              {
                tokenAddress: fundingTokenInfo.address,
                chainId: chainId,
                amount: fundingAmountWei.toString(),
              },
            ],
          };

          logger.info(`[BICONOMY_AUTO_WITHDRAW] Executing withdrawal on ${chainName} (${balances.length} tokens)`);
          callback?.({ text: `🔄 Executing withdrawal on ${chainName}...` });

          // Execute
          const result = await biconomyService.executeIntent(
            quoteRequest,
            viemClient.cdpAccount,
            viemClient.walletClient,
            { address: userAddress },
            viemClient.publicClient,
            (status) => callback?.({ text: status })
          );

          if (result.success && result.supertxHash) {
            const explorerUrl = biconomyService.getExplorerUrl(result.supertxHash);
            successfulWithdrawals.push({ chainName, tokens: balances, supertxHash: result.supertxHash, explorerUrl });
            callback?.({ text: `✅ ${chainName} withdrawal complete! [Track](${explorerUrl})` });
          } else {
            const errorMsg = result.error || "Unknown error";
            failedWithdrawals.push({ chainName, error: errorMsg });
            callback?.({ text: `❌ ${chainName} withdrawal failed: ${errorMsg}` });
          }
        } catch (error) {
          const errorMsg = (error as Error).message;
          logger.error(`[BICONOMY_AUTO_WITHDRAW] Error on ${chainName}: ${errorMsg}`);
          failedWithdrawals.push({ chainName, error: errorMsg });
          callback?.({ text: `❌ ${chainName} error: ${errorMsg}` });
        }
      }

      // Build summary
      const totalWithdrawn = successfulWithdrawals.reduce((sum, w) => sum + w.tokens.length, 0);
      
      let summaryText = `\n📊 **Auto-Withdrawal Summary**\n\n`;
      summaryText += `**Scanned:** ${supportedChains.length} chains\n`;
      summaryText += `**Found:** ${totalTokensFound} tokens (filtered ${totalTokensFound - legitimateBalances.length} spam)\n`;
      summaryText += `**Successful:** ${successfulWithdrawals.length}/${chainIds.length} chains, ${totalWithdrawn} tokens\n`;
      if (failedWithdrawals.length > 0) {
        summaryText += `**Failed:** ${failedWithdrawals.length} chains\n`;
      }
      
      // Successful withdrawals
      if (successfulWithdrawals.length > 0) {
        summaryText += `\n**✅ Completed:**\n`;
        for (const withdrawal of successfulWithdrawals) {
          const tokenList = withdrawal.tokens.map(t => `${formatUnits(t.balance, t.decimals)} ${t.tokenSymbol}`).join(", ");
          summaryText += `- **${withdrawal.chainName}**: ${tokenList}\n`;
          summaryText += `  [Track Transaction](${withdrawal.explorerUrl})\n`;
        }
      }
      
      // Failed withdrawals
      if (failedWithdrawals.length > 0) {
        summaryText += `\n**❌ Failed:**\n`;
        for (const failure of failedWithdrawals) {
          summaryText += `- **${failure.chainName}**: ${failure.error}\n`;
        }
      }
      
      summaryText += `\n**Withdraw Address:** \`${withdrawAddress}\`\n`;

      const isPartialSuccess = successfulWithdrawals.length > 0 && failedWithdrawals.length > 0;
      const isFullSuccess = successfulWithdrawals.length > 0 && failedWithdrawals.length === 0;
      const isFullFailure = successfulWithdrawals.length === 0;

      if (isFullSuccess) {
        callback?.({ text: summaryText, actions: ["BICONOMY_AUTO_WITHDRAW"], source: message.content.source });
      } else {
        callback?.({ text: summaryText });
      }
      
      return {
        text: summaryText,
        success: isFullSuccess || isPartialSuccess,
        error: isFullFailure ? "all_withdrawals_failed" : (isPartialSuccess ? "partial_failure" : undefined),
        data: {
          chainsScanned: supportedChains.length,
          tokensFound: totalTokensFound,
          tokensFiltered: totalTokensFound - legitimateBalances.length,
          tokensWithdrawn: totalWithdrawn,
          successfulChains: successfulWithdrawals.length,
          failedChains: failedWithdrawals.length,
          withdrawals: successfulWithdrawals.map(w => ({
            chainName: w.chainName,
            tokens: w.tokens.map(t => ({
              symbol: t.tokenSymbol,
              amount: formatUnits(t.balance, t.decimals),
              address: t.tokenAddress,
            })),
            supertxHash: w.supertxHash,
            explorerUrl: w.explorerUrl,
          })),
          failures: failedWithdrawals,
        }
      };
    } catch (error) {
      const err = error as Error;
      logger.error(`[BICONOMY_AUTO_WITHDRAW] Error: ${err.message}`);
      callback?.({ text: `❌ Error: ${err.message}` });
      return { text: `❌ Error: ${err.message}`, success: false, error: "handler_error" };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Withdraw all my tokens from Biconomy Nexus accounts" },
      },
      {
        name: "{{agent}}",
        content: { text: "Scanning all chains for tokens in your Nexus accounts...", action: "BICONOMY_AUTO_WITHDRAW" },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Clean up my Biconomy smart wallets and withdraw everything" },
      },
      {
        name: "{{agent}}",
        content: { text: "Auto-withdrawing all tokens from Nexus accounts across all chains...", action: "BICONOMY_AUTO_WITHDRAW" },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Sweep all my Nexus companion wallets" },
      },
      {
        name: "{{agent}}",
        content: { text: "Sweeping all Nexus accounts and withdrawing tokens...", action: "BICONOMY_AUTO_WITHDRAW" },
      },
    ],
  ],
};

export default biconomyAutoWithdrawAction;

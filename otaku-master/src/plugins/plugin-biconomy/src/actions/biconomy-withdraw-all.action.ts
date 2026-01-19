import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
} from "@elizaos/core";
import { parseUnits, type PublicClient } from "viem";
import { getEntityWallet } from "../../../../utils/entity";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { CdpNetwork } from "../../../plugin-cdp/types";
import {
  resolveTokenToAddress,
  getTokenDecimals,
  getHardcodedTokens,
} from "../../../plugin-relay/src/utils/token-resolver";
import { BiconomyService } from "../services/biconomy.service";
import { type QuoteRequest } from "../types";
import { validateBiconomyService } from "../utils/actionHelpers";
import {
  resolveTokenForBiconomy,
  isNativeToken,
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

/**
 * Find a suitable funding token from user's EOA balance
 * Checks hardcoded tokens (USDC, USDT, DAI, etc.) and returns the first one with balance
 * 
 * @param publicClient - Viem public client for balance checks
 * @param userAddress - User's EOA address
 * @param chainName - Chain name (e.g., "base", "ethereum")
 * @param minAmount - Minimum amount in token decimals (default: 0.5 for common tokens)
 * @returns Token symbol and address with sufficient balance, or null if none found
 */
async function findFundingTokenWithBalance(
  publicClient: PublicClient,
  userAddress: `0x${string}`,
  chainName: string,
): Promise<{ symbol: string; address: `0x${string}` } | null> {
  // Get hardcoded tokens for the chain
  const hardcodedTokens = getHardcodedTokens(chainName);
  
  // Priority order for funding tokens (prefer stablecoins)
  const priorityOrder = ["usdc", "usdt", "dai", "usdce", "usdc.e"];
  
  // Check priority tokens first
  for (const symbol of priorityOrder) {
    const address = hardcodedTokens[symbol];
    if (!address) continue;
    
    try {
      logger.debug(`[BICONOMY_WITHDRAW] Checking ${symbol.toUpperCase()} balance at ${address}`);
      
      const balance = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [userAddress],
      }) as bigint;
      
      // Get decimals to determine minimum amount
      const decimals = await getTokenDecimals(address, chainName);
      const minAmount = parseUnits("0.5", decimals); // Require at least 0.5 tokens
      
      if (balance >= minAmount) {
        logger.info(`[BICONOMY_WITHDRAW] Found funding token: ${symbol.toUpperCase()} with balance ${balance.toString()}`);
        return { symbol, address: address as `0x${string}` };
      } else {
        logger.debug(`[BICONOMY_WITHDRAW] ${symbol.toUpperCase()} balance too low: ${balance.toString()}`);
      }
    } catch (error) {
      logger.debug(`[BICONOMY_WITHDRAW] Error checking ${symbol}: ${(error as Error).message}`);
      continue;
    }
  }
  
  // Check other tokens if priority tokens not found
  for (const [symbol, address] of Object.entries(hardcodedTokens)) {
    if (priorityOrder.includes(symbol)) continue; // Already checked
    
    try {
      logger.debug(`[BICONOMY_WITHDRAW] Checking ${symbol.toUpperCase()} balance at ${address}`);
      
      const balance = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [userAddress],
      }) as bigint;
      
      // Get decimals to determine minimum amount
      const decimals = await getTokenDecimals(address, chainName);
      const minAmount = parseUnits("0.5", decimals); // Require at least 0.5 tokens
      
      if (balance >= minAmount) {
        logger.info(`[BICONOMY_WITHDRAW] Found funding token: ${symbol.toUpperCase()} with balance ${balance.toString()}`);
        return { symbol, address: address as `0x${string}` };
      } else {
        logger.debug(`[BICONOMY_WITHDRAW] ${symbol.toUpperCase()} balance too low: ${balance.toString()}`);
      }
    } catch (error) {
      logger.debug(`[BICONOMY_WITHDRAW] Error checking ${symbol}: ${(error as Error).message}`);
      continue;
    }
  }
  
  logger.warn(`[BICONOMY_WITHDRAW] No suitable funding token found with balance on ${chainName}`);
  return null;
}

/**
 * Biconomy Withdraw Action
 * 
 * Withdraws a specific token from the Nexus Smart Account to an address.
 * Parameters: chainId, tokenAddress, withdrawAddress
 */
export const biconomyWithdrawAllAction: Action = {
  name: "BICONOMY_WITHDRAW",
  description: `Withdraw a specific token from Biconomy Nexus companion wallet (Smart Account) to a specified address.
Supports both ERC20 tokens (USDC, WETH, etc.) and native gas tokens (ETH on Base/Ethereum/Arbitrum/Optimism, POL on Polygon).
- For ERC20 tokens: Withdraws full balance automatically (no amount needed)
- For native tokens (ETH, POL): MUST specify the amount parameter (e.g., amount: "0.1")
Automatically finds a suitable funding token (USDC, USDT, DAI, etc.) from your EOA balance on the same chain.
Parameters: chain, token, amount (required for native tokens), fundingAmount (optional), withdrawAddress (optional).`,
  similes: [
    "WITHDRAW_FROM_BICONOMY",
    "WITHDRAW_NEXUS_TOKEN",
    "BICONOMY_WITHDRAW_TOKEN",
  ],

  parameters: {
    chain: {
      type: "string",
      description: "Chain name (e.g., 'base', 'ethereum', 'arbitrum', 'optimism', 'polygon'). Default: base",
      required: false,
    },
    token: {
      type: "string",
      description: "Token symbol or contract address to withdraw from Smart Account (e.g., 'usdc', 'weth', 'eth', 'pol', '0x...'). Supports native tokens (ETH on Base/Ethereum/Arbitrum/Optimism, POL on Polygon).",
      required: true,
    },
    amount: {
      type: "string",
      description: "Amount to withdraw (e.g., '0.5', '100'). REQUIRED for native tokens (ETH, POL). For ERC20 tokens, omit to withdraw full balance.",
      required: false,
    },
    fundingAmount: {
      type: "string",
      description: "Amount of funding token to use from EOA for orchestration fees (e.g., '1'). System will auto-find a suitable token (USDC, USDT, DAI, etc.). Default: 1",
      required: false,
    },
    withdrawAddress: {
      type: "string",
      description: "Address to withdraw tokens to. Default: user's EOA address",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateBiconomyService(runtime, "BICONOMY_WITHDRAW", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info("[BICONOMY_WITHDRAW] Handler invoked");

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

      const chainName = (params?.chain?.toLowerCase().trim() || "base") as string;
      const tokenParam = params?.token?.toLowerCase().trim() as string;
      const amountParam = params?.amount?.trim() as string | undefined;
      const fundingAmount = (params?.fundingAmount?.trim() || "1") as string;
      const withdrawAddressParam = params?.withdrawAddress?.trim() as string | undefined;

      // Validate required params
      if (!tokenParam) {
        callback?.({ text: "❌ Missing required parameter: token (e.g., 'usdc', '0x...')" });
        return { text: "❌ Missing required parameter: token", success: false, error: "invalid_params" };
      }

      // Resolve chain ID
      const chainId = biconomyService.resolveChainId(chainName);
      if (!chainId) {
        callback?.({ text: `❌ Unsupported chain: ${chainName}` });
        return { text: `❌ Unsupported chain: ${chainName}`, success: false, error: "unsupported_chain" };
      }

      logger.info(`[BICONOMY_WITHDRAW] chain=${chainName} (${chainId}), token=${tokenParam}`);

      // Get user wallet for signing
      const wallet = await getEntityWallet(runtime as any, message, "BICONOMY_WITHDRAW", callback);
      if (wallet.success === false) {
        return wallet.result;
      }

      const accountName = wallet.metadata?.accountName as string;
      if (!accountName) {
        callback?.({ text: "❌ Could not resolve user wallet" });
        return { text: "❌ Could not resolve user wallet", success: false, error: "missing_wallet" };
      }

      // Get CDP client for signing
      const cdpNetwork = resolveCdpNetworkFromChainId(chainId);
      const viemClient = await cdpService.getViemClientsForAccount({
        accountName,
        network: cdpNetwork,
      });

      const userAddress = viemClient.address as `0x${string}`;
      const cdpAccount = viemClient.cdpAccount;
      const walletClient = viemClient.walletClient;
      const publicClient = viemClient.publicClient;

      // Determine withdraw address (default to user's EOA)
      const withdrawAddress = (withdrawAddressParam || userAddress) as `0x${string}`;

      // Resolve token address - use Biconomy resolver (handles native tokens)
      const tokenAddress = await resolveTokenForBiconomy(tokenParam, chainName);
      if (!tokenAddress) {
        callback?.({ text: `❌ Cannot resolve token: ${tokenParam} on ${chainName}` });
        return { text: `❌ Cannot resolve token: ${tokenParam} on ${chainName}`, success: false, error: "token_resolution_failed" };
      }

      // Dynamically find a funding token from user's EOA balance
      callback?.({ text: `🔍 Finding suitable funding token from your ${chainName} balance...` });
      const fundingTokenInfo = await findFundingTokenWithBalance(publicClient, userAddress, chainName);
      
      if (!fundingTokenInfo) {
        callback?.({ text: `❌ No suitable funding token found in your EOA on ${chainName}. Please have at least 0.5 USDC, USDT, or DAI available for orchestration fees.` });
        return { text: `❌ No suitable funding token found in EOA`, success: false, error: "no_funding_token" };
      }
      
      const { symbol: fundingTokenSymbol, address: fundingTokenAddress } = fundingTokenInfo;
      logger.info(`[BICONOMY_WITHDRAW] Using funding token: ${fundingTokenSymbol.toUpperCase()} at ${fundingTokenAddress}`);

      const isNativeWithdrawal = isNativeToken(tokenAddress);
      const tokenLabel = isNativeWithdrawal
        ? (chainName === "polygon" ? "POL" : "ETH")
        : tokenParam.toUpperCase();

      callback?.({ text: `🔄 Creating ${isNativeWithdrawal ? "native token" : "ERC20"} withdrawal instruction for ${tokenLabel} on ${chainName}...` });

      // Build withdrawal instruction - different method for native vs ERC20 tokens
      let withdrawalFlow;
      if (isNativeWithdrawal) {
        // Native token (ETH, POL) withdrawal requires specifying the amount
        // Cannot use runtimeErc20Balance with native tokens - Biconomy API rejects zero address
        logger.info(`[BICONOMY_WITHDRAW] Using native token withdrawal for ${tokenLabel} on ${chainName}`);
        
        // Amount is REQUIRED for native tokens
        if (!amountParam) {
          callback?.({ text: `❌ Amount is required for native token (${tokenLabel}) withdrawals. Please specify the amount (e.g., amount: "0.1" for 0.1 ${tokenLabel})` });
          return { text: `❌ Amount required for native token withdrawal`, success: false, error: "missing_amount" };
        }
        
        // Parse amount to wei (18 decimals for native tokens)
        const amountFloat = Number(amountParam);
        if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
          callback?.({ text: `❌ Invalid amount: ${amountParam}. Please provide a positive number.` });
          return { text: `❌ Invalid amount`, success: false, error: "invalid_amount" };
        }
        
        const amountInWei = parseUnits(amountParam, 18);
        callback?.({ text: `💰 Withdrawing ${amountParam} ${tokenLabel} from Nexus` });
        
        // Build native withdrawal with specified amount using ETH Forwarder contract
        withdrawalFlow = biconomyService.buildNativeWithdrawalInstruction(
          chainId,
          withdrawAddress,
          amountInWei.toString()
        );
      } else {
        // ERC20 token withdrawal using runtimeErc20Balance (withdraws full balance)
        withdrawalFlow = biconomyService.buildWithdrawalInstruction(
          tokenAddress,
          chainId,
          withdrawAddress
        );
      }

      // Get funding token decimals and amount
      const fundingDecimals = await getTokenDecimals(fundingTokenAddress, chainName);
      const fundingAmountWei = parseUnits(fundingAmount, fundingDecimals);

      // Build quote request - include fundingTokens but omit feeToken (like swap action)
      const quoteRequest: QuoteRequest = {
        mode: "eoa",
        ownerAddress: userAddress,
        composeFlows: [withdrawalFlow],
        fundingTokens: [
          {
            tokenAddress: fundingTokenAddress,
            chainId: chainId,
            amount: fundingAmountWei.toString(),
          },
        ],
        // feeToken omitted - uses Biconomy's default handling
      };

      callback?.({ text: `🔄 Getting quote (funding: ${fundingAmount} ${fundingTokenSymbol.toUpperCase()} from your EOA)...` });

      // Execute
      const result = await biconomyService.executeIntent(
        quoteRequest,
        cdpAccount,
        walletClient,
        { address: userAddress },
        publicClient,
        (status) => callback?.({ text: status })
      );

      if (result.success && result.supertxHash) {
        const explorerUrl = biconomyService.getExplorerUrl(result.supertxHash);
        const chainDisplayName = biconomyService.getChainName(chainId);

        const tokenDisplay = isNativeWithdrawal
          ? `${tokenLabel} (native)`
          : `${tokenLabel} (\`${tokenAddress}\`)`;

        const responseText = `
✅ **Withdrawal Executed**

**Chain:** ${chainDisplayName} (${chainId})
**Token:** ${tokenDisplay}
**To:** \`${withdrawAddress}\`

**Supertx Hash:** \`${result.supertxHash}\`
**Track:** [MEE Explorer](${explorerUrl})
        `.trim();

        callback?.({ text: responseText, actions: ["BICONOMY_WITHDRAW"], source: message.content.source });
        return { 
          text: responseText, 
          success: true, 
          data: { 
            supertxHash: result.supertxHash, 
            explorerUrl,
            chainId,
            tokenAddress,
            withdrawAddress,
          } 
        };
      } else {
        const errorMsg = result.error || "Unknown error";
        callback?.({ text: `❌ Execution failed: ${errorMsg}` });
        return { text: `❌ Execution failed: ${errorMsg}`, success: false, error: "execution_failed" };
      }
    } catch (error) {
      const err = error as Error;
      logger.error(`[BICONOMY_WITHDRAW] Error: ${err.message}`);
      callback?.({ text: `❌ Error: ${err.message}` });
      return { text: `❌ Error: ${err.message}`, success: false, error: "handler_error" };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Withdraw USDC from Biconomy on Base to my wallet" },
      },
      {
        name: "{{agent}}",
        content: { text: "Withdrawing USDC from Nexus Smart Account...", action: "BICONOMY_WITHDRAW" },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Withdraw 0.05 ETH from Biconomy Nexus on Arbitrum" },
      },
      {
        name: "{{agent}}",
        content: { text: "Withdrawing 0.05 native ETH from Nexus Smart Account on Arbitrum...", action: "BICONOMY_WITHDRAW" },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Withdraw 10 POL from Biconomy on Polygon" },
      },
      {
        name: "{{agent}}",
        content: { text: "Withdrawing 10 native POL from Nexus Smart Account on Polygon...", action: "BICONOMY_WITHDRAW" },
      },
    ],
  ],
};

export default biconomyWithdrawAllAction;

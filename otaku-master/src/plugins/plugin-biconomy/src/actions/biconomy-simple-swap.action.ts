import {
  type Action,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
} from "@elizaos/core";
import { formatUnits, parseUnits } from "viem";
import { BiconomyService } from "../services/biconomy.service";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { type QuoteRequest } from "../types";
import { tryGetBaseUsdcFeeToken } from "../utils/fee-token";
import {
  DEFAULT_SLIPPAGE,
  validateSlippage,
  slippageToDecimal,
} from "../utils/slippage";
import { CdpNetwork } from "../../../plugin-cdp/types";
import { getEntityWallet } from "../../../../utils/entity";
import {
  resolveTokenForBiconomy,
  getTokenDecimalsForBiconomy,
  isNativeToken,
  NATIVE_TOKEN_ADDRESS,
} from "../utils/token-resolver";
import {
  validateBiconomyService,
  getValidatedViemClients,
} from "../utils/actionHelpers";

// CDP network mapping
const CDP_NETWORK_MAP: Record<string, CdpNetwork> = {
  ethereum: "ethereum",
  base: "base",
  optimism: "optimism",
  arbitrum: "arbitrum",
  polygon: "polygon",
  "base-sepolia": "base-sepolia",
};

const resolveCdpNetwork = (chainName: string): CdpNetwork => {
  const network = CDP_NETWORK_MAP[chainName.toLowerCase().trim()];
  if (!network) {
    throw new Error(
      `CDP wallet does not support signing transactions on ${chainName}`,
    );
  }
  return network;
};

/**
 * MEE Fusion Swap Action
 *
 * Executes a gasless cross-chain swap using Biconomy's MEE (Modular Execution Environment).
 * Uses the intent-simple instruction for single input to single output swaps.
 * Gas is paid from the input token - no native gas required.
 */
export const meeFusionSwapAction: Action = {
  name: "MEE_FUSION_SWAP",
  description: `Execute a gasless cross-chain token swap via Biconomy MEE (Modular Execution Environment). Use this for:
- Swapping tokens from one chain to another (e.g., "Swap 100 USDC on Base to ETH on Arbitrum")
- Cross-chain bridges with automatic token conversion
- Gasless swaps - gas is paid from the input token, no native gas needed
Native gas tokens: ETH on Base/Ethereum/Arbitrum/Optimism, POL on Polygon. On Polygon only, 'ETH' means bridged WETH (no native ETH exists on Polygon).`,
  similes: [
    "MEE_SWAP",
    "FUSION_SWAP",
    "GASLESS_SWAP",
    "BICONOMY_SWAP",
    "CROSS_CHAIN_SWAP",
    "SUPERTRANSACTION_SWAP",
  ],

  parameters: {
    srcToken: {
      type: "string",
      description:
        "Source token symbol or address (e.g., 'usdc', 'eth', '0x...'). Native gas tokens: ETH on Base/Ethereum/Arbitrum/Optimism, POL on Polygon. On Polygon, 'eth' means bridged WETH.",
      required: true,
    },
    srcChain: {
      type: "string",
      description:
        "Source chain name (ethereum, base, arbitrum, polygon, optimism)",
      required: true,
    },
    dstToken: {
      type: "string",
      description:
        "Destination token symbol or address (e.g., 'eth', 'usdc', '0x...'). Native gas tokens: ETH on Base/Ethereum/Arbitrum/Optimism, POL on Polygon. On Polygon, 'eth' means bridged WETH.",
      required: true,
    },
    dstChain: {
      type: "string",
      description:
        "Destination chain name (ethereum, base, arbitrum, polygon, optimism)",
      required: true,
    },
    amount: {
      type: "string",
      description:
        "Amount to swap in human-readable format (e.g., '100' for 100 USDC, not in wei)",
      required: true,
    },
    slippage: {
      type: "number",
      description:
        "Slippage tolerance as percentage (e.g., 1 for 1%, 5 for 5%). Default: 1. Max: 5% unless confirmed.",
      required: false,
    },
    confirmHighSlippage: {
      type: "boolean",
      description:
        "Set to true to confirm slippage above 5%. Required if slippage > 5.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateBiconomyService(runtime, "MEE_FUSION_SWAP", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[MEE_FUSION_SWAP] Handler invoked");

    try {
      // Get services
      const biconomyService = runtime.getService<BiconomyService>(
        BiconomyService.serviceType,
      );
      if (!biconomyService) {
        const errorMsg = "MEE service not initialized";
        logger.error(`[MEE_FUSION_SWAP] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "service_unavailable",
        };
      }

      const cdpService = runtime.getService?.(
        "CDP_SERVICE",
      ) as unknown as CdpService;
      if (
        !cdpService ||
        typeof cdpService.getViemClientsForAccount !== "function"
      ) {
        const errorMsg = "CDP service not available";
        logger.error(`[MEE_FUSION_SWAP] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "service_unavailable",
        };
      }

      // Extract parameters from state
      const composedState = await runtime.composeState(
        message,
        ["ACTION_STATE"],
        true,
      );
      const params = composedState?.data?.actionParams || {};

      // Validate required parameters
      const srcToken = params?.srcToken?.toLowerCase().trim();
      const srcChain = params?.srcChain?.toLowerCase().trim();
      const dstToken = params?.dstToken?.toLowerCase().trim();
      const dstChain = params?.dstChain?.toLowerCase().trim();
      const amount = params?.amount?.trim();
      const slippage = params?.slippage ?? DEFAULT_SLIPPAGE;
      // Ensure confirmHighSlippage is strictly boolean for safety
      const confirmHighSlippage =
        typeof params?.confirmHighSlippage === "boolean"
          ? params.confirmHighSlippage
          : false;

      // Input parameters object for response
      const inputParams = {
        srcToken,
        srcChain,
        dstToken,
        dstChain,
        amount,
        slippage,
        confirmHighSlippage,
      };

      // Validate slippage - max 5% unless explicitly confirmed or detected via LLM in messages
      const slippageValidation = await validateSlippage(
        runtime,
        slippage,
        confirmHighSlippage,
        inputParams,
        "MEE_FUSION_SWAP",
        callback,
        state,
      );
      if (!slippageValidation.valid) {
        return slippageValidation.errorResult!;
      }

      // Validation
      if (!srcToken) {
        const errorMsg =
          "Missing required parameter 'srcToken'. Please specify the source token (e.g., 'usdc', 'eth').";
        logger.error(`[MEE_FUSION_SWAP] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult;
      }

      if (!srcChain) {
        const errorMsg =
          "Missing required parameter 'srcChain'. Please specify the source chain (e.g., 'base', 'ethereum').";
        logger.error(`[MEE_FUSION_SWAP] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult;
      }

      if (!dstToken) {
        const errorMsg =
          "Missing required parameter 'dstToken'. Please specify the destination token (e.g., 'weth', 'usdt').";
        logger.error(`[MEE_FUSION_SWAP] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult;
      }

      if (!dstChain) {
        const errorMsg =
          "Missing required parameter 'dstChain'. Please specify the destination chain (e.g., 'arbitrum', 'optimism').";
        logger.error(`[MEE_FUSION_SWAP] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult;
      }

      if (!amount) {
        const errorMsg =
          "Missing required parameter 'amount'. Please specify the amount to swap (e.g., '100').";
        logger.error(`[MEE_FUSION_SWAP] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult;
      }

      const amountFloat = Number(amount);
      if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
        const errorMsg = "Amount must be a positive number (e.g., '100').";
        logger.error(`[MEE_FUSION_SWAP] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "invalid_amount",
          input: inputParams,
        } as ActionResult;
      }

      // Resolve chain IDs
      const srcChainId = biconomyService.resolveChainId(srcChain);
      const dstChainId = biconomyService.resolveChainId(dstChain);

      if (!srcChainId) {
        const errorMsg = `Unsupported source chain: ${srcChain}. Supported: ethereum, base, arbitrum, polygon, optimism`;
        logger.error(`[MEE_FUSION_SWAP] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "unsupported_chain",
          input: inputParams,
        } as ActionResult;
      }

      if (!dstChainId) {
        const errorMsg = `Unsupported destination chain: ${dstChain}. Supported: ethereum, base, arbitrum, polygon, optimism`;
        logger.error(`[MEE_FUSION_SWAP] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "unsupported_chain",
          input: inputParams,
        } as ActionResult;
      }

      // Get user wallet
      const wallet = await getEntityWallet(
        runtime as any,
        message,
        "MEE_FUSION_SWAP",
        callback,
      );
      if (wallet.success === false) {
        logger.warn("[MEE_FUSION_SWAP] Entity wallet verification failed");
        return { ...wallet.result, input: inputParams } as ActionResult & {
          input: typeof inputParams;
        };
      }

      const accountName = wallet.metadata?.accountName as string;
      if (!accountName) {
        const errorMsg = "Could not resolve user wallet";
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_wallet",
          input: inputParams,
        } as ActionResult;
      }

      // Get viem clients and validate CDP account matches entity wallet
      const cdpNetwork = resolveCdpNetwork(srcChain);
      const viemResult = await getValidatedViemClients(
        cdpService,
        accountName,
        cdpNetwork,
        wallet,
        "MEE_FUSION_SWAP",
        inputParams,
        callback,
      );
      if (!viemResult.success) {
        return viemResult.error;
      }
      const { userAddress, cdpAccount, walletClient, publicClient } =
        viemResult;

      const preferredFeeTokenResult = await tryGetBaseUsdcFeeToken(
        cdpService,
        accountName,
      );
      if (preferredFeeTokenResult?.usedBaseUsdc) {
        callback?.({
          text: "🪙 Using Base USDC to pay Biconomy orchestration fees",
        });
      }

      // Resolve token addresses using Biconomy-specific resolver
      // This handles native ETH as zero address on ETH-native chains,
      // and only maps ETH→WETH on Polygon (which has no native ETH)
      const srcTokenAddress = await resolveTokenForBiconomy(srcToken, srcChain);
      if (!srcTokenAddress) {
        const errorMsg = `Cannot resolve source token: ${srcToken} on ${srcChain}`;
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "token_resolution_failed",
          input: inputParams,
        } as ActionResult;
      }

      const dstTokenAddress = await resolveTokenForBiconomy(dstToken, dstChain);
      if (!dstTokenAddress) {
        const errorMsg = `Cannot resolve destination token: ${dstToken} on ${dstChain}`;
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "token_resolution_failed",
          input: inputParams,
        } as ActionResult;
      }

      // Get token decimals (native tokens are 18, others from CoinGecko)
      const decimals = await getTokenDecimalsForBiconomy(
        srcTokenAddress,
        srcChain,
      );

      const amountInWei = parseUnits(amount, decimals);

      const onChainBalance = await cdpService.getOnChainBalance({
        accountName,
        network: cdpNetwork,
        tokenAddress: srcTokenAddress as `0x${string}`,
        walletAddress: userAddress,
      });

      if (onChainBalance <= 0n) {
        const errorMsg = `No ${srcToken.toUpperCase()} balance available on ${srcChain}`;
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "insufficient_balance",
          input: inputParams,
        } as ActionResult;
      }

      let swapAmountInWei = amountInWei;
      if (amountInWei > onChainBalance) {
        swapAmountInWei = onChainBalance;
        const balanceHuman = formatUnits(onChainBalance, decimals);
        callback?.({
          text: `🧮 Input exceeds on-chain balance; using ${balanceHuman} ${srcToken.toUpperCase()} available on ${srcChain}`,
        });
      }

      // Build simple intent flow
      const swapFlow = biconomyService.buildSimpleIntentFlow(
        srcChainId,
        dstChainId,
        srcTokenAddress,
        dstTokenAddress,
        swapAmountInWei.toString(),
        slippageToDecimal(slippage),
      );

      // Build withdrawal instruction to transfer output tokens back to EOA
      // Without this, tokens remain in the Biconomy Nexus/Smart Account
      const composeFlows: (typeof swapFlow)[] = [swapFlow];

      // Track if output is native token and withdrawal details
      const isNativeOutput = isNativeToken(dstTokenAddress);
      let minOutputAmount: string | undefined;
      let gasBufferWei: bigint | undefined;

      if (!isNativeOutput) {
        // ERC20 withdrawal using runtimeErc20Balance (works dynamically)
        const withdrawalFlow = biconomyService.buildWithdrawalInstruction(
          dstTokenAddress,
          dstChainId,
          userAddress,
        );
        composeFlows.push(withdrawalFlow);
        
        // Build and execute quote request
        const quoteRequest: QuoteRequest = {
          mode: "eoa",
          ownerAddress: userAddress,
          composeFlows,
          fundingTokens: [
            {
              tokenAddress: srcTokenAddress,
              chainId: srcChainId,
              amount: swapAmountInWei.toString(),
            },
          ],
        };

        callback?.({ text: `🔄 Getting quote from MEE...` });

        // Execute the intent
        var result = await biconomyService.executeIntent(
          quoteRequest,
          cdpAccount,
          walletClient,
          { address: userAddress },
          publicClient,
          (status) => callback?.({ text: status }),
        );
      } else {
        // Native token output - requires two-step process:
        // 1. Get quote to determine output amount
        // 2. Add fixed-amount withdrawal using minOutputAmount minus gas buffer
        logger.info(
          `[MEE_FUSION_SWAP] Native token output - using two-step quote process`,
        );
        
        callback?.({ text: `🔄 Getting quote from MEE...` });
        
        // Step 1: Get quote WITHOUT withdrawal to determine output
        const initialQuoteRequest: QuoteRequest = {
          mode: "eoa",
          ownerAddress: userAddress,
          composeFlows: [swapFlow],
          fundingTokens: [
            {
              tokenAddress: srcTokenAddress,
              chainId: srcChainId,
              amount: swapAmountInWei.toString(),
            },
          ],
        };
        
        const quoteResponse = await biconomyService.getQuote(initialQuoteRequest);
        
        // Extract minimum output amount
        minOutputAmount = quoteResponse.returnedData[0]?.minOutputAmount;
        if (!minOutputAmount) {
          throw new Error("Could not determine output amount from quote");
        }
        
        logger.info(`[MEE_FUSION_SWAP] Min output: ${minOutputAmount} wei native token`);
        
        // Calculate withdrawal amount: leave dynamic buffer for gas
        // Use 15% of output as buffer, with min 0.0001 ETH and max 0.002 ETH
        const minOutputBigInt = BigInt(minOutputAmount);
        const percentageBuffer = (minOutputBigInt * BigInt(15)) / BigInt(100); // 15%
        const minBufferWei = BigInt("100000000000000"); // 0.0001 ETH
        const maxBufferWei = BigInt("2000000000000000"); // 0.002 ETH
        
        gasBufferWei = percentageBuffer;
        if (gasBufferWei < minBufferWei) gasBufferWei = minBufferWei;
        if (gasBufferWei > maxBufferWei) gasBufferWei = maxBufferWei;
        
        // Ensure we have enough to withdraw after buffer
        const minWithdrawableWei = BigInt("50000000000000"); // 0.00005 ETH minimum to make withdrawal worthwhile
        
        if (minOutputBigInt <= gasBufferWei + minWithdrawableWei) {
          // Output too small to auto-withdraw
          logger.warn(`[MEE_FUSION_SWAP] Output amount ${minOutputAmount} wei too small for auto-withdrawal (need >${gasBufferWei + minWithdrawableWei} wei)`);
          callback?.({
            text: `⚠️ Output amount too small for auto-withdrawal. Swap will execute but you'll need to manually withdraw from Biconomy after.`,
          });
          
          // Execute without withdrawal
          var result = await biconomyService.executeIntent(
            initialQuoteRequest,
            cdpAccount,
            walletClient,
            { address: userAddress },
            publicClient,
            (status) => callback?.({ text: status }),
          );
        } else {
          const withdrawAmountWei = (minOutputBigInt - gasBufferWei).toString();
          const bufferEth = Number(gasBufferWei) / 1e18;
          const withdrawEth = Number(withdrawAmountWei) / 1e18;
          logger.info(`[MEE_FUSION_SWAP] Withdrawing ${withdrawEth.toFixed(6)} ${dstChain === "polygon" ? "POL" : "ETH"} (leaving ${bufferEth.toFixed(6)} for gas)`);
          
          // Step 2: Add native withdrawal with fixed amount
          const nativeWithdrawalFlow = biconomyService.buildNativeWithdrawalInstruction(
            dstChainId,
            userAddress,
            withdrawAmountWei,
          );
          composeFlows.push(nativeWithdrawalFlow);
          
          // Build final quote request with withdrawal
          const finalQuoteRequest: QuoteRequest = {
            mode: "eoa",
            ownerAddress: userAddress,
            composeFlows,
            fundingTokens: [
              {
                tokenAddress: srcTokenAddress,
                chainId: srcChainId,
                amount: swapAmountInWei.toString(),
              },
            ],
          };
          
          callback?.({ text: `🔄 Re-quoting with auto-withdrawal...` });
          
          // Execute with withdrawal
          var result = await biconomyService.executeIntent(
            finalQuoteRequest,
            cdpAccount,
            walletClient,
            { address: userAddress },
            publicClient,
            (status) => callback?.({ text: status }),
          );
        }
      }

      if (result.success && result.supertxHash) {
        const explorerUrl = biconomyService.getExplorerUrl(result.supertxHash);

        const gasTokenDescription = preferredFeeTokenResult?.usedBaseUsdc
          ? "Base USDC"
          : `${srcToken.toUpperCase()} on ${srcChain}`;

        // Add native token buffer note if applicable
        const nativeTokenNote = isNativeOutput && minOutputAmount
          ? `\n\n_Note: A small gas buffer (~${(Number(gasBufferWei) / 1e18).toFixed(4)} ${dstChain === "polygon" ? "POL" : "ETH"}) remains in your Biconomy Nexus for future transactions._`
          : '';

        const responseText = `
✅ **MEE Fusion Swap Executed**

**From:** ${amount} ${srcToken.toUpperCase()} on ${srcChain}
**To:** ${dstToken.toUpperCase()} on ${dstChain}
**Slippage:** ${slippage}%
**Gas:** Paid in ${gasTokenDescription}

**Supertx Hash:** \`${result.supertxHash}\`
**Track:** [MEE Explorer](${explorerUrl})${nativeTokenNote}
        `.trim();

        callback?.({
          text: responseText,
          actions: ["MEE_FUSION_SWAP"],
          source: message.content.source,
        });

        return {
          text: responseText,
          success: true,
          data: {
            supertxHash: result.supertxHash,
            explorerUrl,
            srcChain,
            dstChain,
            srcToken,
            dstToken,
            amount,
          },
          values: {
            swapSuccess: true,
            supertxHash: result.supertxHash,
          },
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      } else {
        const errorMsg = result.error || "Unknown execution error";
        callback?.({ text: `❌ Execution failed: ${errorMsg}` });
        return {
          text: `❌ Execution failed: ${errorMsg}`,
          success: false,
          error: "execution_failed",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }
    } catch (error) {
      const err = error as Error;
      logger.error(`[MEE_FUSION_SWAP] Handler error: ${err.message}`);

      // Try to capture input params even in failure
      let failureInputParams = {};
      try {
        const composedState = await runtime.composeState(
          message,
          ["ACTION_STATE"],
          true,
        );
        const params = composedState?.data?.actionParams || {};
        failureInputParams = {
          srcToken: params?.srcToken,
          srcChain: params?.srcChain,
          dstToken: params?.dstToken,
          dstChain: params?.dstChain,
          amount: params?.amount,
          slippage: params?.slippage,
          confirmHighSlippage: params?.confirmHighSlippage,
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }

      callback?.({ text: `❌ Error: ${err.message}` });
      return {
        text: `❌ Error: ${err.message}`,
        success: false,
        error: "handler_error",
        input: failureInputParams,
      } as ActionResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Swap 100 USDC on Base to ETH on Arbitrum",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll execute a gasless swap of 100 USDC from Base to ETH on Arbitrum via MEE...",
          action: "MEE_FUSION_SWAP",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Bridge 0.5 ETH from Ethereum to USDC on Optimism",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Executing gasless cross-chain swap of 0.5 ETH from Ethereum to USDC on Optimism...",
          action: "MEE_FUSION_SWAP",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Swap 50 USDT on Polygon to WETH on Base",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll execute a gasless cross-chain swap from Polygon USDT to WETH on Base...",
          action: "MEE_FUSION_SWAP",
        },
      },
    ],
  ],
};

export default meeFusionSwapAction;

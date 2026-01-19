import { IAgentRuntime, logger, Service } from "@elizaos/core";
import {
  type WalletClient,
  type TypedDataDomain,
  type Account,
  type PublicClient,
} from "viem";
import {
  type ComposeFlow,
  type ExecuteResponse,
  type PayloadToSign,
  type QuoteRequest,
  type QuoteResponse,
  type SupertxStatus,
  BICONOMY_SUPPORTED_CHAINS,
  CHAIN_ID_TO_NAME,
} from "../types";

/**
 * CDP Account interface - minimal interface for signing
 * Note: The domain type is made flexible to support both viem and CDP SDK types
 */
interface CdpAccount {
  address: string;
  signTypedData: (params: {
    domain: {
      name?: string;
      version?: string;
      chainId?: number | bigint;
      verifyingContract?: `0x${string}`;
      salt?: `0x${string}`;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>;
}

const BICONOMY_API_URL = "https://api.biconomy.io";
const EXPLORER_URL = "https://meescan.biconomy.io";
const BPS_DENOMINATOR = 10_000n;
const FUNDING_RETRY_INCREMENT_BPS = 250n; // +2.5% per retry
const FUNDING_RETRY_MAX_ATTEMPTS = 3;

type HttpResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

/**
 * Biconomy Service
 * Provides integration with Biconomy's Supertransaction API for multi-chain
 * portfolio operations, swaps, and cross-chain transfers.
 */
export class BiconomyService extends Service {
  static serviceType = "biconomy_supertransaction" as const;

  private apiKey?: string;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  get capabilityDescription(): string {
    return "Multi-chain portfolio rebalancing and cross-chain operations via Biconomy Supertransaction API. Supports intent-based swaps, bridging, and complex multi-token operations across Ethereum, Base, Arbitrum, Polygon, Optimism, BSC, and more.";
  }

  static async start(runtime: IAgentRuntime): Promise<BiconomyService> {
    logger.info(
      "[BICONOMY SERVICE] Starting Biconomy Supertransaction service",
    );
    const service = new BiconomyService(runtime);
    await service.initialize(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info("[BICONOMY SERVICE] Stopping Biconomy service");
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.apiKey = runtime.getSetting("BICONOMY_API_KEY");
    if (!this.apiKey) {
      logger.warn(
        "[BICONOMY SERVICE] No BICONOMY_API_KEY found. Some features may be limited.",
      );
    }
    logger.info("[BICONOMY SERVICE] Initialized successfully");
  }

  /**
   * Get a quote for a supertransaction
   */
  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    // Log wallet/owner info and request params BEFORE making the quote request
    const ownerAddr = request.ownerAddress || "unknown";
    const fundingInfo =
      request.fundingTokens?.map((ft) => ({
        token: ft.tokenAddress,
        chainId: ft.chainId,
        amount: ft.amount,
      })) || [];
    const flowsSummary =
      request.composeFlows?.map((flow) => ({
        type: flow.type,
        data: flow.data,
      })) || [];

    logger.info(`[BICONOMY SERVICE] ========== QUOTE REQUEST ==========`);
    logger.info(`[BICONOMY SERVICE] Owner/Wallet: ${ownerAddr}`);
    logger.info(`[BICONOMY SERVICE] Mode: ${request.mode}`);
    logger.info(
      `[BICONOMY SERVICE] Funding tokens: ${JSON.stringify(fundingInfo)}`,
    );
    logger.info(
      `[BICONOMY SERVICE] Compose flows: ${JSON.stringify(flowsSummary)}`,
    );
    if (request.feeToken) {
      logger.info(
        `[BICONOMY SERVICE] Fee token: ${JSON.stringify(request.feeToken)}`,
      );
    }

    try {
      const response = (await fetch(`${BICONOMY_API_URL}/v1/quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "X-API-Key": this.apiKey }),
        },
        body: JSON.stringify(request),
      })) as HttpResponse;

      if (!response.ok) {
        const errorText = await response.text();
        // Log rejection with full params
        logger.error(`[BICONOMY SERVICE] ========== QUOTE REJECTED ==========`);
        logger.error(`[BICONOMY SERVICE] Owner/Wallet: ${ownerAddr}`);
        logger.error(`[BICONOMY SERVICE] Status: ${response.status}`);
        logger.error(`[BICONOMY SERVICE] Error: ${errorText}`);
        logger.error(
          `[BICONOMY SERVICE] Full request params: ${JSON.stringify(request, null, 2)}`,
        );
        logger.error(`[BICONOMY SERVICE] ===================================`);

        throw new Error(
          `Quote request failed: ${response.status} ${errorText}`,
        );
      }

      const quote = (await response.json()) as QuoteResponse;

      logger.info(
        `[BICONOMY SERVICE] Quote received - type: ${quote.quoteType}, payloads to sign: ${quote.payloadToSign.length}`,
      );
      logger.debug(
        `[BICONOMY SERVICE] Returned data: ${JSON.stringify(quote.returnedData)}`,
      );

      return quote;
    } catch (error) {
      const err = error as Error;
      // If not already logged (i.e., not from response.ok check), log here
      if (!err.message.includes("Quote request failed:")) {
        logger.error(`[BICONOMY SERVICE] ========== QUOTE ERROR ==========`);
        logger.error(`[BICONOMY SERVICE] Owner/Wallet: ${ownerAddr}`);
        logger.error(`[BICONOMY SERVICE] Error: ${err.message}`);
        logger.error(
          `[BICONOMY SERVICE] Full request params: ${JSON.stringify(request, null, 2)}`,
        );
        logger.error(`[BICONOMY SERVICE] =================================`);
      }
      throw new Error(`Failed to get Biconomy quote: ${err.message}`);
    }
  }

  /**
   * Sign payloads based on quote type
   *
   * @param quote - Quote response from Biconomy API
   * @param cdpAccount - CDP account object for signing (preferred)
   * @param walletClient - Viem wallet client (fallback for non-CDP wallets)
   * @param account - Account address (required if using walletClient)
   */
  async signPayloads(
    quote: QuoteResponse,
    cdpAccount?: CdpAccount,
    walletClient?: WalletClient,
    account?: { address: `0x${string}` },
    publicClient?: PublicClient,
  ): Promise<PayloadToSign[]> {
    const signedPayloads: PayloadToSign[] = [];

    // Validate that we have either CDP account or wallet client
    if (!cdpAccount && !walletClient) {
      throw new Error("Either cdpAccount or walletClient must be provided");
    }

    for (const payload of quote.payloadToSign) {
      let signature: string;

      const signTypedPayload = async (): Promise<string> => {
        const signablePayload = payload.signablePayload;
        if (!signablePayload) {
          throw new Error("Missing signable payload");
        }
        if (typeof signablePayload.message === "string") {
          throw new Error(
            "Expected typed data payload but received simple message",
          );
        }

        if (cdpAccount) {
          logger.info(
            `[BICONOMY SERVICE] Signing typed data using CDP account native method`,
          );
          return cdpAccount.signTypedData({
            domain: signablePayload.domain as TypedDataDomain,
            types: signablePayload.types as Record<
              string,
              Array<{ name: string; type: string }>
            >,
            primaryType: signablePayload.primaryType,
            message: signablePayload.message as Record<string, unknown>,
          });
        }

        if (walletClient) {
          const walletAccount = this.getWalletAccount(walletClient, account);
          if (!walletAccount) {
            throw new Error(
              "Wallet client account is required for signing typed payloads",
            );
          }
          logger.info(
            `[BICONOMY SERVICE] Signing typed data using viem wallet client`,
          );
          return walletClient.signTypedData({
            account: walletAccount,
            domain: signablePayload.domain as TypedDataDomain,
            types: signablePayload.types as Record<
              string,
              Array<{ name: string; type: string }>
            >,
            primaryType: signablePayload.primaryType,
            message: signablePayload.message,
          });
        }

        throw new Error("No valid signer available for typed payload");
      };

      switch (quote.quoteType) {
        case "permit":
          signature = await signTypedPayload();
          break;
        case "simple": {
          const rawMessage = payload.signablePayload?.message;
          if (typeof rawMessage === "string") {
            signature = await this.signSimpleMessage(
              rawMessage,
              walletClient,
              account,
            );
          } else {
            signature = await signTypedPayload();
          }
          break;
        }

        case "onchain": {
          signature = await this.executeOnchainPayload(
            payload,
            walletClient,
            account,
            publicClient,
          );
          break;
        }

        default:
          throw new Error(`Unknown quote type: ${quote.quoteType}`);
      }

      signedPayloads.push({
        ...payload,
        signature,
      });
    }

    return signedPayloads;
  }

  private getWalletAccount(
    walletClient?: WalletClient,
    account?: { address: `0x${string}` },
  ): Account | `0x${string}` | undefined {
    if (!walletClient) {
      return account?.address;
    }

    const walletAccount = (walletClient as WalletClient & { account?: unknown })
      .account;
    return walletAccount ?? account?.address;
  }

  private async signSimpleMessage(
    message: string,
    walletClient?: WalletClient,
    account?: { address: `0x${string}` },
  ): Promise<`0x${string}`> {
    if (!walletClient || typeof walletClient.signMessage !== "function") {
      throw new Error(
        "Simple payload signing requires a wallet client with signMessage support",
      );
    }

    const walletAccount = this.getWalletAccount(walletClient, account);
    if (!walletAccount) {
      throw new Error(
        "Wallet client account is required for signing simple payloads",
      );
    }

    return walletClient.signMessage({
      account: walletAccount,
      message,
    });
  }

  private async executeOnchainPayload(
    payload: PayloadToSign,
    walletClient?: WalletClient,
    account?: { address: `0x${string}` },
    publicClient?: PublicClient,
  ): Promise<`0x${string}`> {
    if (!walletClient || typeof walletClient.sendTransaction !== "function") {
      throw new Error(
        "Onchain approval requires a wallet client capable of sending transactions",
      );
    }

    const walletAccount = this.getWalletAccount(walletClient, account);
    if (!walletAccount) {
      throw new Error(
        "Wallet client account is required for onchain approvals",
      );
    }

    const to = payload.to;
    const data = payload.data;
    if (!to || !data) {
      throw new Error("Onchain payload missing transaction target or calldata");
    }

    const chainIdFromPayload = payload.chainId;
    const walletChainId = (walletClient.chain as { id?: number } | undefined)
      ?.id;
    if (
      chainIdFromPayload &&
      walletChainId &&
      chainIdFromPayload !== walletChainId
    ) {
      throw new Error(
        `Chain mismatch: wallet is on chain ${walletChainId} but transaction targets chain ${chainIdFromPayload}. Cannot execute cross-chain transaction with wrong wallet configuration.`,
      );
    }

    const value = this.parseOnchainValue(payload.value);
    const gasOverride = payload.gasLimit ? BigInt(payload.gasLimit) : undefined;

    logger.info("[BICONOMY SERVICE] Sending onchain approval transaction...");
    const txHash = await walletClient.sendTransaction({
      account: walletAccount,
      to,
      data,
      value,
      chain: walletClient.chain,
      ...(gasOverride ? { gas: gasOverride } : {}),
    } as any);

    if (
      publicClient &&
      typeof publicClient.waitForTransactionReceipt === "function"
    ) {
      logger.info("[BICONOMY SERVICE] Waiting for approval receipt...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    }

    logger.info(`[BICONOMY SERVICE] Onchain approval confirmed: ${txHash}`);
    return txHash;
  }

  private parseOnchainValue(value?: string | number | bigint): bigint {
    if (value === undefined || value === null) {
      return 0n;
    }

    if (typeof value === "bigint") {
      return value;
    }

    if (typeof value === "number") {
      return BigInt(value);
    }

    const serialized = value.toString().trim();
    if (serialized.length === 0) {
      return 0n;
    }

    try {
      return BigInt(serialized);
    } catch (error) {
      logger.warn(
        `[BICONOMY SERVICE] Failed to parse onchain value "${value}", defaulting to 0`,
      );
      return 0n;
    }
  }

  /**
   * Execute a supertransaction
   */
  async execute(
    quote: QuoteResponse,
    signedPayloads: PayloadToSign[],
  ): Promise<ExecuteResponse> {
    try {
      logger.info(
        `[BICONOMY SERVICE] Executing supertransaction for ${quote.ownerAddress}`,
      );

      const executeRequest = {
        ...quote,
        payloadToSign: signedPayloads,
      };

      const response = (await fetch(`${BICONOMY_API_URL}/v1/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "X-API-Key": this.apiKey }),
        },
        body: JSON.stringify(executeRequest),
      })) as HttpResponse;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Execute request failed: ${response.status} ${errorText}`,
        );
      }

      const result = (await response.json()) as ExecuteResponse;

      if (result.success && result.supertxHash) {
        logger.info(
          `[BICONOMY SERVICE] Supertransaction executed: ${result.supertxHash}`,
        );
        logger.info(
          `[BICONOMY SERVICE] Track at: ${EXPLORER_URL}/details/${result.supertxHash}`,
        );
      } else {
        logger.error(`[BICONOMY SERVICE] Execution failed: ${result.error}`);
      }

      return result;
    } catch (error) {
      const err = error as Error;
      logger.error(`[BICONOMY SERVICE] Failed to execute: ${err.message}`);
      throw new Error(
        `Failed to execute Biconomy supertransaction: ${err.message}`,
      );
    }
  }

  /**
   * Get status of a supertransaction
   */
  async getStatus(supertxHash: string): Promise<SupertxStatus> {
    try {
      logger.info(`[BICONOMY SERVICE] Getting status for ${supertxHash}`);

      const response = (await fetch(
        `https://network.biconomy.io/v1/explorer/${supertxHash}`,
        {
          headers: {
            "Content-Type": "application/json",
            ...(this.apiKey && { "X-API-Key": this.apiKey }),
          },
        },
      )) as HttpResponse;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Status request failed: ${response.status} ${errorText}`,
        );
      }

      const status = (await response.json()) as SupertxStatus;
      logger.info(`[BICONOMY SERVICE] Status: ${status.status}`);

      return status;
    } catch (error) {
      const err = error as Error;
      logger.error(`[BICONOMY SERVICE] Failed to get status: ${err.message}`);
      throw new Error(`Failed to get supertransaction status: ${err.message}`);
    }
  }

  /**
   * Execute a full flow: get quote, sign, execute
   *
   * @param request - Quote request
   * @param cdpAccount - CDP account for signing (preferred - signs on Coinbase servers)
   * @param walletClient - Viem wallet client (fallback for non-CDP wallets)
   * @param account - Account address (required if using walletClient)
   * @param publicClient - Viem public client for waiting on onchain approvals
   * @param onProgress - Progress callback
   */
  async executeIntent(
    request: QuoteRequest,
    cdpAccount?: CdpAccount,
    walletClient?: WalletClient,
    account?: { address: `0x${string}` },
    publicClient?: PublicClient,
    onProgress?: (status: string) => void,
  ): Promise<ExecuteResponse> {
    try {
      // Step 1: Get quote (auto-retrying if funding buffer is insufficient)
      const quote = await this.getQuoteWithFundingRetries(request, onProgress);

      // Step 2: Sign payloads
      onProgress?.(`Signing ${quote.payloadToSign.length} payload(s)...`);
      const signedPayloads = await this.signPayloads(
        quote,
        cdpAccount,
        walletClient,
        account,
        publicClient,
      );

      // Step 3: Execute
      onProgress?.("Executing supertransaction...");
      const result = await this.execute(quote, signedPayloads);

      if (result.success) {
        onProgress?.(`Success! Transaction: ${result.supertxHash}`);
      } else {
        onProgress?.(`Failed: ${result.error}`);
      }

      return result;
    } catch (error) {
      const err = error as Error;
      logger.error(
        `[BICONOMY SERVICE] Intent execution failed: ${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Build a simple intent flow (single input to single output)
   */
  buildSimpleIntentFlow(
    srcChainId: number,
    dstChainId: number,
    srcToken: string,
    dstToken: string,
    amount: string,
    slippage: number = 0.01,
  ): ComposeFlow {
    return {
      type: "/instructions/intent-simple",
      data: {
        srcChainId,
        dstChainId,
        srcToken,
        dstToken,
        amount,
        slippage,
      },
      batch: true,
    };
  }

  /**
   * Build a withdrawal instruction to transfer output tokens from the Nexus/Smart Account back to EOA
   * This is REQUIRED for EOA mode - without it, funds remain in the Smart Account
   *
   * For ERC20 tokens: Uses 'runtimeErc20Balance' to transfer the full balance at execution time
   * For native tokens (ETH): Uses the ETH Forwarder contract
   *
   * @see https://docs.biconomy.io/supertransaction-api/execution-modes/eoa
   * @see https://docs.biconomy.io/supertransaction-api/endpoints/build (Native ETH Withdrawal section)
   */
  buildWithdrawalInstruction(
    tokenAddress: string,
    chainId: number,
    recipientAddress: string,
    upperBoundTimestamp?: number,
  ): ComposeFlow {
    return {
      type: "/instructions/build",
      data: {
        functionSignature: "function transfer(address to, uint256 value)",
        args: [
          recipientAddress,
          {
            type: "runtimeErc20Balance",
            tokenAddress: tokenAddress,
            constraints: { gte: "1" }, // Ensure at least 1 wei to transfer
          },
        ],
        to: tokenAddress,
        chainId: chainId,
        gasLimit: "100000", // Standard ERC20 transfer gas
        ...(upperBoundTimestamp && { upperBoundTimestamp }),
      },
    };
  }

  /**
   * ETH Forwarder contract address - same across all supported chains
   * Used to withdraw native tokens (ETH, MATIC, etc.) from Nexus to EOA
   * @see https://docs.biconomy.io/supertransaction-api/endpoints/build
   */
  private static readonly ETH_FORWARDER_ADDRESS =
    "0x000000Afe527A978Ecb761008Af475cfF04132a1";

  /**
   * Build a native token withdrawal instruction using the ETH Forwarder contract
   *
   * IMPORTANT: For native tokens (ETH, POL, etc.), you cannot use ERC20 transfer().
   * Must use the ETH Forwarder contract's forward() function.
   *
   * @param chainId - Chain ID for execution
   * @param recipientAddress - Address to receive the native tokens
   * @param amount - Amount in wei to forward (must be specified, no runtime balance for native)
   * @see https://docs.biconomy.io/supertransaction-api/endpoints/build
   */
  buildNativeWithdrawalInstruction(
    chainId: number,
    recipientAddress: string,
    amount: string,
  ): ComposeFlow {
    return {
      type: "/instructions/build",
      data: {
        functionSignature: "function forward(address recipient)",
        args: [recipientAddress],
        to: BiconomyService.ETH_FORWARDER_ADDRESS,
        chainId: chainId,
        value: amount, // Amount in wei to forward
        gasLimit: "300000", // Higher gas for native forwarding
      },
    };
  }

  /**
   * Build a native token withdrawal instruction with runtime balance
   * 
   * Uses ETH Forwarder with runtimeErc20Balance for native token (zero address).
   * Pattern: forward(address) signature but with TWO args - recipient + runtimeErc20Balance.
   * Biconomy internally handles converting the runtime balance to msg.value.
   * 
   * @param chainId - Chain ID for execution
   * @param recipientAddress - Address to receive the native tokens (EOA)
   * @param _nexusAddress - Nexus companion account address (unused, kept for signature compatibility)
   * @see https://docs.biconomy.io/supertransaction-api/endpoints/build
   */
  buildNativeWithdrawalInstructionWithRuntimeBalance(
    chainId: number,
    recipientAddress: string,
    _nexusAddress: string,
  ): ComposeFlow {
    return {
      type: "/instructions/build",
      data: {
        functionSignature: "function forward(address recipient)",
        args: [
          recipientAddress,
          {
            type: "runtimeErc20Balance",
            tokenAddress: BiconomyService.NATIVE_TOKEN_ADDRESS, // Zero address for native token
            constraints: { gte: "1" }, // Ensure at least 1 wei
          },
        ],
        to: BiconomyService.ETH_FORWARDER_ADDRESS,
        chainId: chainId,
        value: "0", // Value determined by runtimeErc20Balance
        gasLimit: "300000",
      },
    };
  }

  /**
   * Native token address (zero address)
   */
  static readonly NATIVE_TOKEN_ADDRESS =
    "0x0000000000000000000000000000000000000000";

  /**
   * Get the Nexus (Smart Account) address for an EOA
   * 
   * Uses Biconomy's /v1/mee/orchestrator endpoint to get the Nexus address for a specific chain.
   * Returns the latest version (2.2.1) address preferably, or falls back to older versions.
   * 
   * @param ownerAddress - EOA address
   * @param chainId - Chain ID to query
   * @returns Nexus address or null if not found
   * @see https://docs.biconomy.io/supertransaction-api/endpoints/orchestrator
   */
  async getNexusAddress(
    ownerAddress: string,
    chainId: number,
  ): Promise<`0x${string}` | null> {
    try {
      logger.info(`[BICONOMY SERVICE] Getting Nexus address for ${ownerAddress} on chain ${chainId}`);
      
      const response = await fetch(
        `${BICONOMY_API_URL}/v1/mee/orchestrator`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.apiKey && { "X-API-Key": this.apiKey }),
          },
          body: JSON.stringify({ ownerAddress }),
        },
      ) as HttpResponse;

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`[BICONOMY SERVICE] Failed to get Nexus address: ${response.status} - ${errorText}`);
        return null;
      }

      const data = await response.json() as {
        ownerAddress: string;
        deployments: Array<{
          chainId: number;
          chainName: string;
          addressVersion: string;
          address: string;
          isDeployed: boolean;
          isUpgradeNeeded?: boolean;
        }>;
      };

      // Find deployments for the requested chain
      const deploymentsForChain = data.deployments?.filter(d => d.chainId === chainId) || [];
      
      if (deploymentsForChain.length === 0) {
        logger.warn(`[BICONOMY SERVICE] No Nexus deployment found for chain ${chainId}`);
        return null;
      }

      // Prefer the latest version (2.2.1) or already deployed accounts
      const latestDeployment = deploymentsForChain.find(d => d.addressVersion === "2.2.1") 
        || deploymentsForChain.find(d => d.isDeployed) 
        || deploymentsForChain[0];

      if (latestDeployment?.address) {
        logger.info(`[BICONOMY SERVICE] Found Nexus address: ${latestDeployment.address} (v${latestDeployment.addressVersion}, deployed: ${latestDeployment.isDeployed})`);
        return latestDeployment.address as `0x${string}`;
      }

      logger.warn(`[BICONOMY SERVICE] No valid Nexus address found for chain ${chainId}`);
      return null;
    } catch (error) {
      logger.warn(`[BICONOMY SERVICE] Error getting Nexus address: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Build a multi-position intent flow
   */
  buildMultiIntentFlow(
    inputPositions: Array<{
      chainId: number;
      tokenAddress: string;
      amount: string;
    }>,
    targetPositions: Array<{
      chainId: number;
      tokenAddress: string;
      weight: number;
    }>,
    slippage: number = 0.01,
  ): ComposeFlow {
    return {
      type: "/instructions/intent",
      data: {
        slippage,
        inputPositions: inputPositions.map((p) => ({
          chainToken: {
            chainId: p.chainId,
            tokenAddress: p.tokenAddress,
          },
          amount: p.amount,
        })),
        targetPositions: targetPositions.map((p) => ({
          chainToken: {
            chainId: p.chainId,
            tokenAddress: p.tokenAddress,
          },
          weight: p.weight,
        })),
      },
    };
  }

  /**
   * Build a CCIP bridge flow using Chainlink's Cross-Chain Interoperability Protocol
   *
   * Bridges tokens from source chain to destination chain via CCIP.
   *
   * **IMPORTANT**: Only supports CCIP-compatible tokens on the specific lane.
   * Common CCIP tokens: USDC, LINK, WETH, WBTC, DAI
   * Not all tokens are supported on all chain pairs.
   *
   * CCIP fees are always paid in the native token of the source chain.
   * Bridge finality typically takes 15-22 minutes.
   *
   * @see https://docs.biconomy.io/supertransaction-api/endpoints/build-ccip
   * @see https://docs.chain.link/ccip/supported-networks
   */
  buildCcipBridgeFlow(
    srcChainId: number,
    dstChainId: number,
    srcToken: string,
    dstToken: string,
    amount: string,
  ): ComposeFlow {
    return {
      type: "/instructions/build-ccip",
      data: {
        srcChainId,
        dstChainId,
        srcToken,
        dstToken,
        amount,
      },
    };
  }

  /**
   * Get explorer URL for a supertransaction
   */
  getExplorerUrl(supertxHash: string): string {
    return `${EXPLORER_URL}/details/${supertxHash}`;
  }

  /**
   * Get supported chains
   */
  getSupportedChains(): Record<string, number> {
    return BICONOMY_SUPPORTED_CHAINS;
  }

  /**
   * Resolve chain name to chain ID
   */
  resolveChainId(chainName: string): number | null {
    const normalized = chainName.toLowerCase().trim();
    return BICONOMY_SUPPORTED_CHAINS[normalized] ?? null;
  }

  /**
   * Get chain name from chain ID
   */
  getChainName(chainId: number): string {
    return CHAIN_ID_TO_NAME[chainId] || `Chain ${chainId}`;
  }

  private async getQuoteWithFundingRetries(
    request: QuoteRequest,
    onProgress?: (status: string) => void,
  ): Promise<QuoteResponse> {
    let currentRequest = this.cloneQuoteRequest(request);
    const ownerAddr = request.ownerAddress || "unknown";

    for (let attempt = 0; attempt <= FUNDING_RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const attemptLabel =
          attempt === 0
            ? "Getting quote from Biconomy..."
            : `Getting quote (retry ${attempt})...`;
        onProgress?.(attemptLabel);
        logger.info(
          `[BICONOMY SERVICE] Quote attempt ${attempt + 1}/${FUNDING_RETRY_MAX_ATTEMPTS + 1} for wallet: ${ownerAddr}`,
        );
        return await this.getQuote(currentRequest);
      } catch (error) {
        const err = error as Error;
        const canRetry =
          attempt < FUNDING_RETRY_MAX_ATTEMPTS &&
          !!currentRequest.fundingTokens?.length &&
          this.isFundingShortfallError(err);

        if (!canRetry) {
          logger.error(
            `[BICONOMY SERVICE] ========== QUOTE FAILED (NO RETRY) ==========`,
          );
          logger.error(`[BICONOMY SERVICE] Owner/Wallet: ${ownerAddr}`);
          logger.error(
            `[BICONOMY SERVICE] Attempt: ${attempt + 1}/${FUNDING_RETRY_MAX_ATTEMPTS + 1}`,
          );
          logger.error(`[BICONOMY SERVICE] Error: ${err.message}`);
          logger.error(
            `[BICONOMY SERVICE] Can retry: false (funding shortfall: ${this.isFundingShortfallError(err)}, has funding tokens: ${!!currentRequest.fundingTokens?.length})`,
          );
          logger.error(
            `[BICONOMY SERVICE] ==============================================`,
          );
          throw err;
        }

        currentRequest = this.applyFundingRetryBuffer(
          currentRequest,
          FUNDING_RETRY_INCREMENT_BPS,
        );
        const cumulativeBps = FUNDING_RETRY_INCREMENT_BPS * BigInt(attempt + 1);
        const retryMessage = `Funding shortfall detected. Increasing funding buffer to +${this.formatBps(
          cumulativeBps,
        )}% and retrying...`;
        logger.warn(`[BICONOMY SERVICE] ${retryMessage}`);
        onProgress?.(retryMessage);
      }
    }

    throw new Error("Failed to obtain Biconomy quote after funding retries");
  }

  private cloneQuoteRequest(request: QuoteRequest): QuoteRequest {
    return {
      ...request,
      composeFlows: [...request.composeFlows],
      fundingTokens: request.fundingTokens?.map((token) => ({ ...token })),
      feeToken: request.feeToken ? { ...request.feeToken } : undefined,
    };
  }

  private isFundingShortfallError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("insufficient funding amount") ||
      message.includes("not enough eoa balance to pay orchestration fee")
    );
  }

  private applyFundingRetryBuffer(
    request: QuoteRequest,
    incrementBps: bigint,
  ): QuoteRequest {
    if (!request.fundingTokens?.length) {
      return request;
    }

    const multiplier = BPS_DENOMINATOR + incrementBps;
    return {
      ...request,
      fundingTokens: request.fundingTokens.map((token) => {
        try {
          const current = BigInt(token.amount);
          const adjusted =
            (current * multiplier + (BPS_DENOMINATOR - 1n)) / BPS_DENOMINATOR;
          return {
            ...token,
            amount: adjusted.toString(),
          };
        } catch (parseError) {
          logger.warn(
            `[BICONOMY SERVICE] Unable to increase funding token amount "${token.amount}": ${
              (parseError as Error).message
            }`,
          );
          return token;
        }
      }),
    };
  }

  private formatBps(bps: bigint): string {
    return (Number(bps) / 100).toFixed(2);
  }
}

export default BiconomyService;

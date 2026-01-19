/**
 * Action Helper Utilities
 *
 * Shared utilities for Biconomy plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, type State, type HandlerCallback, type ActionResult, logger } from "@elizaos/core";
import { BiconomyService } from "../services/biconomy.service";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import type { CdpNetwork } from "../../../plugin-cdp/types";
import { shouldBiconomyPluginBeInContext } from "../matcher";
import type { EntityWalletResult } from "../../../../utils/entity";

/**
 * Validate that Biconomy service and CDP service are available and plugin context is active
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns True if services are available and plugin context is active
 */
export function validateBiconomyService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldBiconomyPluginBeInContext(state, message)) {
      return false;
    }

    const service = runtime.getService(
      BiconomyService.serviceType
    ) as BiconomyService;

    if (!service) {
      logger.warn(`[${actionName}] Biconomy service not available`);
      return false;
    }

    const cdpService = runtime.getService(
      CdpService.serviceType
    ) as unknown as CdpService;

    if (!cdpService) {
      logger.warn(`[${actionName}] CDP service not available`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(
      `[${actionName}] Error validating action:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Get Biconomy service from runtime
 *
 * @param runtime - Agent runtime
 * @returns Biconomy service instance or null
 */
export function getBiconomyService(
  runtime: IAgentRuntime
): BiconomyService | null {
  return runtime.getService(
    BiconomyService.serviceType
  ) as BiconomyService | null;
}

/**
 * Extract parameters from composed state
 *
 * @param runtime - Agent runtime
 * @param message - Memory message
 * @returns Action parameters object
 */
export async function extractActionParams<T>(
  runtime: IAgentRuntime,
  message: Memory
): Promise<Partial<T>> {
  const composedState = await runtime.composeState(
    message,
    ["ACTION_STATE"],
    true
  );
  return (composedState?.data?.actionParams ?? {}) as Partial<T>;
}

/**
 * Result of getValidatedViemClients when successful
 */
export interface ValidatedViemClientsSuccess {
  success: true;
  userAddress: `0x${string}`;
  cdpAccount: {
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
  };
  walletClient: any;
  publicClient: any;
}

/**
 * Result of getValidatedViemClients when failed
 */
export interface ValidatedViemClientsError {
  success: false;
  error: ActionResult;
}

export type ValidatedViemClientsResult = ValidatedViemClientsSuccess | ValidatedViemClientsError;

/**
 * Get viem clients and validate CDP account matches entity wallet address.
 * 
 * This function ensures the CDP account used for signing matches the wallet address
 * from entity metadata. If they don't match, signing would fail since CDP account
 * can only sign for its own address.
 * 
 * @param cdpService - CDP service instance
 * @param accountName - Account name for CDP lookup
 * @param network - CDP network
 * @param wallet - Entity wallet result (must have walletAddress)
 * @param actionName - Action name for logging
 * @param inputParams - Input params to include in error result
 * @param callback - Optional callback for error messages
 * @returns Validated viem clients or error result
 */
export async function getValidatedViemClients(
  cdpService: CdpService,
  accountName: string,
  network: CdpNetwork,
  wallet: EntityWalletResult,
  actionName: string,
  inputParams: Record<string, unknown>,
  callback?: HandlerCallback
): Promise<ValidatedViemClientsResult> {
  const viemClient = await cdpService.getViemClientsForAccount({
    accountName,
    network,
  });

  // Use wallet address from entity metadata for balance checks
  // The CDP account lookup may return a different address if accountName doesn't correctly
  // map to the original CDP account (e.g., for users created before migration fix)
  const userAddress = wallet.walletAddress as `0x${string}`;
  
  // Validate that CDP account matches entity wallet address
  // If they don't match, signing will fail since CDP account can only sign for its own address
  if (viemClient.address.toLowerCase() !== userAddress.toLowerCase()) {
    const errorMsg = `Wallet account mismatch detected. CDP account (${viemClient.address.substring(0, 10)}...) does not match entity wallet (${userAddress.substring(0, 10)}...). This user may need their account re-linked.`;
    logger.error(`[${actionName}] ${errorMsg}`);
    callback?.({ text: `❌ ${errorMsg}` });
    return {
      success: false,
      error: {
        text: `❌ ${errorMsg}`,
        success: false,
        error: "account_mismatch",
        input: inputParams,
      } as ActionResult,
    };
  }

  return {
    success: true,
    userAddress,
    cdpAccount: viemClient.cdpAccount,
    walletClient: viemClient.walletClient,
    publicClient: viemClient.publicClient,
  };
}

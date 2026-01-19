import type { Plugin } from "@elizaos/core";
import {
  meeFusionSwapAction,
  meeSupertransactionRebalanceAction,
  meeSupertransactionStatusAction,
  biconomyWithdrawAllAction,
  biconomyAutoWithdrawAction,
} from "./actions/index";
import { BiconomyService } from "./services/biconomy.service";

/**
 * MEE (Modular Execution Environment) Plugin
 * 
 * Provides Biconomy MEE integration for gasless cross-chain operations:
 * - Gasless swaps - gas is paid from the input token
 * - Cross-chain token swaps and bridges via Fusion
 * - Multi-output portfolio rebalancing via Supertransactions
 * 
 * Actions:
 * - MEE_FUSION_SWAP: Gasless cross-chain token swap (single input → single output)
 * - MEE_SUPERTRANSACTION_REBALANCE: Gasless multi-chain portfolio rebalancing (single input → multiple weighted outputs)
 * - MEE_SUPERTRANSACTION_STATUS: Track supertransaction status
 * - BICONOMY_WITHDRAW_ALL: Withdraw specific token from Nexus companion wallet to user address
 * - BICONOMY_AUTO_WITHDRAW: Automatically scan and withdraw all tokens from all Nexus accounts across all chains
 * 
 * Supported Chains:
 * Ethereum, Base, Arbitrum, Polygon, Optimism, Scroll.
 * 
 * @see https://docs.biconomy.io
 */
export const meePlugin: Plugin = {
  name: "mee",
  description:
    "Biconomy MEE (Modular Execution Environment) plugin for gasless cross-chain swaps and portfolio rebalancing",
  actions: [meeFusionSwapAction, biconomyWithdrawAllAction, biconomyAutoWithdrawAction, meeSupertransactionRebalanceAction, meeSupertransactionStatusAction],
  services: [BiconomyService],
  evaluators: [],
  providers: [],
};

export default meePlugin;

// Re-export types and service for external use
export { BiconomyService } from "./services/biconomy.service";
export * from "./types";
export { shouldBiconomyPluginBeInContext } from "./matcher";


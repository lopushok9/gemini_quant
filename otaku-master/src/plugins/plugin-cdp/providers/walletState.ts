import type { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";
import { getEntityWallet } from "../../../utils/entity";

export const walletStateProvider: Provider = {
  name: "WALLET_STATE",
  description: "Indicates whether the user has an active Coinbase CDP wallet and its details",
  dynamic: true,
  get: async (runtime: IAgentRuntime, message: Memory, _state: State) => {

    const walletResult = await getEntityWallet(
      runtime,
      message,
      "WALLET_STATE",
      undefined, // Don't pass callback here to avoid duplicate messages
    );

    let hasWallet = false;

    if (walletResult.success) {

      hasWallet = true;
    } else {
      hasWallet = false;
    }

    const walletAddress = walletResult.success ? walletResult.walletAddress : "";

    const text = hasWallet
      ? ` Wallet is set up and ready. Address: \`${walletAddress}\` (provider: "cdp").`
      : " To use on-chain features, the user needs a Coinbase CDP wallet. Ask to create one by signing in.";

    return {
      text,
      data: { hasWallet, walletAddress },
      values: { hasWallet: String(hasWallet), walletAddress },
    };
  },
};

export default walletStateProvider;



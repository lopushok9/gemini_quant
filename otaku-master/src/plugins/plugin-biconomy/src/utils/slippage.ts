import { 
  type ActionResult, 
  type HandlerCallback, 
  type State, 
  type IAgentRuntime,
  ModelType,
  logger 
} from "@elizaos/core";

export const DEFAULT_SLIPPAGE = 1; // 1%
export const MIN_SLIPPAGE = 0.01; // 0.01% minimum
export const MAX_SLIPPAGE_WITHOUT_CONFIRMATION = 5; // 5%
export const ABSOLUTE_MAX_SLIPPAGE = 50; // 50% hard cap - cannot exceed even with confirmation

export interface SlippageValidationResult {
  valid: boolean;
  errorResult?: ActionResult;
}

/**
 * Use LLM to detect user consent for high slippage in recent messages.
 * Analyzes conversation context to determine if user has agreed to proceed.
 * 
 * @param runtime - Agent runtime for LLM access
 * @param state - Current state with recent messages
 * @returns true if user consent detected via LLM analysis
 */
async function detectUserConsentViaLLM(
  runtime: IAgentRuntime,
  state?: State
): Promise<boolean> {
  if (!state?.recentMessagesData) return false;

  // Get last 3 user messages
  const recentMessages = state.recentMessagesData
    .filter((msg: any) => msg.userId !== msg.agentId) // Only user messages
    .slice(-3)
    .map((msg: any) => msg.content?.text || '')
    .filter((text: string) => text.trim().length > 0);

  if (recentMessages.length === 0) return false;

  // Build prompt for LLM to analyze consent
  const prompt = `Analyze if the user has given consent to proceed with a high-risk action (specifically high slippage in a trade).

Recent user messages:
${recentMessages.map((text: string, i: number) => `${i + 1}. "${text}"`).join('\n')}

Does the user's recent message(s) indicate they want to proceed despite the warning? Look for:
- Affirmative responses (yes, ok, proceed, confirm, go ahead, do it, etc.)
- Understanding of risk (I understand, I know, that's fine, etc.)
- Impatience or insistence (just do it, whatever, I don't care, etc.)

Respond with ONLY "YES" if consent is clearly given, or "NO" if not.`;

  try {
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
      messages: [
        {
          role: 'system',
          content: 'You are a consent detection assistant. Analyze user messages and respond with only YES or NO.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 10,
      temperature: 0.1,
    });

    const answer = (response || '').toString().trim().toUpperCase();
    logger.debug(`[Slippage] LLM consent detection: ${answer}`);
    
    return answer === "YES";
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[Slippage] Error detecting consent via LLM: ${errorMsg}`);
    return false;
  }
}

/**
 * Creates an error result for slippage validation failures.
 */
function createSlippageError(
  errorMsg: string,
  errorCode: string,
  inputParams: Record<string, unknown>,
  actionName: string,
  callback?: HandlerCallback
): SlippageValidationResult {
  logger.warn(`[${actionName}] Slippage validation failed: ${errorCode}`);
  callback?.({ text: errorMsg });
  return {
    valid: false,
    errorResult: {
      text: errorMsg,
      success: false,
      error: errorCode,
      input: inputParams,
    } as ActionResult,
  };
}

/**
 * Validates slippage percentage value.
 *
 * Validation rules:
 * - Must be a valid number (not NaN)
 * - Must be positive (> 0)
 * - Must not exceed 100%
 * - Must not exceed 50% (absolute max) even with confirmation
 * - Must not exceed 5% without explicit confirmation (uses LLM to detect consent in recent messages)
 *
 * @param runtime - Agent runtime for LLM access
 * @param slippage - Slippage as percentage (e.g., 1 = 1%)
 * @param confirmHighSlippage - Whether user confirmed high slippage via parameter
 * @param inputParams - Input parameters for error response
 * @param actionName - Action name for logging
 * @param callback - Optional callback for user messages
 * @param state - Optional state to check recent messages for user consent via LLM
 * @returns Validation result with optional error
 *
 * @example
 * // Valid: 1% slippage (default)
 * await validateSlippage(runtime, 1, false, params, "SWAP")
 *
 * @example
 * // Valid: 10% with explicit confirmation parameter
 * await validateSlippage(runtime, 10, true, params, "SWAP")
 *
 * @example
 * // Valid: 10% with user consent detected via LLM in recent messages
 * await validateSlippage(runtime, 10, false, params, "SWAP", callback, state)
 * // where state.recentMessagesData contains "yes, proceed" and LLM confirms consent
 *
 * @example
 * // Invalid: 60% exceeds absolute max
 * await validateSlippage(runtime, 60, true, params, "SWAP") // Returns error
 */
export async function validateSlippage(
  runtime: IAgentRuntime,
  slippage: number,
  confirmHighSlippage: boolean,
  inputParams: Record<string, unknown>,
  actionName: string,
  callback?: HandlerCallback,
  state?: State
): Promise<SlippageValidationResult> {
  // Validate: must be a number
  if (typeof slippage !== "number" || Number.isNaN(slippage)) {
    return createSlippageError(
      "❌ Invalid slippage value. Please provide a valid number.",
      "invalid_slippage_type",
      inputParams,
      actionName,
      callback
    );
  }

  // Validate: must be positive
  if (slippage <= 0) {
    return createSlippageError(
      `❌ Slippage must be greater than 0%. Received: ${slippage}%`,
      "slippage_must_be_positive",
      inputParams,
      actionName,
      callback
    );
  }

  // Validate: cannot exceed 100%
  if (slippage > 100) {
    return createSlippageError(
      `❌ Slippage cannot exceed 100%. Received: ${slippage}%`,
      "slippage_exceeds_maximum",
      inputParams,
      actionName,
      callback
    );
  }

  // Validate: absolute maximum (50%) - cannot be bypassed even with confirmation
  if (slippage > ABSOLUTE_MAX_SLIPPAGE) {
    return createSlippageError(
      `❌ Slippage of ${slippage}% exceeds the absolute maximum of ${ABSOLUTE_MAX_SLIPPAGE}%. This limit exists to protect against catastrophic value loss from MEV attacks. Please use a slippage of ${ABSOLUTE_MAX_SLIPPAGE}% or less.`,
      "slippage_exceeds_absolute_max",
      inputParams,
      actionName,
      callback
    );
  }

  // Validate: high slippage (>5%) requires confirmation
  if (slippage > MAX_SLIPPAGE_WITHOUT_CONFIRMATION) {
    // Validate confirmHighSlippage type - must be strictly boolean
    // This prevents string values like "false" from being treated as truthy
    let hasConsent = false;
    let confirmationSource = "";
    
    if (typeof confirmHighSlippage === "boolean" && confirmHighSlippage === true) {
      hasConsent = true;
      confirmationSource = "explicit parameter";
    } else if (typeof confirmHighSlippage !== "boolean" && confirmHighSlippage !== undefined && confirmHighSlippage !== null) {
      // Log warning if non-boolean value was passed
      logger.warn(
        `[${actionName}] Invalid confirmHighSlippage type: ${typeof confirmHighSlippage}. Expected boolean, treating as false for safety.`
      );
    }
    
    if (!hasConsent) {
      // Try to detect consent via LLM
      hasConsent = await detectUserConsentViaLLM(runtime, state);
      confirmationSource = "LLM-detected from recent messages";
    }
    
    if (!hasConsent) {
      return createSlippageError(
        `⚠️ Slippage of ${slippage}% is above the recommended maximum of ${MAX_SLIPPAGE_WITHOUT_CONFIRMATION}%. This could result in significant value loss. To proceed, please confirm you're okay with high slippage.`,
        "high_slippage_not_confirmed",
        inputParams,
        actionName,
        callback
      );
    }

    // Log how confirmation was obtained
    logger.warn(
      `[${actionName}] Proceeding with high slippage: ${slippage}% (confirmed via ${confirmationSource})`
    );
    callback?.({
      text: `⚠️ Proceeding with high slippage of ${slippage}% as confirmed.`,
    });
  }

  return { valid: true };
}

/**
 * Converts slippage from percentage (1 = 1%) to decimal (0.01)
 *
 * @param slippage - Slippage as percentage
 * @returns Slippage as decimal
 *
 * @example
 * slippageToDecimal(1)   // 0.01
 * slippageToDecimal(5)   // 0.05
 * slippageToDecimal(0.5) // 0.005
 */
export function slippageToDecimal(slippage: number): number {
  return slippage / 100;
}

import { v4 } from 'uuid';
import {
    type IAgentRuntime,
    type Memory,
    type Content,
    type UUID,
    type State,
    type HandlerCallback,
    type IMessageService,
    type MessageProcessingOptions,
    type MessageProcessingResult,
    type ResponseDecision,
    ModelType,
    createUniqueUuid,
    composePromptFromState,
    parseKeyValueXml,
} from '@elizaos/core';


const multiStepDecisionTemplate = `<task>
Determine the next step the assistant should take in this conversation to help the user reach their goal.
</task>

{{bio}}

<context>
# CONVERSATION HISTORY
{{conversationHistory}}

# CURRENT USER MESSAGE
{{currentMessage}}

# EXECUTION STATE
**Current Step**: {{iterationCount}} of {{maxIterations}}
**Actions Taken This Round**: {{traceActionResultLength}}
</context>

<action_history>
{{actionResults}}
</action_history>

<instructions>
# Decision Process
1. **Analyze**: What is the user asking for in CURRENT USER MESSAGE?
2. **Check History**: Have I already executed actions for this specific request in "action_history"?
3. **Select Action**:
   - If I need crypto price -> GET_PRICE
   - If I need stock price -> GET_STOCK_PRICE
   - If I need meme/DEX data -> GET_MEME_PRICE
   - If I need news/research/web info -> WEB_SEARCH (MUST provide query parameter!)
   - If I have the data -> Set isFinish: true.
   - If it's just chat -> Set isFinish: true.

# Available Actions & Parameters
- **GET_PRICE**: No parameters needed (extracts symbol from context)
- **GET_STOCK_PRICE**: No parameters needed (extracts symbol from context)
- **GET_MEME_PRICE**: No parameters needed (extracts symbol from context)
- **WEB_SEARCH**: REQUIRES parameters: { "query": "search terms here", "topic": "general" or "finance" }

# Rules
- **ONE ACTION** per step.
- **DO NOT** repeat the exact same action.
- **MANDATORY**: If the user asks for "Price of BTC", you MUST execute "GET_PRICE" before finishing.
- **MANDATORY**: For WEB_SEARCH, ALWAYS include the "query" parameter with specific search terms!
</instructions>

<output>
Respond with XML:
<response>
  <thought>Explain why you are taking this action or finishing.</thought>
  <action>ACTION_NAME (e.g. GET_PRICE, WEB_SEARCH) or empty if finishing</action>
  <parameters>{"query": "your search query", "topic": "finance"}</parameters>
  <isFinish>true | false</isFinish>
</response>

Examples:
- For WEB_SEARCH: <action>WEB_SEARCH</action><parameters>{"query": "Solana latest news developments", "topic": "finance"}</parameters>
- For GET_PRICE: <action>GET_PRICE</action><parameters>{}</parameters>
</output>`;

const multiStepSummaryTemplate = `<task>
Generate a final, user-facing response based on the results obtained.
</task>

{{bio}}

<context>
# CONVERSATION HISTORY
{{conversationHistory}}

# CURRENT USER MESSAGE
{{currentMessage}}

# DATA GATHERED
{{actionResults}}
</context>

<instructions>
1. **Analyze User Intent**:
   - **Simple/Quick Query** (e.g. "price of BTC", "check NVDA", "how is ETH?"): User wants a **concise snapshot**.
   - **Deep Analysis/Research** (e.g. "analyze BTC", "is NVDA a buy?", "research report"): User wants the **full institutional report**.

2. **Select Format**:
   - **IF Simple Query**: Provide a short, direct answer with key metrics (Price, Change, Volume) and a brief 1-sentence sentiment. **DO NOT** use headers like "EXECUTIVE SUMMARY".
   - **IF Deep Analysis**: Use the full **"Enhanced Equity Research"** format (Executive Summary, Fundamentals, Catalyst, Risk, etc).
   - **IF Conversational**: Respond naturally.

3. **Synthesize**: Combine "DATA GATHERED" to answer the request according to the selected format.
</instructions>

<output>
Respond with XML:
<response>
  <thought>Reasoning for format choice (Simple vs Deep)</thought>
  <text>The final response text</text>
</response>
</output>`;

// --- TYPES ---

interface MultiStepActionResult {
    data: { actionName: string };
    success: boolean;
    text?: string;
    error?: string;
}

export class QuantyMessageService implements IMessageService {

    async handleMessage(
        runtime: IAgentRuntime,
        message: Memory,
        callback?: HandlerCallback,
        options?: MessageProcessingOptions
    ): Promise<MessageProcessingResult> {

        const messageText = message.content.text || '';
        runtime.logger.info(`[QuantyMessageService] Processing: ${messageText.substring(0, 100)}`);

        // Ensure Message ID
        if (!message.id) {
            message.id = createUniqueUuid(runtime, v4());
        }

        // Run Multi-Step Core
        const result = await this.runMultiStepCore(runtime, message, callback);

        return {
            didRespond: true,
            responseContent: result.responseContent || { text: "Error generating response", source: 'quanty' },
            responseMessages: result.responseMessages,
            state: result.state,
            mode: 'simple'
        };
    }

    private async runMultiStepCore(
        runtime: IAgentRuntime,
        message: Memory,
        callback?: HandlerCallback
    ): Promise<{ responseContent: Content | null, responseMessages: Memory[], state: State }> {

        const MAX_ITERATIONS = 5;
        let iterationCount = 0;
        const traceActionResult: MultiStepActionResult[] = [];
        const actionResultStrings: string[] = [];

        // Get clean message text (without history)
        const currentMessageText = message.content.text || '';

        // Format conversation history for LLM prompts
        const history = (message.content as any).conversationHistory || [];
        const formattedHistory = this.formatConversationHistory(history);

        runtime.logger.info(`[QuantyMessageService] Message: "${currentMessageText.substring(0, 50)}", History: ${history.length} msgs`);

        // Initial State
        let state = await runtime.composeState(message, ['BIO', 'LORE']);
        state.currentMessage = currentMessageText;
        state.conversationHistory = formattedHistory || 'No previous messages.';

        while (iterationCount < MAX_ITERATIONS) {
            iterationCount++;
            runtime.logger.info(`[MultiStep] Iteration ${iterationCount}/${MAX_ITERATIONS}`);

            // Refresh State
            state = await runtime.composeState(message, ['BIO', 'LORE']);
            state.currentMessage = currentMessageText;
            state.conversationHistory = formattedHistory || 'No previous messages.';
            state.iterationCount = String(iterationCount);
            state.maxIterations = String(MAX_ITERATIONS);
            state.traceActionResultLength = String(traceActionResult.length);
            state.actionResults = actionResultStrings.length > 0
                ? actionResultStrings.join('\n\n')
                : "No actions taken yet.";

            // 1. Decide
            const prompt = composePromptFromState({
                state,
                template: multiStepDecisionTemplate
            });

            const responseRaw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
            const responseStr = String(responseRaw);

            runtime.logger.info(`[MultiStep] LLM Response (first 500 chars): ${responseStr.substring(0, 500)}`);

            // Try to extract XML manually if parseKeyValueXml fails
            let parsed = parseKeyValueXml(responseStr);

            if (!parsed) {
                // Try manual extraction
                const thoughtMatch = responseStr.match(/<thought>([\s\S]*?)<\/thought>/);
                const actionMatch = responseStr.match(/<action>([\s\S]*?)<\/action>/);
                const parametersMatch = responseStr.match(/<parameters>([\s\S]*?)<\/parameters>/);
                const isFinishMatch = responseStr.match(/<isFinish>([\s\S]*?)<\/isFinish>/);

                if (thoughtMatch || actionMatch || isFinishMatch) {
                    // Parse parameters JSON if present
                    let parameters = {};
                    if (parametersMatch && parametersMatch[1]) {
                        try {
                            const paramStr = parametersMatch[1].trim();
                            if (paramStr && paramStr !== '{}') {
                                parameters = JSON.parse(paramStr);
                                runtime.logger.info(`[MultiStep] Parsed parameters: ${JSON.stringify(parameters)}`);
                            }
                        } catch (e) {
                            runtime.logger.warn(`[MultiStep] Failed to parse parameters JSON: ${parametersMatch[1]}`);
                        }
                    }

                    parsed = {
                        thought: thoughtMatch?.[1]?.trim() || '',
                        action: actionMatch?.[1]?.trim() || '',
                        parameters: parameters,
                        isFinish: isFinishMatch?.[1]?.trim() || 'false'
                    };
                    runtime.logger.info("[MultiStep] Manually extracted XML fields");
                }
            }

            if (!parsed) {
                runtime.logger.warn("[MultiStep] Failed to parse XML decision. Raw response logged above.");
                // Try to continue with defaults instead of aborting
                parsed = { thought: 'Parse failed', action: '', isFinish: 'true' };
            }

            const thought = (parsed.thought as string) || "";
            const action = (parsed.action as string) || "";
            const actionParams = (parsed.parameters as Record<string, any>) || {};
            const isFinish = String(parsed.isFinish).toLowerCase() === 'true';

            runtime.logger.info(`[Loop] Thought: ${thought}`);
            runtime.logger.info(`[Loop] Action: '${action}' | Params: ${JSON.stringify(actionParams)} | Finish: ${isFinish}`);

            // 2. Execute Action
            if (action && action.toUpperCase() !== 'NONE' && action !== '') {
                runtime.logger.info(`[Loop] Executing: ${action}`);

                // Set actionParams in state.data for the action to read
                if (!state.data) state.data = {};
                state.data.actionParams = actionParams;

                // For WEB_SEARCH, use query as message text (fallback mechanism)
                let actionMessageText = `Executing action: ${action}`;
                if (action === 'WEB_SEARCH' && actionParams.query) {
                    actionMessageText = actionParams.query;
                    runtime.logger.info(`[Loop] WEB_SEARCH query: ${actionParams.query}`);
                }

                const actionCallMemory: Memory = {
                    id: createUniqueUuid(runtime, v4()),
                    entityId: runtime.agentId,
                    agentId: runtime.agentId,
                    roomId: message.roomId,
                    worldId: message.worldId,
                    content: {
                        text: actionMessageText,
                        action: action,
                        actions: [action],
                        thought: thought,
                        actionParams: actionParams, // Also pass in content for backup
                        source: 'quanty'
                    },
                    createdAt: Date.now(),
                };

                let actionOutputText = "";
                await runtime.processActions(message, [actionCallMemory], state, async (content) => {
                    actionOutputText += content.text;
                    return [];
                });

                if (!actionOutputText) {
                    actionOutputText = `Action ${action} executed but returned no text.`;
                }

                // Truncate to prevent context overflow
                const MAX_OUTPUT_LENGTH = 1700;
                if (actionOutputText.length > MAX_OUTPUT_LENGTH) {
                    actionOutputText = actionOutputText.substring(0, MAX_OUTPUT_LENGTH) + "... [TRUNCATED]";
                }

                runtime.logger.info(`[Loop] Action result: ${actionOutputText.substring(0, 100)}...`);

                traceActionResult.push({
                    data: { actionName: action },
                    success: true,
                    text: actionOutputText
                });
                actionResultStrings.push(`[Action: ${action}]\nResult: ${actionOutputText}`);

                if (!isFinish) continue;
            }

            // 3. Finish & Summarize
            if (isFinish || iterationCount >= MAX_ITERATIONS) {
                runtime.logger.info("[MultiStep] Generating final response...");

                state = await runtime.composeState(message, ['BIO', 'LORE']);
                state.currentMessage = currentMessageText;
                state.conversationHistory = formattedHistory || 'No previous messages.';
                state.actionResults = actionResultStrings.length > 0
                    ? actionResultStrings.join('\n\n')
                    : "No actions taken.";

                const summaryPrompt = composePromptFromState({
                    state,
                    template: multiStepSummaryTemplate
                });

                const summaryRaw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt: summaryPrompt });
                const parsedSummary = parseKeyValueXml(String(summaryRaw));

                let finalText = (parsedSummary?.text as string) || "";
                if (!finalText) {
                    const match = String(summaryRaw).match(/<text>([\s\S]*?)<\/text>/);
                    finalText = match ? match[1] : String(summaryRaw);
                }

                const finalContent: Content = {
                    text: finalText,
                    thought: (parsedSummary?.thought as string) || "Summary generated.",
                    actions: [],
                    source: 'quanty'
                };

                if (callback) {
                    await callback(finalContent);
                }

                const finalMemory: Memory = {
                    id: createUniqueUuid(runtime, v4()),
                    entityId: runtime.agentId,
                    agentId: runtime.agentId,
                    roomId: message.roomId,
                    worldId: message.worldId,
                    content: finalContent,
                    createdAt: Date.now()
                };

                return {
                    responseContent: finalContent,
                    responseMessages: [finalMemory],
                    state
                };
            }
        }

        return {
            responseContent: null,
            responseMessages: [],
            state
        };
    }

    /**
     * Format conversation history for LLM prompts
     */
    private formatConversationHistory(history: Array<{ role: string; content: string }>): string {
        if (!history || history.length === 0) {
            return '';
        }

        return history.map(msg => {
            const speaker = msg.role === 'user' ? 'User' : 'Quanty';
            // Truncate long messages to avoid context overflow
            const content = msg.content.length > 200 ? msg.content.substring(0, 200) + '...' : msg.content;
            return `${speaker}: ${content}`;
        }).join('\n');
    }

    shouldRespond() { return { shouldRespond: true, skipEvaluation: true, reason: 'default' } as ResponseDecision; }
    async processAttachments() { return []; }
    async deleteMessage() { }
    async clearChannel() { }
}

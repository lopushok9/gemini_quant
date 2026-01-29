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
    logger,
    asUUID,
    elizaLogger
} from '@elizaos/core';


const multiStepDecisionTemplate = `<task>
Determine the next step the assistant should take in this conversation to help the user reach their goal.
</task>

{{bio}}

<context>
# CURRENT REQUEST
User says: "{{currentMessage}}"

# RECENT HISTORY
{{recentMessages}}

# EXECUTION STATE
**Current Step**: {{iterationCount}} of {{maxIterations}}
**Actions Taken This Round**: {{traceActionResultLength}}
</context>

<action_history>
{{actionResults}}
</action_history>

<instructions>
# Decision Process
1. **Analyze**: What is the user asking for in "CURRENT REQUEST"?
2. **Check History**: Have I already executed actions for this specific request in "action_history"?
3. **Select Action**:
   - If I need data (Price, News, On-chain) -> Choose ONE action (GET_PRICE, GET_STOCK_PRICE, etc).
   - If I have the data -> Set isFinish: true.
   - If it's just chat -> Set isFinish: true.

# Rules
- **ONE ACTION** per step.
- **DO NOT** repeat the exact same action.
- **MANDATORY**: If the user asks for "Price of BTC", you MUST execute "GET_PRICE" before finishing.
</instructions>

<output>
Respond with XML:
<response>
  <thought>Explain why you are taking this action or finishing.</thought>
  <action>ACTION_NAME (e.g. GET_PRICE) or empty if finishing</action>
  <parameters>
    { "param": "value" }
  </parameters>
  <isFinish>true | false</isFinish>
</response>
</output>`;

const multiStepSummaryTemplate = `<task>
Generate a final, user-facing response based on the results obtained.
</task>

{{bio}}

<context>
# ORIGINAL REQUEST
"{{currentMessage}}"

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

            runtime.logger.info(`[QuantyMessageService] handleMessage INVOCATION from ${message.entityId} in room ${message.roomId}`);
            runtime.logger.info(`[QuantyMessageService] Message text: ${message.content.text?.substring(0, 50)}`);

        // 1. Ensure Message ID (in-memory only, no DB)
        if (!message.id) {
            message.id = createUniqueUuid(runtime, v4());
        }

        // 2. Extract conversation history from message content (passed from frontend)
        const conversationHistory = (message.content as any).conversationHistory || [];
        runtime.logger.info(`[QuantyMessageService] Received ${conversationHistory.length} messages in history`);

        // 3. Run Multi-Step Core with conversation history
        const result = await this.runMultiStepCore(runtime, message, callback, conversationHistory);

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
        callback?: HandlerCallback,
        conversationHistory: Array<{ role: string; content: string }> = []
    ): Promise<{ responseContent: Content | null, responseMessages: Memory[], state: State }> {

        const MAX_ITERATIONS = 5;
        let iterationCount = 0;
        const traceActionResult: MultiStepActionResult[] = [];
        const actionResultStrings: string[] = []; // For template injection

        // Format conversation history for the prompt (from frontend, no DB needed)
        const formattedHistory = this.formatConversationHistory(conversationHistory);
        runtime.logger.info(`[QuantyMessageService] Formatted history: ${formattedHistory.substring(0, 200)}...`);

        // Initial State - use BIO and LORE only, skip RECENT_MESSAGES (we have history from frontend)
        let state = await runtime.composeState(message, ['BIO', 'LORE']);
        // FORCE inject the current message text and conversation history
        state.currentMessage = message.content.text;
        state.recentMessages = formattedHistory || 'No previous messages.';

        while (iterationCount < MAX_ITERATIONS) {
            iterationCount++;
            runtime.logger.info(`[MultiStep] Iteration ${iterationCount}/${MAX_ITERATIONS}`);

            // Refresh State - skip RECENT_MESSAGES, use frontend history instead
            state = await runtime.composeState(message, ['BIO', 'LORE']);
            state.currentMessage = message.content.text; // Persist across loops
            state.recentMessages = formattedHistory || 'No previous messages.'; // Use frontend history
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
            const parsed = parseKeyValueXml(String(responseRaw));

            if (!parsed) {
                runtime.logger.warn("[MultiStep] Failed to parse XML decision. Retrying or Aborting.");
                break; // Break loop on critical failure to avoid infinite loops
            }

            const thought = (parsed.thought as string) || "";
            const action = (parsed.action as string) || "";
            const isFinish = String(parsed.isFinish).toLowerCase() === 'true';

            runtime.logger.info(`[Loop] Thought: ${thought}`);
            runtime.logger.info(`[Loop] Action: '${action}' | Finish: ${isFinish}`);

            // 2. Execute Action
            if (action && action.toUpperCase() !== 'NONE' && action !== '') {
                runtime.logger.info(`[Loop] Executing: ${action}`);

                const actionCallMemory: Memory = {
                    id: createUniqueUuid(runtime, v4()),
                    entityId: runtime.agentId,
                    agentId: runtime.agentId,
                    roomId: message.roomId,
                    worldId: message.worldId,
                    content: {
                        text: `Executing action: ${action}`,
                        action: action,
                        actions: [action], // CRITICAL for ElizaOS discovery
                        thought: thought,
                        source: 'quanty'
                    },
                    createdAt: Date.now(),
                };

                let actionOutputText = "";
                await runtime.processActions(message, [actionCallMemory], state, async (content) => {
                    actionOutputText += content.text;
                    if (callback) {
                        // Optional: stream action updates
                        // await callback(content); 
                    }
                    return [];
                });

                if (!actionOutputText) {
                    actionOutputText = `Action ${action} executed but returned no text.`;
                }

                // TRUNCATE OUTPUT to prevent context overflow and hanging
                const MAX_OUTPUT_LENGTH = 1700;
                if (actionOutputText.length > MAX_OUTPUT_LENGTH) {
                    actionOutputText = actionOutputText.substring(0, MAX_OUTPUT_LENGTH) + "... [TRUNCATED]";
                }

                runtime.logger.info(`[Loop] Result (truncated): ${actionOutputText.substring(0, 100)}...`);

                // Track Results
                traceActionResult.push({
                    data: { actionName: action },
                    success: true,
                    text: actionOutputText
                });
                actionResultStrings.push(`[Action: ${action}]\nResult: ${actionOutputText}`);

                // Continue to next iteration to decide next steps (unless explicitly finished)
                if (!isFinish) continue;
            }

            // 3. Finish & Summarize
            if (isFinish || iterationCount >= MAX_ITERATIONS) {
                runtime.logger.info("[MultiStep] Finishing and Summarizing.");

                // Final State Refresh - skip RECENT_MESSAGES, use frontend history
                state = await runtime.composeState(message, ['BIO', 'LORE']);
                state.currentMessage = message.content.text;
                state.recentMessages = formattedHistory || 'No previous messages.';
                state.actionResults = actionResultStrings.length > 0
                    ? actionResultStrings.join('\n\n')
                    : "No actions taken.";

                const summaryPrompt = composePromptFromState({
                    state,
                    template: multiStepSummaryTemplate
                });

                const summaryRaw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt: summaryPrompt });
                const parsedSummary = parseKeyValueXml(String(summaryRaw));

                // Fallback text extraction
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

                // Send Final Response
                if (callback) {
                    await callback(finalContent);
                }

                // Create in-memory representation (no DB save to avoid database dependency)
                const finalMemory: Memory = {
                    id: createUniqueUuid(runtime, v4()),
                    entityId: runtime.agentId,
                    agentId: runtime.agentId,
                    roomId: message.roomId,
                    worldId: message.worldId,
                    content: finalContent,
                    createdAt: Date.now()
                };
                // Skip DB save - history is managed by frontend
                // await runtime.createMemory(finalMemory, 'messages');

                return {
                    responseContent: finalContent,
                    responseMessages: [finalMemory],
                    state
                };
            }
        }

        // Fallback return
        return {
            responseContent: null,
            responseMessages: [],
            state
        };
    }

    /**
     * Format conversation history from frontend into a string for the prompt.
     * This allows the agent to see previous messages without requiring a database.
     */
    private formatConversationHistory(history: Array<{ role: string; content: string }>): string {
        if (!history || history.length === 0) {
            return '';
        }

        // Limit to last 10 messages to avoid context overflow
        const recentHistory = history.slice(-10);

        return recentHistory.map(msg => {
            const speaker = msg.role === 'user' ? 'User' : 'Quanty';
            return `${speaker}: ${msg.content}`;
        }).join('\n');
    }

    // Stubs
    shouldRespond() { return { shouldRespond: true, skipEvaluation: true, reason: 'default' } as ResponseDecision; }
    async processAttachments() { return []; }
    async deleteMessage() { }
    async clearChannel() { }
}

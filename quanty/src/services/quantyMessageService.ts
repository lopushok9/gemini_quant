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
} from '@elizaos/core';

const shouldRespondTemplate = `<task>Decide on behalf of {{agentName}} whether they should respond to the message.</task>
<instructions>
- If mentioned by name ({{agentName}}) -> RESPOND
- If it's a direct conversation -> RESPOND
- Otherwise -> IGNORE
</instructions>
<output>
Respond with XML:
<response>
  <action>RESPOND | IGNORE</action>
</response>
</output>`;

const messageTemplate = `<task>Generate a response as {{agentName}}.</task>
{{bio}}
{{lore}}
<instructions>
{{system}}
</instructions>
<output>
Respond with XML:
<response>
  <thought>Your thinking here</thought>
  <text>Your response text here</text>
  <actions>comma,separated,actions</actions>
</response>
</output>`;

export class QuantyMessageService implements IMessageService {
    async handleMessage(
        runtime: IAgentRuntime,
        message: Memory,
        callback?: HandlerCallback,
        options?: MessageProcessingOptions
    ): Promise<MessageProcessingResult> {
        try {
            runtime.logger.info(`[QuantyMessageService] Handling message from ${message.entityId}`);

            // 1. Save to memory if not saved
            if (!message.id) {
                message.id = await runtime.createMemory(message, 'messages') as UUID;
            }

            // 2. Prepare state (skipping decision step for speed)
            const state = await runtime.composeState(message);

            // 3. Generate response
            const responsePrompt = composePromptFromState({
                state,
                template: runtime.character.templates?.messageTemplate || messageTemplate,
            });

            const responseRaw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt: responsePrompt });
            const responseData = parseKeyValueXml(String(responseRaw)) as Record<string, string>;

            const actionsRaw = responseData?.actions;
            const actions = typeof actionsRaw === 'string' ? actionsRaw.split(',') : (Array.isArray(actionsRaw) ? actionsRaw : []);

            const responseContent: Content = {
                text: responseData?.text || String(responseRaw),
                thought: responseData?.thought,
                actions: actions as string[],
                source: 'quanty'
            };

            if (callback) {
                await callback(responseContent);
            }

            // 4. Save response to memory
            const responseMemory: Memory = {
                id: createUniqueUuid(runtime, v4()),
                entityId: runtime.agentId,
                agentId: runtime.agentId,
                roomId: message.roomId,
                worldId: message.worldId,
                content: responseContent,
                createdAt: Date.now(),
            };
            await runtime.createMemory(responseMemory, 'messages');

            return {
                didRespond: true,
                responseContent,
                responseMessages: [responseMemory],
                state,
                mode: 'simple',
            };
        } catch (error) {
            runtime.logger.error('[QuantyMessageService] Error:', error);
            throw error;
        }
    }

    // Stub methods required by interface
    shouldRespond() { return { shouldRespond: true, skipEvaluation: true, reason: 'default' } as ResponseDecision; }
    async processAttachments(runtime: any, attachments: any[]) { return attachments; }
    async deleteMessage() { }
    async clearChannel() { }
}

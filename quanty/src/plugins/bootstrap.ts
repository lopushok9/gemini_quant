import {
    Service,
    type IAgentRuntime,
    type Plugin,
    type EntityPayload,
    EventType,
    ChannelType,
} from '@elizaos/core';
import { QuantyMessageService } from '../services/quantyMessageService.ts';
import internalMessageBus from '../bus.ts';

class MessageServiceInstaller extends Service {
    static serviceType = 'quanty-message-installer';
    capabilityDescription = 'Installs the custom QuantyMessageService after runtime initialization';

    static async start(runtime: IAgentRuntime): Promise<Service> {
        const service = new MessageServiceInstaller(runtime);

        runtime.logger.info('[QuantyPlugin] Installing QuantyMessageService...');

        const myMessageService = new QuantyMessageService();
        runtime.messageService = myMessageService;

        // Helper to send response back via internal bus
        const sendResponseToBus = async (roomId: string, text: string, originalMsg: any) => {
            try {
                const messagePayload = {
                    id: crypto.randomUUID(),
                    channel_id: originalMsg.channel_id || originalMsg.roomId || roomId,
                    server_id: originalMsg.message_server_id || originalMsg.server_id || '00000000-0000-0000-0000-000000000000',
                    author_id: runtime.agentId,
                    content: text,
                    source_type: 'agent_response',
                    created_at: Date.now(),
                    metadata: {
                        agent_id: runtime.agentId,
                        agentName: runtime.character.name
                    }
                };

                internalMessageBus.emit('agent_response', messagePayload);
                console.log(`[QuantyPlugin] ✅ Response sent`);
            } catch (e) {
                console.error('[QuantyPlugin] ❌ Failed to send response:', e);
            }
        };

        // Monkey-patch MessageBusService to intercept messages
        const applyPatch = () => {
            try {
                const allServices = (runtime as any).services;
                let busService = runtime.getService('message-bus-service' as any);

                if (!busService && allServices) {
                    busService = Array.from(allServices.values()).find((s: any) =>
                        s?.constructor?.name?.includes('MessageBus') || s?.serviceType?.includes('message-bus')
                    );
                }

                if (busService) {
                    runtime.logger.info(`[QuantyPlugin] Found MessageBusService. Patching...`);
                    const originalHandle = (busService as any).handleIncomingMessage;

                    (busService as any).handleIncomingMessage = async (data: any) => {
                        console.log('[QuantyPlugin] ⚡ Message received:', data?.content?.substring(0, 50));

                        try {
                            if (data && data.content && data.author_id !== runtime.agentId) {
                                const mappedMessage = {
                                    id: data.id || crypto.randomUUID(),
                                    entityId: data.author_id,
                                    agentId: runtime.agentId,
                                    roomId: data.channel_id || data.roomId,
                                    worldId: data.server_id || runtime.agentId,
                                    content: {
                                        text: data.content
                                    },
                                    createdAt: data.created_at || Date.now()
                                };

                                const responseCallback = async (content: any) => {
                                    if (content.text) {
                                        await sendResponseToBus(mappedMessage.roomId, content.text, data);
                                    }
                                    return [];
                                };

                                await myMessageService.handleMessage(runtime, mappedMessage as any, responseCallback);
                            }
                        } catch (err) {
                            console.error('[QuantyPlugin] Error processing message:', err);
                        }

                        // Don't call original to avoid double processing
                        // if (typeof originalHandle === 'function') {
                        //     return originalHandle.call(busService, data);
                        // }
                    };

                    runtime.logger.success('[QuantyPlugin] ✅ MessageBusService patched');
                    return true;
                }
            } catch (e) {
                console.error('[QuantyPlugin] Patch failed:', e);
            }
            return false;
        };

        // Retry patching until successful
        let attempts = 0;
        const patchInterval = setInterval(() => {
            attempts++;
            if (applyPatch() || attempts > 10) {
                clearInterval(patchInterval);
            }
        }, 3000);

        // Sync entity connections
        runtime.registerEvent(EventType.ENTITY_JOINED, async (payload: EntityPayload) => {
            const { entityId, roomId, worldId, source } = payload;
            if (entityId !== runtime.agentId) {
                try {
                    await runtime.ensureConnection({
                        entityId: entityId,
                        roomId: roomId,
                        name: `Chat-${String(roomId).substring(0, 8)}`,
                        source: source || 'socketio',
                        channelId: String(roomId),
                        type: ChannelType.GROUP,
                        worldId: worldId || runtime.agentId,
                    });
                } catch (err) {
                    // Ignore connection errors
                }
            }
        });

        return service;
    }

    async stop(): Promise<void> { }
}

export const quantyBootstrapPlugin: Plugin = {
    name: 'quanty-bootstrap',
    description: 'Bootstraps Quanty with custom message handling',
    services: [MessageServiceInstaller],
};

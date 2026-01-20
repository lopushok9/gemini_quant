import { 
    Service, 
    type IAgentRuntime, 
    type Plugin, 
    type EntityPayload, 
    EventType,
    ChannelType,
} from '@elizaos/core';
import { QuantyMessageService } from '../services/quantyMessageService.ts';

class MessageServiceInstaller extends Service {
    static serviceType = 'quanty-message-installer';
    capabilityDescription = 'Installs the custom QuantyMessageService after runtime initialization';

    static async start(runtime: IAgentRuntime): Promise<Service> {
        const service = new MessageServiceInstaller(runtime);

        runtime.logger.info('[QuantyPlugin] Installing logic overrides...');

        const myMessageService = new QuantyMessageService();
        runtime.messageService = myMessageService;

        // ЭКСТРЕМАЛЬНЫЙ МОНКИ-ПАТЧИНГ (Omega Option)
        setTimeout(() => {
            try {
                const busService = runtime.getService('message-bus-service' as any);
                if (busService) {
                    runtime.logger.info(`[QuantyPlugin] Found MessageBusService. Applying monkey-patch...`);
                    const originalHandle = (busService as any).handleIncomingMessage;
                    
                    (busService as any).handleIncomingMessage = async (data: any) => {
                        console.log('[QuantyPlugin] ⚡ INTERCEPTED by Monkey-Patch:', data?.id);
                        try {
                            if (data && data.content && data.author_id !== runtime.agentId) {
                                const mappedMessage = {
                                    ...data,
                                    userId: data.author_id,
                                    content: { text: data.content },
                                    roomId: data.channel_id || data.roomId
                                };
                                await myMessageService.handleMessage(runtime, mappedMessage as any);
                            }
                        } catch (err) {
                            console.error('[QuantyPlugin] Error in monkey-patch handler:', err);
                        }
                        if (typeof originalHandle === 'function') {
                            return originalHandle.call(busService, data);
                        }
                    };
                    runtime.logger.success('[QuantyPlugin] MessageBusService monkey-patched successfully');
                }
            } catch (e) {
                runtime.logger.error('[QuantyPlugin] Monkey-patch failed:', e);
            }
        }, 15000);

        // Логика синхронизации подключений
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
                    runtime.logger.success(`[QuantyPlugin] Connection synced for entity ${entityId}`);
                } catch (err) {
                    runtime.logger.error(`[QuantyPlugin] Failed to sync connection:`, err);
                }
            }
        });

        // Резервный перехват событий
        runtime.registerEvent('MESSAGE_RECEIVED' as any, async (payload: any) => {
            const { message, callback } = payload;
            if (message.userId === runtime.agentId) return;
            try {
                await myMessageService.handleMessage(runtime, message, callback);
            } catch (error) {
                runtime.logger.error('[QuantyPlugin] Error handling intercepted message:', error);
            }
        });

        return service;
    }

    async stop(): Promise<void> { }
}

export const quantyBootstrapPlugin: Plugin = {
    name: 'quanty-bootstrap',
    description: 'Bootstraps Quanty with custom message handling and connection syncing',
    services: [MessageServiceInstaller],
};

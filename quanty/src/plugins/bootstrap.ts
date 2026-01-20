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

        runtime.logger.info('[QuantyPlugin] Installing logic overrides with response feedback...');

        const myMessageService = new QuantyMessageService();
        runtime.messageService = myMessageService;

        // Вспомогательная функция для отправки ответа обратно в шину (как в Otaku)
        const sendResponseToBus = async (roomId: string, text: string, originalMsg: any) => {
            try {
                const serverPort = process.env.PORT || process.env.SERVER_PORT || '3000';
                const url = `http://localhost:${serverPort}/api/messaging/submit`;
                
                const payload = {
                    channel_id: originalMsg.channel_id || originalMsg.roomId,
                    server_id: originalMsg.server_id || '00000000-0000-0000-0000-000000000000',
                    author_id: runtime.agentId,
                    content: text,
                    source_type: 'agent_response',
                    metadata: {
                        agent_id: runtime.agentId,
                        agentName: runtime.character.name
                    }
                };

                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                console.log('[QuantyPlugin] Response sent to bus successfully');
            } catch (err) {
                console.error('[QuantyPlugin] Failed to send response back to bus:', err);
            }
        };

        // ЭКСТРЕМАЛЬНЫЙ МОНКИ-ПАТЧИНГ (Omega Option)
        setTimeout(() => {
            try {
                const busService = runtime.getService('message-bus-service' as any);
                if (busService) {
                    runtime.logger.info(`[QuantyPlugin] Found MessageBusService. Applying monkey-patch with callback...`);
                    const originalHandle = (busService as any).handleIncomingMessage;
                    
                    (busService as any).handleIncomingMessage = async (data: any) => {
                        console.log('[QuantyPlugin] ⚡ INTERCEPTED by Monkey-Patch:', data?.id);
                        try {
                            if (data && data.content && data.author_id !== runtime.agentId) {
                                // 1. Исправляем маппинг сообщения
                                const mappedMessage = {
                                    ...data,
                                    entityId: data.author_id, // Добавляем entityId для логов и рантайма
                                    userId: data.author_id,
                                    content: { text: data.content },
                                    roomId: data.channel_id || data.roomId
                                };

                                // 2. Создаем колбэк для отправки ответа
                                const callback = async (content: any) => {
                                    if (content.text) {
                                        await sendResponseToBus(mappedMessage.roomId, content.text, data);
                                    }
                                    return [];
                                };
                                
                                // 3. Вызываем сервис с колбэком
                                await myMessageService.handleMessage(runtime, mappedMessage as any, callback);
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

        return service;
    }

    async stop(): Promise<void> { }
}

export const quantyBootstrapPlugin: Plugin = {
    name: 'quanty-bootstrap',
    description: 'Bootstraps Quanty with custom message handling and connection syncing',
    services: [MessageServiceInstaller],
};
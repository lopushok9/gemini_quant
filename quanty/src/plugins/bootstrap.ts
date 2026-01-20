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

        // Вспомогательная функция для отправки ответа обратно в шину
        const sendResponseToBus = async (roomId: string, text: string, originalMsg: any) => {
            const port = process.env.PORT || process.env.SERVER_PORT || '3000';
            const centralUrl = process.env.CENTRAL_MESSAGE_SERVER_URL;
            
            // Формируем список URL для попыток отправки
            const urls = [];
            if (centralUrl) urls.push(`${centralUrl}/api/messaging/submit`);
            urls.push(`http://127.0.0.1:${port}/api/messaging/submit`);
            urls.push(`http://127.0.0.1:3000/api/messaging/submit`);
            urls.push(`http://localhost:${port}/api/messaging/submit`);

            for (const url of urls) {
                try {
                    const payload = {
                        channel_id: originalMsg.channel_id || originalMsg.roomId,
                        message_server_id: originalMsg.message_server_id || originalMsg.server_id || '00000000-0000-0000-0000-000000000000',
                        author_id: runtime.agentId,
                        content: text,
                        source_type: 'agent_response',
                        metadata: {
                            agent_id: runtime.agentId,
                            agentName: runtime.character.name
                        }
                    };

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (response.ok) {
                        console.log(`[QuantyPlugin] ✅ Response delivered via ${url}`);
                        return;
                    }
                } catch (e) {
                    // Try next URL
                }
            }
            console.error('[QuantyPlugin] ❌ All bus delivery attempts failed');
        };

        // ЭКСТРЕМАЛЬНЫЙ МОНКИ-ПАТЧИНГ (Omega Option)
        // Пытаемся найти сервис несколько раз, если он не появился сразу
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
                    runtime.logger.info(`[QuantyPlugin] Found MessageBusService. Applying monkey-patch...`);
                    const originalHandle = (busService as any).handleIncomingMessage;
                    
                    (busService as any).handleIncomingMessage = async (data: any) => {
                        console.log('[QuantyPlugin] ⚡ INTERCEPTED:', data?.id);
                        try {
                            if (data && data.content && data.author_id !== runtime.agentId) {
                                const mappedMessage = {
                                    ...data,
                                    entityId: data.author_id,
                                    userId: data.author_id,
                                    content: { text: data.content },
                                    roomId: data.channel_id || data.roomId
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
                            console.error('[QuantyPlugin] Error in monkey-patch:', err);
                        }
                        if (typeof originalHandle === 'function') {
                            return originalHandle.call(busService, data);
                        }
                    };
                    runtime.logger.success('[QuantyPlugin] MessageBusService monkey-patched');
                    return true;
                }
            } catch (e) {
                console.error('[QuantyPlugin] Patch attempt failed:', e);
            }
            return false;
        };

        // Запускаем попытки патча
        let attempts = 0;
        const patchInterval = setInterval(() => {
            attempts++;
            if (applyPatch() || attempts > 10) {
                clearInterval(patchInterval);
            }
        }, 3000);

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
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
            // ЛОГИ ПОКАЗАЛИ: Внутренний сервер всегда слушает на 3000, игнорируя внешние порты Railway.
            // Поэтому мы сразу пробуем 3000 для внутренней доставки.
            const ports = ['3000', process.env.PORT, process.env.SERVER_PORT].filter(Boolean);
            
            for (const port of ports) {
                const url = `http://127.0.0.1:${port}/api/messaging/submit`;
                try {
                    const payload = {
                        channel_id: originalMsg.channel_id || originalMsg.roomId,
                        // Исправляем депрекацию: server_id -> message_server_id
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
                        console.log(`[QuantyPlugin] ✅ Response delivered to bus via port ${port}`);
                        return; // Успешно отправили, выходим из цикла
                    }
                } catch (err: any) {
                    // Пробуем следующий порт, если этот не сработал
                }
            }
            console.error('[QuantyPlugin] ❌ All bus delivery attempts failed');
        };

        // ЭКСТРЕМАЛЬНЫЙ МОНКИ-ПАТЧИНГ (Omega Option)
        // Уменьшаем таймаут до 5 секунд для более быстрой инициализации
        setTimeout(() => {
            try {
                const allServices = (runtime as any).services;
                let busService = runtime.getService('message-bus-service' as any);
                
                // Если по имени не нашли, ищем по типу или конструктору
                if (!busService && allServices) {
                    busService = Array.from(allServices.values()).find((s: any) => 
                        s?.constructor?.name?.includes('MessageBus') || s?.serviceType?.includes('message-bus')
                    );
                }

                if (busService) {
                    runtime.logger.info(`[QuantyPlugin] Found MessageBusService (${busService.constructor.name}). Applying monkey-patch...`);
                    const originalHandle = (busService as any).handleIncomingMessage;
                    
                    (busService as any).handleIncomingMessage = async (data: any) => {
                        console.log('[QuantyPlugin] ⚡ INTERCEPTED by Monkey-Patch:', data?.id);
                        try {
                            if (data && data.content && data.author_id !== runtime.agentId) {
                                // 1. Исправляем маппинг сообщения
                                const mappedMessage = {
                                    ...data,
                                    entityId: data.author_id,
                                    userId: data.author_id,
                                    content: { text: data.content },
                                    roomId: data.channel_id || data.roomId
                                };

                                const callback = async (content: any) => {
                                    if (content.text) {
                                        await sendResponseToBus(mappedMessage.roomId, content.text, data);
                                    }
                                    return [];
                                };
                                
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
                } else {
                    console.error('[QuantyPlugin] ❌ CRITICAL: Could not find MessageBusService for patching!');
                    if (allServices) console.log('[QuantyPlugin] Available Services:', Array.from(allServices.keys()));
                }
            } catch (e) {
                runtime.logger.error('[QuantyPlugin] Monkey-patch failed:', e);
            }
        }, 5000);

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
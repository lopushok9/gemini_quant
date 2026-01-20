import { 
    Service, 
    type IAgentRuntime, 
    type Plugin, 
    type EntityPayload, 
    EventType,
    ChannelType,
    createUniqueUuid
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
        // Мы внедряемся в системные методы ElizaOS, чтобы починить доставку сообщений
        setTimeout(() => {
            try {
                const busService = runtime.getService('message-bus-service' as any);
                
                if (busService) {
                    runtime.logger.info(`[QuantyPlugin] Found MessageBusService. Applying monkey-patch...`);
                    
                    // Сохраняем оригинальный метод (на всякий случай)
                    const originalHandle = (busService as any).handleIncomingMessage;
                    
                    // Перезаписываем системный метод своей логикой
                    (busService as any).handleIncomingMessage = async (data: any) => {
                        console.log('[QuantyPlugin] ⚡ INTERCEPTED by Monkey-Patch:', data?.id);
                        
                        try {
                            // Форсируем обработку сообщения, не дожидаясь проверок подписок
                            // которые ломаются на Railway
                            if (data && data.content && data.author_id !== runtime.agentId) {
                                // Преобразуем формат данных шины в формат Memory, который ждет наш сервис
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

                        // Вызываем оригинал, чтобы не ломать внутреннее состояние системы (если он еще жив)
                        if (typeof originalHandle === 'function') {
                            return originalHandle.call(busService, data);
                        }
                    };
                    
                    runtime.logger.success('[QuantyPlugin] MessageBusService monkey-patched successfully');
                } else {
                    runtime.logger.error('[QuantyPlugin] CRITICAL: MessageBusService not found for patching!');
                }
            } catch (e) {
                runtime.logger.error('[QuantyPlugin] Monkey-patch failed:', e);
            }
        }, 15000); // Ждем 15 секунд, чтобы все системные сервисы точно загрузились

        return service;
    }
            const { entityId, roomId, worldId, source } = payload;
            
            if (entityId !== runtime.agentId) {
                runtime.logger.info(`[QuantyPlugin] New entity joined: ${entityId}. Syncing connection...`);

                try {
                    // Используем ensureConnection вместо простых addParticipant/ensureRoomExists.
                    // Это уведомляет MessageBus о том, что агент должен получать сообщения из этого канала.
                    await runtime.ensureConnection({
                        entityId: entityId,
                        roomId: roomId,
                        name: `Chat-${String(roomId).substring(0, 8)}`,
                        source: source || 'socketio',
                        channelId: String(roomId),
                        type: ChannelType.GROUP,
                        worldId: worldId || runtime.agentId,
                    });

                    runtime.logger.success(`[QuantyPlugin] Connection synced for entity ${entityId} in room ${roomId}`);
                } catch (err) {
                    runtime.logger.error(`[QuantyPlugin] Failed to sync connection:`, err);
                }
            }
        });

        // Слушаем входящие сообщения (резервный механизм)
        runtime.registerEvent('MESSAGE_RECEIVED' as any, async (payload: any) => {
            const { message, callback } = payload;
            if (message.userId === runtime.agentId) return;

            runtime.logger.info(`[QuantyPlugin] MESSAGE_RECEIVED event intercepted.`);

            try {
                // Вызываем напрямую, если основной цикл через MessageService не сработал
                await runtime.messageService!.handleMessage(runtime, message, callback);
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
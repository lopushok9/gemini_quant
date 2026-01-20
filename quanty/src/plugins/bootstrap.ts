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

        runtime.logger.info('[QuantyPlugin] Installing QuantyMessageService...');

        // 1. Устанавливаем наш сервис сообщений
        const myMessageService = new QuantyMessageService();
        runtime.messageService = myMessageService;

        // 2. ХАК ДЛЯ RAILWAY/MESSAGE-BUS:
        // Находим сервис шины сообщений и подписываемся на него напрямую.
        // Это гарантирует, что даже если внутренняя маршрутизация ElizaOS сломана,
        // мы все равно получим сообщение.
        setTimeout(() => {
            try {
                const messageBus = runtime.getService('message-bus-service') as any;
                if (messageBus) {
                    runtime.logger.info('[QuantyPlugin] MessageBusService found! Hooking into direct message stream...');
                    
                    // Подписываемся на ВСЕ сообщения шины
                    messageBus.on('message', async (message: any) => {
                        // Если сообщение адресовано в комнату, где есть наш агент
                        // (или если это Socket.io сообщение, которое мы видим в логах)
                        if (message.userId === runtime.agentId) return; // Игнорируем свои

                        runtime.logger.info(`[QuantyPlugin] Direct Bus Hook: Captured message ${message.id}`);
                        
                        try {
                            // Форсируем обработку сообщения нашим сервисом
                            await myMessageService.handleMessage(runtime, message);
                        } catch (err) {
                            runtime.logger.error('[QuantyPlugin] Error in Direct Bus Hook:', err);
                        }
                    });
                } else {
                    runtime.logger.warn('[QuantyPlugin] MessageBusService NOT found. Fallback to standard routing.');
                }
            } catch (e) {
                runtime.logger.error('[QuantyPlugin] Failed to hook into MessageBus:', e);
            }
        }, 5000); // Даем время на инициализацию всех сервисов

        runtime.logger.success('[QuantyPlugin] QuantyMessageService installed and hooked');

        // Логика синхронизации подключений (Connection Sync)
        runtime.registerEvent(EventType.ENTITY_JOINED, async (payload: EntityPayload) => {
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
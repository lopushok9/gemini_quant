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

        runtime.logger.info('[QuantyPlugin] Installing QuantyMessageService (Post-Initialization)...');

        // Заменяем стандартный сервис на наш (как в Otaku)
        runtime.messageService = new QuantyMessageService();

        runtime.logger.success('[QuantyPlugin] QuantyMessageService installed successfully');

        // Логика синхронизации подключений (Connection Sync) из Otaku
        // Это КЛЮЧЕВОЙ момент для работы MessageBus
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
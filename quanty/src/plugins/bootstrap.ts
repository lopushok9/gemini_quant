import { Service, type IAgentRuntime, type Plugin } from '@elizaos/core';
import { QuantyMessageService } from '../services/quantyMessageService.ts';

class MessageServiceInstaller extends Service {
    static serviceType = 'quanty-message-installer';
    capabilityDescription = 'Installs the custom QuantyMessageService after runtime initialization';

    static async start(runtime: IAgentRuntime): Promise<Service> {
        const service = new MessageServiceInstaller(runtime);

        runtime.logger.info('[QuantyPlugin] Installing QuantyMessageService...');
        console.log('[QuantyPlugin] Current Service:', runtime.messageService?.constructor?.name);

        // Заменяем стандартный сервис на наш
        runtime.messageService = new QuantyMessageService();
        console.log('[QuantyPlugin] New Service Set:', runtime.messageService?.constructor?.name);

        runtime.logger.success('[QuantyPlugin] QuantyMessageService installed successfully');

        // Слушаем присоединение сущностей к комнатам
        runtime.registerEvent('ENTITY_JOINED' as any, async (payload: any) => {
            const { entityId, roomId, worldId } = payload;
            console.log(`[QuantyPlugin] ENTITY_JOINED: ${entityId} in ${roomId}`);
            
            if (entityId !== runtime.agentId) {
                runtime.logger.info(`[QuantyPlugin] Entity ${entityId} joined room ${roomId}. Adding agent ${runtime.agentId} to participants...`);

                try {
                    // 1. Добавляем агента в участники в БД (через метод рантайма)
                    await runtime.addParticipant(runtime.agentId, roomId);

                    // 2. Гарантируем, что рантайм видит эту комнату
                    await runtime.ensureRoomExists({
                        id: roomId,
                        name: `Chat-${String(roomId).substring(0, 8)}`,
                        agentId: runtime.agentId,
                        worldId: worldId || runtime.agentId,
                        channelId: String(roomId),
                        serverId: worldId || runtime.agentId,
                        source: 'socketio',
                        type: 'GROUP' as any
                    });

                    runtime.logger.success(`[QuantyPlugin] Agent successfully added to room ${roomId}`);
                } catch (err) {
                    runtime.logger.error(`[QuantyPlugin] Failed to add agent to room ${roomId}:`, err);
                }
            }
        });

        // Слушаем входящие сообщения напрямую, чтобы обойти ограничения MessageBus
        runtime.registerEvent('MESSAGE_RECEIVED' as any, async (payload: any) => {
            console.log('[QuantyPlugin] MESSAGE_RECEIVED event fired!');
            const { message, callback } = payload;

            // Игнорируем свои собственные сообщения
            if (message.userId === runtime.agentId) {
                console.log('[QuantyPlugin] Ignoring own message');
                return;
            }

            runtime.logger.info(`[QuantyPlugin] MESSAGE_RECEIVED event intercepted. Sender: ${message.userId}. Forcing handleMessage...`);
            console.log('[QuantyPlugin] Using Service:', runtime.messageService?.constructor?.name);

            try {
                // Если стандартный механизм не сработал (мы это поймем по отсутствию реакции),
                // этот вызов гарантирует ответ. 
                // QuantyMessageService внутри себя имеет логику дедупликации/проверки (или мы добавим).
                // Но пока просто форсируем ответ.
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
    description: 'Bootstraps Quanty with custom message handling',
    services: [MessageServiceInstaller],
};

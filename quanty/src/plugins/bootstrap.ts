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

        runtime.logger.info('[QuantyPlugin] Rescuing Message Delivery Chain...');

        // 1. Устанавливаем наш сервис
        const myMessageService = new QuantyMessageService();
        runtime.messageService = myMessageService;

        // 2. ДИАГНОСТИКА СЕРВИСОВ
        const allServices = (runtime as any).services;
        if (allServices) {
            console.log('[QuantyPlugin] Registered Services:', Array.from(allServices.keys()));
        }

        // 3. ЭКСТРЕМАЛЬНЫЙ ХУК (Nuclear Option)
        setTimeout(() => {
            try {
                // Пытаемся найти сервис шины под любым именем
                const busService = runtime.getService('message-bus-service' as any) || 
                                 runtime.getService('message-bus' as any) ||
                                 Array.from(allServices.values()).find((s: any) => s.constructor.name.includes('MessageBus'));

                if (busService) {
                    runtime.logger.info(`[QuantyPlugin] Bus Service Found: ${busService.constructor.name}. Hooking...`);
                    
                    // Хак: Если сервис застрял на fetch, мы подсовываем ему "правду"
                    if ((busService as any).subscribedServers) {
                        (busService as any).subscribedServers.add('00000000-0000-0000-0000-000000000000');
                    }

                    // Подписка на низкоуровневые события, если они есть
                    const emitter = (busService as any).emitter || busService;
                    if (typeof emitter.on === 'function') {
                        emitter.on('message', async (msg: any) => {
                            if (msg.userId === runtime.agentId || msg.author_id === runtime.agentId) return;
                            runtime.logger.info(`[QuantyPlugin] ⚡ DIRECT HOOK TRAP: Message ${msg.id}`);
                            await myMessageService.handleMessage(runtime, msg);
                        });
                    }
                }

                // РЕЗЕРВНЫЙ ПЛАН: Подписка на глобальные события рантайма
                runtime.registerEvent('new_message' as any, async (msg: any) => {
                    runtime.logger.info('[QuantyPlugin] ⚡ RUNTIME EVENT TRAP: new_message');
                    await myMessageService.handleMessage(runtime, msg);
                });

            } catch (e) {
                runtime.logger.error('[QuantyPlugin] Rescue Hook Failed:', e);
            }
        }, 10000);

        runtime.logger.success('[QuantyPlugin] Rescue Hook Armed');

        // Логика синхронизации подключений
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
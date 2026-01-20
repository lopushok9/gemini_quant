import { EventEmitter } from 'events';

class InternalMessageBus extends EventEmitter { }

// Используем globalThis чтобы гарантировать один экземпляр bus
// между агентом (dist/index.js) и сервером (start-server.ts)
const GLOBAL_BUS_KEY = '__quanty_internal_message_bus__';

let internalMessageBus: InternalMessageBus;

if ((globalThis as any)[GLOBAL_BUS_KEY]) {
    internalMessageBus = (globalThis as any)[GLOBAL_BUS_KEY];
} else {
    internalMessageBus = new InternalMessageBus();
    internalMessageBus.setMaxListeners(50);
    (globalThis as any)[GLOBAL_BUS_KEY] = internalMessageBus;
}

export default internalMessageBus;

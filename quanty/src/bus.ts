import { EventEmitter } from 'events';

class InternalMessageBus extends EventEmitter { }

const internalMessageBus = new InternalMessageBus();
internalMessageBus.setMaxListeners(50);

export default internalMessageBus;

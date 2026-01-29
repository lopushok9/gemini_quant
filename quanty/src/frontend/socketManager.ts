import { io, Socket } from 'socket.io-client';

const SOCKET_MESSAGE_TYPE = {
    ROOM_JOINING: 1,
    SEND_MESSAGE: 2,
    MESSAGE: 3,
    ACK: 4,
    THINKING: 5,
    CONTROL: 6,
} as const;

// Generate a stable valid UUID for the session
export const sessionUserId = '00000000-0000-0000-0000-000000000001';

class SocketManager {
    private socket: Socket | null = null;
    private userId: string = sessionUserId;

    connect() {
        if (this.socket?.connected) return this.socket;

        console.log('🔗 Attemping socket connection with entityId:', this.userId);

        this.socket = io(window.location.origin, {
            autoConnect: true,
            reconnection: true,
            transports: ['websocket', 'polling'],
            auth: {
                entityId: this.userId
            }
        });

        this.socket.on('connect', () => {
            console.log('✅ Connected to Quanty via Socket.IO. Socket ID:', this.socket?.id);
        });

        this.socket.on('connect_error', (error) => {
            console.error('❌ Socket connection error:', error.message);
        });

        this.socket.on('authenticated', (data) => {
            console.log('🔓 Socket authenticated:', data);
        });

        this.socket.on('channel_joined', (data) => {
            console.log('📬 Channel joined confirmation:', data);
        });

        return this.socket;
    }

    joinRoom(agentId: string) {
        if (!this.socket) {
            console.error('Cannot join room: Socket not connected');
            return;
        }
        console.log('🚪 Joining channel:', agentId);
        this.socket.emit('message', {
            type: SOCKET_MESSAGE_TYPE.ROOM_JOINING,
            payload: {
                channelId: agentId,
                entityId: this.userId,
                messageServerId: '00000000-0000-0000-0000-000000000000',
            },
        });
    }

    sendMessage(agentId: string, text: string, conversationHistory?: Array<{ role: string; content: string }>) {
        if (!this.socket) {
            console.error('Cannot send message: Socket not connected');
            return;
        }

        const history = conversationHistory || [];

        // Format history as a single string to include in the message text
        // This is the simplest approach - append history context to the message itself
        let messageWithContext = text;
        if (history.length > 0) {
            const historyText = history.slice(-6).map(m =>
                `${m.role === 'user' ? 'User' : 'Quanty'}: ${m.content}`
            ).join('\n');
            messageWithContext = `[CONVERSATION HISTORY]\n${historyText}\n[END HISTORY]\n\nUser's current message: ${text}`;
        }

        const payload = {
            senderId: this.userId,
            senderName: 'Investor',
            message: messageWithContext,
            channelId: agentId,
            messageServerId: '00000000-0000-0000-0000-000000000000',
            source: 'direct'
        };

        console.log('📤 Emitting SEND_MESSAGE with history context, history length:', history.length);

        this.socket.emit('message', {
            type: SOCKET_MESSAGE_TYPE.SEND_MESSAGE,
            payload: payload,
        });
    }

    onMessage(callback: (data: any) => void) {
        if (!this.socket) return () => { };

        const handleBroadcast = (data: any) => {
            console.log('📩 Broadcast detail:', data);
            // Sometimes Eliza sends nested payloads
            const msg = data.payload || data;
            if (msg.content || msg.text) {
                callback(msg);
            }
        };

        this.socket.on('messageBroadcast', handleBroadcast);
        // Also listen for generic 'message' if it's sent that way
        this.socket.on('message', handleBroadcast);

        return () => {
            this.socket?.off('messageBroadcast', handleBroadcast);
            this.socket?.off('message', handleBroadcast);
        };
    }
}

export const socketManager = new SocketManager();

import { STORAGE_KEYS } from '../constants';

export interface ChatMessage {
    roomId: string;
    timestampId: string;
    senderId: string;
    senderName: string;
    content: string;
    type: string;
}

type MessageCallback = (msg: ChatMessage) => void;

class ChatService {
    private ws: WebSocket | null = null;
    private callbacks: Map<string, MessageCallback[]> = new Map();
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private userId: string | null = null;

    connect(userId: string) {
        if (this.ws?.readyState === WebSocket.OPEN) return;
        this.userId = userId;

        const token = localStorage.getItem(STORAGE_KEYS.JWT);
        const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
        const wsUrl = `wss://ek5dythoh9.execute-api.ap-southeast-1.amazonaws.com/prod?userId=${userId}${tokenParam}`;
        console.log('Connecting to Chat WS...', wsUrl);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('Chat WS Connected');
            this.reconnectAttempts = 0;
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Chat WS Message received:', data);

                // Match specific room callbacks
                const roomId = data.roomId;
                if (roomId && this.callbacks.has(roomId)) {
                    this.callbacks.get(roomId)?.forEach(cb => cb(data));
                }

                // Also global callbacks (e.g. for notifications)
                if (this.callbacks.has('*')) {
                    this.callbacks.get('*')?.forEach(cb => cb(data));
                }
            } catch (err) {
                console.error('Failed to parse WS message', err);
            }
        };

        this.ws.onclose = () => {
            console.log('Chat WS Closed');
            this.handleReconnect();
        };

        this.ws.onerror = (err) => {
            console.error('Chat WS Error:', err);
        };
    }

    private handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
            console.log(`Reconnecting in ${delay}ms...`);
            setTimeout(() => {
                if (this.userId) this.connect(this.userId);
            }, delay);
        }
    }

    subscribe(roomId: string, callback: MessageCallback) {
        if (!this.callbacks.has(roomId)) {
            this.callbacks.set(roomId, []);
        }
        this.callbacks.get(roomId)?.push(callback);
        return () => this.unsubscribe(roomId, callback);
    }

    private unsubscribe(roomId: string, callback: MessageCallback) {
        const list = this.callbacks.get(roomId);
        if (list) {
            this.callbacks.set(roomId, list.filter(cb => cb !== callback));
        }
    }

    sendMessage(roomId: string, content: string, type: string = 'text') {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            console.error('Chat WS not connected');
            return false;
        }

        const payload = {
            action: 'sendMessage',
            roomId,
            content,
            type
        };

        this.ws.send(JSON.stringify(payload));
        return true;
    }

    disconnect() {
        this.ws?.close();
        this.ws = null;
        this.userId = null;
    }
}

export const chatService = new ChatService();

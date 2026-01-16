import React, { useState, useEffect, useRef } from 'react';
import {
    Send,
    Bot,
    User,
    Loader2,
    TrendingUp,
    AlertCircle,
    RefreshCw,
    Search,
    LineChart,
    BarChart3,
    ShieldAlert,
    Code2
} from 'lucide-react';
import { socketManager } from './socketManager';
import { useQuery } from '@tanstack/react-query';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    id: string;
    timestamp: number;
    isThinking?: boolean;
}

export function App() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const [agentId, setAgentId] = useState(window.ELIZA_CONFIG?.agentId || '');
    const [debugInfo, setDebugInfo] = useState<string>('Initializing...');

    // Fetch agentId if missing and setup socket
    useEffect(() => {
        if (!agentId) {
            const apiBase = window.ELIZA_CONFIG?.apiBase || '';
            fetch(`${apiBase}/api/agents`)
                .then(res => res.json())
                .then(data => {
                    const agents = data.data?.agents || data.agents || (Array.isArray(data) ? data : []);
                    if (agents.length > 0) {
                        const id = agents[0].id;
                        console.log('✅ Found agent:', id);
                        setAgentId(id);
                    }
                })
                .catch(err => console.error('Failed to fetch agents:', err));
        }
    }, [agentId]);

    // Socket Connection Logic
    useEffect(() => {
        if (!agentId) return;

        console.log('🔌 Connecting to socket for agent:', agentId);
        const socket = socketManager.connect();

        const setupSocket = () => {
            socketManager.joinRoom(agentId);
            setDebugInfo(`Analyst Link: Active`);
        };

        if (socket.connected) {
            setupSocket();
        } else {
            socket.on('connect', setupSocket);
        }

        const unsubscribe = socketManager.onMessage((data) => {
            console.log('📩 Socket message received:', data);

            // Check if it's a "thinking" event or actual message
            if (data.type === 5) { // THINKING
                // We show thinking state during the sending process anyway
                return;
            }

            const botText = data.content || data.text || '';
            if (!botText) return;

            setMessages(prev => {
                // Find if there's an existing thinking message to replace
                const lastMsg = prev[prev.length - 1];
                if (lastMsg?.role === 'assistant' && lastMsg.isThinking) {
                    return [...prev.slice(0, -1), {
                        role: 'assistant',
                        content: botText,
                        id: data.id || Date.now().toString(),
                        timestamp: Date.now(),
                        isThinking: false
                    }];
                }
                // Otherwise just add it
                return [...prev, {
                    role: 'assistant',
                    content: botText,
                    id: data.id || Date.now().toString(),
                    timestamp: Date.now(),
                    isThinking: false
                }];
            });
            setIsSending(false);
        });

        return () => {
            unsubscribe();
            socket.off('connect', setupSocket);
        };
    }, [agentId]);

    // Apply dark mode initially
    useEffect(() => {
        document.documentElement.classList.add('dark');
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isSending || !agentId) return;

        const userMessage: Message = {
            role: 'user',
            content: input,
            id: Date.now().toString(),
            timestamp: Date.now(),
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsSending(true);

        // Add thinking message to UI
        const botId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            id: botId,
            timestamp: Date.now(),
            isThinking: true
        }]);

        try {
            console.log('📤 Sending via socket:', input);
            socketManager.sendMessage(agentId, input);

            // Set a timeout in case socket fails to respond
            setTimeout(() => {
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last?.id === botId && last.isThinking && isSending) {
                        setIsSending(false);
                        return prev.map(m => m.id === botId ? { ...m, content: 'Analysis timed out. Please retry.', isThinking: false } : m);
                    }
                    return prev;
                });
            }, 30000);

        } catch (error: any) {
            console.error('Socket Send Error:', error);
            setMessages(prev => prev.map(m =>
                m.id === botId
                    ? { ...m, content: `Error: ${error.message}`, isThinking: false }
                    : m
            ));
            setIsSending(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-background text-foreground font-mono selection:bg-primary/30">
            {/* Header */}
            <header className="border-b border-border bg-background/50 backdrop-blur p-4 flex items-center justify-between sticky top-0 z-10 h-16">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center text-primary border border-primary/30">
                        <Bot size={20} />
                    </div>
                    <div>
                        <h1 className="text-sm font-bold tracking-wider uppercase text-foreground/90 flex items-center gap-2">
                            Quanty
                            <span className="text-[10px] text-primary/80 font-normal px-1.5 py-0.5 bg-primary/10 rounded border border-primary/20">BETA</span>
                        </h1>
                    </div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border/50 text-muted-foreground">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                        <span className="tracking-widest text-[10px] font-bold">LIVE</span>
                    </div>
                </div>
            </header>

            {/* Main Chat Area */}
            <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-8 scrollbar-thin">
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center space-y-10 animate-in fade-in zoom-in-95 duration-700">
                        <div className="space-y-6">
                            <div className="inline-flex p-8 rounded-full bg-linear-to-b from-primary/20 to-transparent border border-primary/20 shadow-[0_0_30px_-5px_var(--color-primary)]">
                                <LineChart size={64} className="text-primary drop-shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-3xl font-bold tracking-tight text-foreground">Quanty Protocol</h2>
                                <p className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed">
                                    Institutional-grade analytics terminal.<br />
                                    Connected to internal liquidity monitors.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
                            <QuickAction
                                icon={<Search size={18} />}
                                title="Market Scan"
                                desc="Deep diagnostics on ticker"
                                onClick={() => setInput("Analyze BTC")}
                            />
                            <QuickAction
                                icon={<BarChart3 size={18} />}
                                title="Institutional Flow"
                                desc="Check equity volume"
                                onClick={() => setInput("Analyze NVDA")}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="max-w-3xl mx-auto space-y-8">
                        {messages.map((m) => (
                            <MessageBubble key={m.id} message={m} />
                        ))}
                        <div ref={messagesEndRef} className="h-4" />
                    </div>
                )}
            </main>

            {/* Input Footer */}
            <footer className="p-4 sm:p-6 bg-background/80 backdrop-blur border-t border-border/40">
                <div className="max-w-3xl mx-auto">
                    <form onSubmit={sendMessage} className="relative flex items-end gap-2 bg-muted/30 p-1.5 rounded-xl border border-border/50 focus-within:border-primary/50 focus-within:bg-muted/50 focus-within:shadow-[0_0_20px_-10px_var(--color-primary)] transition-all duration-300">
                        <div className="absolute left-4 top-4 text-muted-foreground/40">
                            <Code2 size={16} />
                        </div>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Enter command or analysis request..."
                            className="w-full bg-transparent border-none pl-10 pr-4 py-3 outline-none text-sm placeholder:text-muted-foreground/50 min-h-[48px] font-mono text-foreground"
                            disabled={isSending}
                            autoComplete="off"
                        />
                        <div className="flex items-center gap-2 pb-1 pr-1">
                            {isSending ? (
                                <div className="p-2.5 text-primary/80">
                                    <Loader2 size={18} className="animate-spin" />
                                </div>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={!input.trim() || isSending}
                                    className="p-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 disabled:opacity-0 disabled:scale-90 transition-all duration-200"
                                >
                                    <Send size={16} />
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            </footer>
        </div>
    );
}

function MessageBubble({ message }: { message: Message }) {
    const isBot = message.role === 'assistant';

    return (
        <div className={`flex gap-5 ${isBot ? '' : 'flex-row-reverse'} group animate-in fade-in slide-in-from-bottom-3 duration-500`}>
            {/* Avatar */}
            <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-xs shadow-sm
                ${isBot
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'bg-muted text-muted-foreground border border-border'
                }`}>
                {isBot ? <Bot size={18} /> : <User size={18} />}
            </div>

            {/* Content */}
            <div className={`flex flex-col max-w-[85%] sm:max-w-[75%] space-y-1.5 ${isBot ? 'items-start' : 'items-end'}`}>
                <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        {isBot ? 'Quanty System' : 'Operator'}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40 font-mono">
                        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
                <div className={`
                    relative px-6 py-4 text-sm leading-7 shadow-sm font-light tracking-wide
                    ${isBot
                        ? 'bg-card/80 border border-border/60 rounded-2xl rounded-tl-sm text-foreground/90 backdrop-blur-sm'
                        : 'bg-primary/90 text-primary-foreground rounded-2xl rounded-tr-sm border border-primary/50'
                    }
                `}>
                    {message.isThinking ? (
                        <div className="flex items-center gap-3 opacity-70">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                            </span>
                            <span className="text-xs font-mono uppercase tracking-widest">Processing</span>
                        </div>
                    ) : (
                        <div className="whitespace-pre-wrap">{message.content}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

function QuickAction({ icon, title, desc, onClick }: { icon: React.ReactNode, title: string, desc: string, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="flex items-center gap-4 p-5 bg-card/40 hover:bg-card/80 border border-border/50 hover:border-primary/40 rounded-xl transition-all group text-left backdrop-blur-sm hover:shadow-lg hover:shadow-primary/5"
        >
            <div className="p-3 rounded-lg bg-background/50 group-hover:bg-primary/20 group-hover:text-primary transition-colors border border-border/50 group-hover:border-primary/30">
                {icon}
            </div>
            <div>
                <div className="text-sm font-bold text-foreground/90 group-hover:text-primary transition-colors uppercase tracking-wide">{title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 font-light">{desc}</div>
            </div>
        </button>
    );
}

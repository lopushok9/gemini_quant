import React, { useState, useEffect, useRef } from 'react';
import {
    Send,
    Bot,
    User,
    Loader2,
    Search,
    BarChart3,
    Code2,
    MessageSquare,
    History,
    Settings,
    MoreVertical,
    LogOut,
    Menu,
    X,
    Info
} from 'lucide-react';
import { socketManager, sessionUserId } from './socketManager';
import { useQuery } from '@tanstack/react-query';
import elizaLogo from './assets/elizaos-powered.png';

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
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [showDisclaimer, setShowDisclaimer] = useState(false);

    const [agentId, setAgentId] = useState(window.ELIZA_CONFIG?.agentId || '');

    // Fetch agentId if missing
    useEffect(() => {
        if (!agentId) {
            const apiBase = window.ELIZA_CONFIG?.apiBase || '';
            fetch(`${apiBase}/api/agents`)
                .then(res => res.json())
                .then(data => {
                    const agents = data.data?.agents || data.agents || (Array.isArray(data) ? data : []);
                    if (agents.length > 0) {
                        setAgentId(agents[0].id);
                    }
                })
                .catch(err => console.error('Failed to fetch agents:', err));
        }
    }, [agentId]);

    // Socket Connection Logic
    useEffect(() => {
        if (!agentId) return;

        const socket = socketManager.connect();

        const setupSocket = () => {
            socketManager.joinRoom(agentId);
        };

        if (socket.connected) {
            setupSocket();
        } else {
            socket.on('connect', setupSocket);
        }

        const unsubscribe = socketManager.onMessage((data) => {
            // CRITICAL FIX: Ignore messages sent by ME (the user)
            // This prevents the "echo" effect where the server broadcasts my own message back.
            if (data.senderId === sessionUserId || data.userId === sessionUserId) {
                return;
            }

            // Ignore system thinking events if we handle them locally (optional, but good for cleanup)
            if (data.type === 5) return;

            const botText = data.content || data.text || '';
            if (!botText) return;

            setMessages(prev => {
                // Remove the "Thinking" placeholder if it exists and looks like it belongs to this response
                // For simplicity, we remove the *last* message if it is thinking
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
                // Otherwise append new message
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

    // Apply dark mode
    useEffect(() => {
        document.documentElement.classList.add('dark');
    }, []);

    // Scroll handling
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isSending || !agentId) return;

        // 1. Optimistically Add User Message
        const userMessage: Message = {
            role: 'user',
            content: input,
            id: Date.now().toString(),
            timestamp: Date.now(),
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsSending(true);

        // 2. Add "Thinking" Placeholder immediately
        const botId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            id: botId,
            timestamp: Date.now(),
            isThinking: true
        }]);

        try {
            // Build conversation history from existing messages (excluding the current one being sent)
            const conversationHistory = messages.map(m => ({
                role: m.role,
                content: m.content
            }));

            socketManager.sendMessage(agentId, input, conversationHistory);

            // Timeout safety
            setTimeout(() => {
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last?.id === botId && last.isThinking && isSending) {
                        setIsSending(false);
                        return prev.map(m => m.id === botId ? { ...m, content: 'Response timed out.', isThinking: false } : m);
                    }
                    return prev;
                });
            }, 30000);

        } catch (error: any) {
            setMessages(prev => prev.map(m =>
                m.id === botId
                    ? { ...m, content: `Error: ${error.message}`, isThinking: false }
                    : m
            ));
            setIsSending(false);
        }
    };

    return (
        <div className="flex h-screen bg-[#111] text-foreground font-mono overflow-hidden selection:bg-primary/20">
            {/* Mobile Sidebar Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-20 md:hidden backdrop-blur-sm"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar (Otaku Style) */}
            <aside
                className={`
                    fixed md:relative z-30 w-[280px] h-full flex flex-col
                    bg-[#18181b] border-r border-[#333] transition-transform duration-300
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                `}
            >
                {/* Brand Header */}
                <div className="h-16 flex items-center px-6 border-b border-[#333]">
                    <div className="w-8 h-8 rounded bg-blue-600/20 text-blue-500 flex items-center justify-center mr-3 border border-blue-600/30">
                        <Bot size={20} />
                    </div>
                    <div className="flex flex-col">
                        <span className="font-bold tracking-widest text-lg text-white font-sans uppercase">QUANTY</span>
                        <span className="text-[10px] text-muted-foreground tracking-widest uppercase">Market Analysis Agent</span>
                    </div>
                </div>

                {/* Navigation */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto py-6 px-4 space-y-6">
                        {/* Chat History Section */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between px-2 text-xs font-bold text-blue-500 uppercase tracking-widest mb-3">
                                <span className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                    Chat History
                                </span>
                                <Info size={12} onClick={() => setShowDisclaimer(true)} className="opacity-50 hover:opacity-100 cursor-pointer" />
                            </div>

                            <div className="space-y-1">
                                <div className="px-3 py-2 bg-[#27272a] border border-[#333] rounded text-xs text-white/90 cursor-pointer hover:border-blue-500/50 transition-colors">
                                    <span className="opacity-50 mr-2 text-[10px]">TODAY</span>
                                    Initial Greeting
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="px-2 text-xs font-bold text-neutral-600 uppercase tracking-widest mb-3">
                                Functions
                            </div>
                            <button onClick={() => setInput("Market Scan")} className="w-full text-left px-3 py-2 rounded text-xs text-neutral-400 hover:text-white hover:bg-[#27272a] flex items-center gap-3 transition-colors">
                                <Search size={14} />
                                Market Scan
                            </button>
                        </div>
                    </div>

                    {/* Powered By Logo */}
                    <div className="p-6 mt-auto">
                        <img src={elizaLogo} alt="Powered by ElizaOS" className="w-40 opacity-60 hover:opacity-100 transition-opacity" />
                    </div>
                </div>

                {/* User Footer */}
                <div className="p-4 border-t border-[#333] bg-[#141417]">
                    <div className="flex items-center gap-3 px-2 py-1">
                        <div className="w-8 h-8 rounded bg-gradient-to-tr from-orange-500 to-yellow-500 flex items-center justify-center text-black font-bold text-xs ring-2 ring-[#333]">
                            U
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-white truncate">OPERATOR</div>
                            <div className="text-[10px] text-neutral-500 truncate">connected</div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Chat Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-[#09090b]">
                {/* Main Header */}
                <header className="h-16 border-b border-[#222] flex items-center justify-between px-6 bg-[#09090b]">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden text-neutral-400 hover:text-white">
                            <Menu size={24} />
                        </button>
                        <h1 className="text-2xl font-black tracking-tighter text-white uppercase font-sans">CHAT</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-[#18181b] border border-[#333] text-neutral-400">
                            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                            <span className="text-[10px] font-bold tracking-widest uppercase">System Online</span>
                        </div>
                    </div>
                </header>

                {/* Messages List */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent">
                    {messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-40">
                            <Bot size={48} className="text-neutral-600 mb-4" />
                            <p className="text-sm text-neutral-500 font-mono">QUANTY SYSTEM READY</p>
                        </div>
                    ) : (
                        <div className="max-w-4xl mx-auto space-y-6 w-full">
                            {messages.map((m) => (
                                <MessageBubble key={m.id} message={m} />
                            ))}
                            <div ref={messagesEndRef} className="h-4" />
                        </div>
                    )}
                </div>

                {/* Input Area */}
                <div className="p-4 sm:p-6 bg-[#09090b] border-t border-[#222]">
                    <div className="max-w-4xl mx-auto">
                        <form onSubmit={sendMessage} className="relative group">
                            <div className="relative flex items-center gap-3 bg-[#18181b] p-2 rounded-lg border border-[#333] group-focus-within:border-neutral-500 transition-colors">
                                <div className="pl-3 text-neutral-500">
                                    <Code2 size={18} />
                                </div>
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder="Type your command..."
                                    className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder-neutral-600 h-10 font-mono"
                                    disabled={isSending}
                                    autoComplete="off"
                                />
                                <button
                                    type="submit"
                                    disabled={!input.trim() || isSending}
                                    className="p-2 rounded bg-[#27272a] text-white hover:bg-blue-600 hover:text-white disabled:opacity-50 disabled:hover:bg-[#27272a] transition-all"
                                >
                                    {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </main>

            {/* Disclaimer Modal */}
            {showDisclaimer && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[#18181b] border border-[#333] p-6 rounded-lg max-w-md w-full shadow-2xl relative">
                        <button 
                            onClick={() => setShowDisclaimer(false)}
                            className="absolute top-4 right-4 text-neutral-500 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>
                        
                        <div className="flex items-center gap-3 mb-4 text-yellow-500">
                            <Info size={24} />
                            <h2 className="text-lg font-bold uppercase tracking-widest">Disclaimer</h2>
                        </div>
                        
                        <div className="space-y-4 text-sm text-neutral-300 font-mono leading-relaxed">
                            <p>
                                The information provided by this agent is for <strong>educational and informational purposes only</strong>.
                            </p>
                            <p>
                                It does <span className="text-red-400 font-bold">NOT</span> constitute financial advice, investment advice, or trading recommendations.
                            </p>
                            <div className="bg-[#27272a] p-3 rounded border border-[#333] text-xs">
                                <strong className="text-blue-400 block mb-1">KEY PRINCIPLES:</strong>
                                <ul className="list-disc pl-4 space-y-1 text-neutral-400">
                                    <li><strong>DYOR:</strong> Always Do Your Own Research.</li>
                                    <li><strong>NFA:</strong> This is Not Financial Advice.</li>
                                </ul>
                            </div>
                            <p className="text-xs text-neutral-500">
                                Markets are volatile. You are solely responsible for your investment decisions.
                            </p>
                        </div>

                        <button 
                            onClick={() => setShowDisclaimer(false)}
                            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded text-xs uppercase tracking-widest transition-colors"
                        >
                            I Understand
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function MessageBubble({ message }: { message: Message }) {
    const isBot = message.role === 'assistant';

    return (
        <div className={`flex w-full ${isBot ? 'justify-start' : 'justify-end'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
            <div className={`max-w-[85%] md:max-w-[70%] flex gap-4 ${isBot ? 'flex-row' : 'flex-row-reverse'}`}>

                {/* Content Bubble */}
                <div className="flex flex-col gap-1 min-w-0">
                    {/* Message Meta */}
                    <div className={`flex items-center gap-2 ${isBot ? '' : 'flex-row-reverse'} opacity-50 mb-1`}>
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${isBot ? 'text-blue-400' : 'text-neutral-400'}`}>
                            {isBot ? 'Quanty' : 'You'}
                        </span>
                        <span className="text-[10px] font-mono text-neutral-500">
                            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                    </div>

                    {/* Bubble Card */}
                    <div className={`
                        relative p-4 text-sm leading-relaxed font-mono shadow-md
                        ${isBot
                            ? 'bg-[#1a1c1e] text-neutral-200 border border-[#333] rounded-r-lg rounded-bl-lg'
                            : 'bg-blue-600 text-white border border-blue-500 rounded-l-lg rounded-br-lg'
                        }
                    `}>
                        {message.isThinking ? (
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"></span>
                                <span className="text-[10px] uppercase tracking-widest ml-2 opacity-70">Computing</span>
                            </div>
                        ) : (
                            <div className="whitespace-pre-wrap">{message.content}</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

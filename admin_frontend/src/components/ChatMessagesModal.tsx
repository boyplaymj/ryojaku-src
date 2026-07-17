import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, MessageSquare, Info, ShieldCheck, Maximize2 } from 'lucide-react';
import { api } from '../services/api';

interface ChatMessage {
    roomId: string;
    timestampId: string;
    senderId: string;
    senderName: string;
    content: string;
    type: string;
    ttl: number;
}

interface ChatMessagesModalProps {
    roomId: string;
    roomTitle: string;
    onClose: () => void;
}

const ChatMessagesModal: React.FC<ChatMessagesModalProps> = ({ roomId, roomTitle, onClose }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Color mapping for senders to make it easier to distinguish
    const [senderColors, setSenderColors] = useState<Record<string, string>>({});

    const colors = [
        'text-cyan-400', 'text-emerald-400', 'text-amber-400',
        'text-rose-400', 'text-indigo-400', 'text-fuchsia-400',
        'text-orange-400', 'text-sky-400'
    ];

    useEffect(() => {
        const fetchMessages = async () => {
            try {
                setLoading(true);
                const data = await api.analysis.getMessages(roomId, 200); // Fetch up to 200 messages for deeper analysis
                const sortedMessages = [...(data || [])].sort((a, b) => {
                    const tsA = a.timestampId.split('#')[0];
                    const tsB = b.timestampId.split('#')[0];
                    return tsA.localeCompare(tsB);
                });

                // Assign colors to senders
                const newSenderColors: Record<string, string> = {};
                let colorIdx = 0;
                sortedMessages.forEach(msg => {
                    if (msg.senderId && !newSenderColors[msg.senderId]) {
                        newSenderColors[msg.senderId] = colors[colorIdx % colors.length];
                        colorIdx++;
                    }
                });

                setSenderColors(newSenderColors);
                setMessages(sortedMessages);
            } catch (err) {
                console.error('Failed to fetch messages:', err);
            } finally {
                setLoading(false);
            }
        };

        if (roomId) {
            fetchMessages();
        }
    }, [roomId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const formatFullTimestamp = (tsId: string) => {
        try {
            const nanoStr = tsId.split('#')[0];
            const ms = BigInt(nanoStr) / BigInt(1000000);
            return new Date(Number(ms)).toLocaleString('zh-TW', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        } catch (e) {
            return 'Unknown';
        }
    };

    const formatTimeOnly = (tsId: string) => {
        try {
            const nanoStr = tsId.split('#')[0];
            const ms = BigInt(nanoStr) / BigInt(1000000);
            return new Date(Number(ms)).toLocaleString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } catch (e) {
            return '';
        }
    };

    const isSameDate = (tsA: string, tsB: string) => {
        try {
            const dateA = new Date(Number(BigInt(tsA.split('#')[0]) / BigInt(1000000))).toDateString();
            const dateB = new Date(Number(BigInt(tsB.split('#')[0]) / BigInt(1000000))).toDateString();
            return dateA === dateB;
        } catch (e) {
            return true;
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
            {/* Modal Body */}
            <div
                className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-5 border-b border-white/5 flex items-center justify-between bg-slate-800/40 backdrop-blur-xl shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <div className="p-3 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-2xl text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                                <MessageSquare size={24} />
                            </div>
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-slate-900 rounded-full"></div>
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-lg leading-tight">{roomTitle}</h3>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="px-1.5 py-0.5 rounded-md bg-white/5 text-[10px] text-slate-400 font-mono tracking-wider uppercase border border-white/5">
                                    ROOM_ID: {roomId.split('-')[0]}...
                                </span>
                                <div className="flex items-center gap-1 text-[10px] text-emerald-400/80">
                                    <ShieldCheck size={10} />
                                    <span>深度監督中</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2.5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-all transform hover:rotate-90"
                    >
                        <X size={22} />
                    </button>
                </div>

                {/* Messages Area */}
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-gradient-to-b from-slate-950/40 to-slate-900/20"
                >
                    {loading ? (
                        <div className="h-full flex flex-col items-center justify-center space-y-4">
                            <div className="relative">
                                <div className="w-12 h-12 border-2 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-6 h-6 border-2 border-blue-400/10 border-b-blue-400 rounded-full animate-spin-reverse"></div>
                                </div>
                            </div>
                            <p className="text-slate-400 text-sm font-medium tracking-widest uppercase animate-pulse">Decrypting Feed...</p>
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                            <div className="p-6 bg-white/5 rounded-full border border-white/5">
                                <MessageSquare size={48} className="opacity-20" />
                            </div>
                            <div className="text-center">
                                <p className="font-bold text-slate-400">尚無通訊記錄</p>
                                <p className="text-xs text-slate-600 mt-1">此聊天室目前尚未產生任何封包</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {messages.map((msg, idx) => {
                                const showDateSeparator = idx === 0 || !isSameDate(messages[idx - 1].timestampId, msg.timestampId);
                                const isSystem = msg.type === 'system';
                                const senderColor = isSystem ? 'text-slate-500' : (senderColors[msg.senderId] || 'text-cyan-400');

                                return (
                                    <React.Fragment key={msg.timestampId || idx}>
                                        {showDateSeparator && (
                                            <div className="flex items-center gap-4 py-2">
                                                <div className="flex-1 h-px bg-white/5"></div>
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] bg-slate-800/50 px-3 py-1 rounded-full border border-white/5">
                                                    {new Date(Number(BigInt(msg.timestampId.split('#')[0]) / BigInt(1000000))).toLocaleDateString('zh-TW', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                                </div>
                                                <div className="flex-1 h-px bg-white/5"></div>
                                            </div>
                                        )}

                                        <div className={`flex flex-col ${isSystem ? 'items-center px-8' : 'items-start'}`}>
                                            {!isSystem && (
                                                <div className="flex items-center gap-2 mb-1.5 ml-1">
                                                    <span className={`text-[13px] font-black tracking-tight ${senderColor}`}>
                                                        {msg.senderName}
                                                    </span>
                                                    <span className="text-[9px] text-slate-600 font-mono tracking-tighter opacity-80" title={formatFullTimestamp(msg.timestampId)}>
                                                        [{formatTimeOnly(msg.timestampId)}]
                                                    </span>
                                                </div>
                                            )}

                                            <div className="relative group max-w-[85%]">
                                                <div className={`
                                                    rounded-2xl text-[14px] leading-relaxed transition-all border
                                                    ${isSystem
                                                        ? 'bg-slate-800/20 text-slate-500 italic border-white/5 text-center text-xs px-4 py-3'
                                                        : msg.type === 'image'
                                                            ? 'bg-slate-800/40 border-white/10 p-1.5 overflow-hidden'
                                                            : 'bg-slate-800/80 text-slate-200 border-white/10 hover:border-cyan-500/30 px-4 py-3'
                                                    }
                                                `}>
                                                    {isSystem ? (
                                                        <div className="flex items-center gap-2 justify-center">
                                                            <Info size={12} className="opacity-50" />
                                                            {msg.content}
                                                        </div>
                                                    ) : msg.type === 'image' ? (
                                                        <div className="relative group/img">
                                                            <img
                                                                src={msg.content}
                                                                alt="Chat Attachment"
                                                                className="max-w-[180px] max-h-[240px] md:max-w-[280px] md:max-h-[360px] object-cover rounded-xl shadow-lg cursor-zoom-in transition-all active:scale-[0.98]"
                                                                onClick={() => setPreviewImage(msg.content)}
                                                            />
                                                            <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 flex items-center justify-center transition-colors pointer-events-none opacity-0 group-hover/img:opacity-100">
                                                                <Maximize2 className="text-white drop-shadow-lg" size={24} />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        msg.content
                                                    )}
                                                </div>

                                                {!isSystem && (
                                                    <div className="absolute -left-12 top-0 bottom-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <div className="p-1 px-2 bg-slate-800 rounded text-[9px] text-slate-500 whitespace-nowrap border border-white/5 shadow-xl">
                                                            {formatTimeOnly(msg.timestampId)}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer Info */}
                <div className="p-4 px-6 bg-slate-800/60 backdrop-blur-xl border-t border-white/10 text-[11px] text-slate-500 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse"></div>
                            <span className="font-mono text-[9px] uppercase tracking-wider text-slate-400">Live Secure Stream</span>
                        </div>
                        <span className="opacity-50">|</span>
                        <div className="flex items-center gap-1">
                            <Clock size={12} className="opacity-50" />
                            <span>顯示最後 {messages.length} 筆記錄</span>
                        </div>
                    </div>
                    <div className="italic opacity-60 font-serif">
                        Confidential Data Access
                    </div>
                </div>
            </div>

            {/* Internal Image Preview Overlay */}
            {previewImage && (
                <div
                    className="fixed inset-0 z-[10000] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-8 animate-in fade-in duration-300"
                    onClick={() => setPreviewImage(null)}
                >
                    <div className="relative max-w-full max-h-full flex items-center justify-center">
                        <img
                            src={previewImage}
                            alt="Preview"
                            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-[0_0_100px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-300"
                            onClick={(e) => e.stopPropagation()}
                        />
                        <button
                            onClick={() => setPreviewImage(null)}
                            className="absolute -top-12 right-0 p-2 text-white/50 hover:text-white transition-colors"
                        >
                            <X size={32} />
                        </button>
                        <div className="absolute -bottom-12 left-0 right-0 text-center text-slate-500 font-mono text-[10px] uppercase tracking-[0.3em]">
                            點擊背景返回對話
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
};

export default ChatMessagesModal;

import React, { useState } from 'react';
import { Send, Loader2, AlertCircle, CheckCircle2, Megaphone } from 'lucide-react';
import { api } from '../services/api';

const PushNotifications: React.FC = () => {
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [url, setUrl] = useState('');
    const [sending, setSending] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!confirm('您確定要向所有訂閱用戶發送此推送通知嗎？此操作無法撤回。')) return;

        setSending(true);
        setStatus(null);
        try {
            await api.push.sendAll({ title, body, url });
            setStatus({ type: 'success', message: '通知已排程並開始發送。' });
            setTitle('');
            setBody('');
            setUrl('');
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || '發送失敗，請稍後再試。' });
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 md:space-y-8">
            <header>
                <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
                    <Megaphone className="text-cyan-400" size={32} />
                    全體推送通知
                </h1>
                <p className="text-slate-400 mt-2 text-sm md:text-base">向所有已訂閱 Web Push 的用戶發送即時廣播通知。可用於發布維護公告、活動通知等。</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                {/* Form Section */}
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 md:p-8 rounded-2xl shadow-2xl">
                    <form onSubmit={handleSend} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2 font-mono uppercase tracking-wider">通知標題 (Title)</label>
                            <input
                                required
                                className="w-full bg-slate-800/80 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-all font-medium placeholder:text-slate-600"
                                placeholder="例如: 系統維護公告"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2 font-mono uppercase tracking-wider">通知內容 (Body)</label>
                            <textarea
                                required
                                rows={4}
                                className="w-full bg-slate-800/80 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-all font-medium placeholder:text-slate-600 resize-none"
                                placeholder="輸入詳細的通知內容..."
                                value={body}
                                onChange={e => setBody(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2 font-mono uppercase tracking-wider">點擊跳轉網址 (Optional URL)</label>
                            <input
                                className="w-full bg-slate-800/80 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-all font-medium placeholder:text-slate-600"
                                placeholder="https://jiomj.com/..."
                                value={url}
                                onChange={e => setUrl(e.target.value)}
                            />
                        </div>

                        {status && (
                            <div className={`p-4 rounded-xl flex items-center gap-3 border ${status.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                                {status.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                                <span className="text-sm font-medium">{status.message}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={sending || !title || !body}
                            className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-950 font-black py-4 rounded-xl transition-all shadow-[0_0_25px_rgba(6,182,212,0.4)] flex items-center justify-center gap-2 uppercase tracking-widest text-lg"
                        >
                            {sending ? (
                                <Loader2 className="animate-spin" />
                            ) : (
                                <>
                                    <Send size={20} /> 發送群發通知
                                </>
                            )}
                        </button>
                    </form>
                </div>

                {/* Preview Section */}
                <div className="space-y-6">
                    <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl shadow-xl">
                        <h3 className="text-sm font-bold text-slate-500 mb-6 font-mono uppercase tracking-widest flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                            即時手機預覽效果
                        </h3>

                        <div className="bg-[#1a1c2c] w-full max-w-[280px] mx-auto rounded-[40px] border-[6px] border-[#2d3047] p-4 aspect-[9/19] shadow-inner relative">
                            {/* Phone UI elements */}
                            <div className="w-12 h-1 bg-[#2d3047] rounded-full mx-auto mb-10" />

                            {/* Notification Toast */}
                            <div className="bg-white/90 backdrop-blur rounded-2xl p-3 shadow-lg transform translate-y-4 animate-bounce">
                                <div className="flex gap-2 items-start">
                                    <div className="w-8 h-8 rounded-lg bg-cyan-500 flex items-center justify-center text-white shrink-0">
                                        MJ
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="text-[12px] font-bold text-slate-900 leading-tight truncate">{title || '通知標題預覽'}</h4>
                                        <p className="text-[10px] text-slate-600 line-clamp-2 mt-0.5">{body || '通知內容預覽將會顯示在這裡...'}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Bottom bar */}
                            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-24 h-1 bg-white/20 rounded-full" />
                        </div>
                    </div>

                    <div className="p-6 border border-cyan-500/20 bg-cyan-500/5 rounded-2xl">
                        <h4 className="text-cyan-400 font-bold mb-2 flex items-center gap-2">
                            <AlertCircle size={16} /> 注意事項
                        </h4>
                        <ul className="text-slate-400 text-sm space-y-2 list-disc list-inside">
                            <li>此通知將發送給所有在瀏覽器/手機訂閱了 Web Push 的用戶。</li>
                            <li>發送過程可能需要幾秒到幾分鐘，視訂閱用戶數量而定。</li>
                            <li>請確保標題和內容簡潔明瞭，以提高點擊率。</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PushNotifications;

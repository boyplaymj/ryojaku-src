import React, { useState } from 'react';
import { Share2, Copy, MessageCircle, Send, Check, Link } from 'lucide-react';
import { APP_VERSION } from '../constants';

interface AppShareWidgetProps {
    className?: string;
}

const AppShareWidget: React.FC<AppShareWidgetProps> = ({ className = "" }) => {
    const [copied, setCopied] = useState(false);
    const appUrl = "https://jiomj.com/";
    const appSlogan = "「両雀」- 最好用的麻將約戰與記帳 APP！快跟我一起加入！";

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(appUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const handleLineShare = () => {
        const text = `${appSlogan}\n${appUrl}`;
        window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, '_blank');
    };

    const handleThreadsShare = () => {
        const text = `${appSlogan}\n${appUrl}`;
        window.open(`https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`, '_blank');
    };

    return (
        <div className={`relative bg-white border-b border-black/[0.04] w-full overflow-hidden animate-fade-in ${className}`}>
            <div className="p-4 flex flex-col gap-4">
                {/* Header & Version Combined */}
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <h3 className="text-lg font-bold text-neutral-900 tracking-tight">邀請好友</h3>
                        <p className="text-[0.6875rem] text-neutral-400 font-normal">讓俱樂部一起壯大</p>
                    </div>
                    <div className="px-2.5 py-0.5 bg-[#c5a059]/10 rounded-full">
                        <span className="text-[0.5625rem] font-bold text-[#c5a059] uppercase tracking-wider">V{APP_VERSION}</span>
                    </div>
                </div>

                {/* Integrated Action Panel */}
                <div className="flex flex-col gap-3">
                    {/* URL & Copy */}
                    <div
                        onClick={handleCopy}
                        className="flex items-center justify-between bg-neutral-50 rounded-lg px-4 py-3 cursor-pointer hover:bg-neutral-100 transition-all group relative active:scale-[0.98]"
                    >
                        <div className="flex items-center gap-3 min-w-0 z-10">
                            <Link size="0.875rem" className="text-[#c5a059]" />
                            <span className="text-xs text-neutral-500 font-medium truncate">
                                {appUrl}
                            </span>
                        </div>
                        <div className={`z-10 flex items-center gap-1.5 text-[0.625rem] font-bold uppercase transition-all px-3 py-1 rounded-full ${copied
                            ? 'bg-[#c5a059] text-white shadow-sm'
                            : 'bg-white text-neutral-400 border border-neutral-100 group-hover:border-[#c5a059]/30'
                            }`}>
                            {copied ? <Check size="0.75rem" strokeWidth={3} /> : <Copy size="0.6875rem" strokeWidth={2.5} />}
                            {copied ? '已複製' : '複製連結'}
                        </div>
                    </div>

                    {/* Quick Access Buttons */}
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={handleLineShare}
                            className="flex items-center justify-center gap-2 py-3.5 rounded-lg bg-neutral-900 text-white hover:bg-black transition-all active:scale-[0.95]"
                        >
                            <MessageCircle size="1rem" strokeWidth={2} />
                            <span className="text-xs font-semibold">LINE 分享</span>
                        </button>
                        <button
                            onClick={handleThreadsShare}
                            className="flex items-center justify-center gap-2 py-3.5 rounded-lg bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-all active:scale-[0.95]"
                        >
                            <Send size="1rem" strokeWidth={2} />
                            <span className="text-xs font-semibold">Threads</span>
                        </button>
                    </div>
                </div>

                {/* Footer Micro-detail */}
                <div className="flex items-center justify-between mt-1 opacity-40">
                    <div className="text-[0.5625rem] text-neutral-400 font-medium uppercase tracking-widest text-center w-full">安全連線已啟動 • {new Date().toLocaleDateString('zh-TW')}</div>
                </div>
            </div>
        </div>
    );
};

export default AppShareWidget;

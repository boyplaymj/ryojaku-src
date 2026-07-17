import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { GroupEvent, Post } from '../../types';
import { MapPin, Clock, Users, Coins, Heart, MessageSquare, ShieldAlert, Sparkles, ScrollText, Loader2 } from 'lucide-react';

interface ShareCardProps {
    type: 'event' | 'post';
    data: GroupEvent | Post;
    gameDetail?: any;
    cardRef: React.RefObject<HTMLDivElement | null>;
    authorAvatarBase64?: string | null;
    postImageBase64?: string | null;
}

const ShareCard: React.FC<ShareCardProps> = ({
    type,
    data,
    gameDetail,
    cardRef,
    authorAvatarBase64,
    postImageBase64
}) => {
    const isEvent = type === 'event';
    const event = isEvent ? (data as GroupEvent) : null;
    const post = !isEvent ? (data as Post) : null;

    // 獲取正確的規則、特色與限制
    const getEventDetails = () => {
        if (!event) return { rules: [], features: [], restrictions: [] };

        // 優先從 gameDetail 獲取詳細資訊
        const rules = gameDetail?.gameInfo?.rules ||
            (typeof event.rules === 'string' ? [event.rules] : []);

        const features = gameDetail?.venueFeatures ||
            (typeof event.features === 'string' ? event.features.split(',').filter(Boolean) : []);

        const restrictions = gameDetail?.restrictions ||
            (typeof event.restrictions === 'string' ? event.restrictions.split(',').filter(Boolean) : []);

        return { rules, features, restrictions };
    };

    const { rules, features, restrictions } = getEventDetails();

    // 獲取當前網址作為 QR Code 內容
    const shareUrl = isEvent
        ? `${window.location.origin}/#/event/${event?.id}`
        : `${window.location.origin}/#/post/${post?.postId}`;

    return (
        <div className="fixed -left-[125rem] top-0 pointer-events-none">
            <div
                ref={cardRef}
                className="w-[23.4375rem] bg-white p-4 relative overflow-hidden font-sans text-neutral-900 flex flex-col border border-black/5"
                style={{ minHeight: '35rem' }}
            >
                {/* 背景裝飾 - 雅緻光暈 */}
                <div className="absolute top-[-10%] right-[-10%] w-80 h-80 bg-[#c5a059]/10 rounded-full blur-[6.25rem]"></div>
                <div className="absolute bottom-[-10%] left-[-10%] w-80 h-80 bg-[#c5a059]/5 rounded-full blur-[6.25rem]"></div>

                {/* 背景紋理 - 改用 CSS Grid 代替外部圖片消除 CORS 風險 */}
                <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'radial-gradient(#000 0.0625rem, transparent 0)', backgroundSize: '1.25rem 1.25rem' }}></div>

                {/* Header */}
                <div className="relative z-10 flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 overflow-hidden drop-shadow-sm">
                            <img src="/icon.png" alt="App Icon" className="w-full h-full object-contain" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-xl font-black tracking-tighter text-neutral-900 leading-none">
                                両雀
                            </span>
                            <span className="text-[0.5625rem] font-black text-[#c5a059] tracking-[0.3em] mt-1 uppercase">
                                Mahjong Club
                            </span>
                        </div>
                    </div>
                </div>

                {/* Content Area */}
                <div className="relative z-10 flex-1 flex flex-col">
                    {isEvent ? (
                        <div className="bg-[#f9f9f7] border border-black/[0.03] rounded-lg p-4 shadow-sm mb-4">
                            <h2 className="text-xl font-black mb-4 leading-tight text-neutral-900 border-b border-black/[0.05] pb-4">
                                {event?.title}
                            </h2>

                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex items-center gap-2.5 text-neutral-600">
                                        <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center border border-black/[0.02]">
                                            <Clock size="0.875rem" className="text-[#c5a059]" />
                                        </div>
                                        <span className="text-xs font-black">
                                            {new Date(event?.date || '').toLocaleString('zh-TW', {
                                                month: 'numeric',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                hour12: false
                                            })}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2.5 text-neutral-600">
                                        <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center border border-black/[0.02]">
                                            <Users size="0.875rem" className="text-[#c5a059]" />
                                        </div>
                                        <span className="text-xs font-black">
                                            {event?.currentMembers} / {event?.maxMembers} 人
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 text-neutral-600">
                                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center border border-black/[0.02]">
                                        <Coins size="0.875rem" className="text-[#c5a059]" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[0.5rem] text-neutral-400 uppercase font-black tracking-widest">籌碼底台</span>
                                        <span className="text-sm font-black text-neutral-900">{event?.stakes}</span>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 text-neutral-600">
                                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center border border-black/[0.02] flex-shrink-0 mt-0.5">
                                        <MapPin size="0.875rem" className="text-[#c5a059]" />
                                    </div>
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <span className="text-[0.5rem] text-neutral-400 uppercase font-black tracking-widest">地點</span>
                                        <span className="text-sm font-black text-neutral-900 break-words leading-relaxed">{event?.address || event?.location}</span>
                                    </div>
                                </div>

                                {/* 規則、特色 */}
                                <div className="pt-4 border-t border-black/[0.05] space-y-4">
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center gap-2 text-[#c5a059]">
                                            <ScrollText size="0.75rem" />
                                            <span className="text-[0.5625rem] font-black uppercase tracking-widest">麻將規則</span>
                                        </div>
                                        <div className="text-[0.6875rem] text-neutral-600 leading-relaxed pl-5 space-y-0.5 font-medium">
                                            {rules.length > 0 ? rules.map((r: string, i: number) => (
                                                <div key={i} className="flex items-start gap-1">
                                                    <span className="text-[#c5a059]">•</span>
                                                    <span>{r}</span>
                                                </div>
                                            )) : '依現場約定'}
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center gap-2 text-[#c5a059]">
                                            <Sparkles size="0.75rem" />
                                            <span className="text-[0.5625rem] font-black uppercase tracking-widest">場地特色</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5 pl-5">
                                            {features.length > 0 ? features.map((f: string, i: number) => (
                                                <span key={i} className="px-1.5 py-0.5 bg-white border border-black/[0.03] rounded-md text-[0.5625rem] text-neutral-600 font-black shadow-sm">
                                                    {f}
                                                </span>
                                            )) : <span className="text-[0.625rem] text-neutral-400">標準配置</span>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-[#f9f9f7] border border-black/[0.03] rounded-lg overflow-hidden shadow-sm mb-4 flex flex-col">
                            {/* Author Info */}
                            <div className="p-4 flex items-center gap-3 border-b border-black/[0.03] bg-white/50">
                                <div className="w-12 h-12 rounded-lg border border-black/[0.05] overflow-hidden p-0.5 bg-white shadow-sm">
                                    <div className="w-full h-full rounded-md overflow-hidden bg-neutral-50 flex items-center justify-center">
                                        {authorAvatarBase64 || post?.authorAvatar ? (
                                            <img
                                                src={authorAvatarBase64 || post?.authorAvatar}
                                                alt=""
                                                className="w-full h-full object-cover"
                                                crossOrigin="anonymous"
                                            />
                                        ) : (
                                            <span className="text-neutral-300 font-black text-xl">{post?.authorName?.[0]}</span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="text-neutral-900 font-black text-lg tracking-tight">{post?.authorName}</div>
                                    <div className="text-neutral-400 text-[0.625rem] font-black uppercase tracking-widest mt-0.5">
                                        {new Date(post?.createdAt || '').toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                                    </div>
                                </div>
                            </div>

                            {/* Post Content */}
                            <div className="p-4">
                                <p className="text-neutral-700 text-sm leading-relaxed mb-4 whitespace-pre-wrap font-medium">
                                    {post?.content}
                                </p>

                                {/* Post Image Preview */}
                                {(postImageBase64 || (post?.images && post.images.length > 0)) && (
                                    <div className="rounded-lg overflow-hidden border border-black/[0.05] mb-4 aspect-video bg-neutral-100 shadow-sm flex items-center justify-center">
                                        {postImageBase64 || post?.images?.[0] ? (
                                            <img
                                                src={postImageBase64 || post?.images?.[0]}
                                                alt=""
                                                className="w-full h-full object-cover"
                                                crossOrigin="anonymous"
                                            />
                                        ) : (
                                            <Loader2 size="1.5rem" className="text-neutral-300 animate-spin" />
                                        )}
                                    </div>
                                )}

                                {/* Interaction Stats */}
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2 text-neutral-400">
                                        <Heart size="0.875rem" className="text-[#c5a059]" />
                                        <span className="text-[0.625rem] font-black">{post?.likeCount || 0}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-neutral-400">
                                        <MessageSquare size="0.875rem" />
                                        <span className="text-[0.625rem] font-black">{post?.commentCount || 0}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer with QR Code */}
                <div className="relative z-10 bg-white border border-black/[0.03] rounded-lg p-4 flex items-center justify-between shadow-sm">
                    <div className="flex-1 pr-4">
                        <div className="text-[0.5rem] text-[#c5a059] font-black uppercase mb-1 tracking-[0.3em]">Scan to Discover</div>
                        <div className="text-base font-black text-neutral-900 mb-0.5 leading-tight tracking-tight">立即加入両雀</div>
                        <div className="text-[0.625rem] text-neutral-400 font-medium">高品質麻將社區</div>
                    </div>
                    <div className="p-2 bg-white border border-black/5 rounded-lg shadow-xl flex-shrink-0">
                        <div style={{ width: '4.0625rem', height: '4.0625rem' }}>
                            <QRCodeSVG value={shareUrl} size={undefined} style={{ width: '100%', height: '100%' }} level="H" />
                        </div>
                    </div>
                </div>

                {/* Bottom Decor */}
                <div className="absolute bottom-0 left-0 w-full h-1 bg-[#c5a059]/30"></div>
            </div>
        </div>
    );
};

export default ShareCard;

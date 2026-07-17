import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Share2, Download, Check, Loader2, MessageCircle } from 'lucide-react';
import html2canvas from 'html2canvas';
import ShareCard from './ShareCard';
import { GroupEvent, Post } from '../../types';

interface ShareActionSheetProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'event' | 'post';
    data: GroupEvent | Post;
    gameDetail?: any;
}

const ShareActionSheet: React.FC<ShareActionSheetProps> = ({ isOpen, onClose, type, data, gameDetail }) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [copied, setCopied] = useState(false);
    const [authorAvatarBase64, setAuthorAvatarBase64] = useState<string | null>(null);
    const [postImageBase64, setPostImageBase64] = useState<string | null>(null);

    // 處理圖片轉換為 Base64 (解決 CORS 問題)
    useEffect(() => {
        if (!isOpen) return;

        // 優化網址：將 CloudFront 網址轉為直接 S3 網址以解決 CORS 問題
        const optimizeUrl = (url: string) => {
            if (url.includes('d31n6tynkariq1.cloudfront.net')) {
                return url.replace('d31n6tynkariq1.cloudfront.net', 'mahjongclub-user-content.s3.ap-southeast-1.amazonaws.com');
            }
            return url;
        };

        const convertToBase64 = (originalUrl: string, setter: (val: string | null) => void) => {
            if (!originalUrl) return;
            const url = optimizeUrl(originalUrl);
            const img = new Image();

            // 重要：crossOrigin 必須在 src 之前設定
            img.crossOrigin = "Anonymous";

            img.onload = () => {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext("2d");
                    if (ctx) {
                        ctx.drawImage(img, 0, 0);
                        const base64 = canvas.toDataURL("image/png", 1.0);
                        console.log(`Successfully converted to base64 (${url.substring(0, 60)}...)`);
                        setter(base64);
                    }
                } catch (e) {
                    console.error('Error drawing image to canvas:', e);
                }
            };
            img.onerror = () => {
                console.error('Failed to convert image to base64:', url);
                // 失敗時清除 setter 確保不顯示壞圖
                setter(null);
            };

            // 加上時間戳避免快取問題引起 CORS 失敗
            const separator = url.includes('?') ? '&' : '?';
            img.src = `${url}${separator}t=${Date.now()}`;
        };

        const post = type === 'post' ? (data as Post) : null;
        if (post?.authorAvatar) {
            convertToBase64(post.authorAvatar, setAuthorAvatarBase64);
        }
        if (post?.images && post.images[0]) {
            convertToBase64(post.images[0], setPostImageBase64);
        }
    }, [isOpen, type, data]);

    if (!isOpen) return null;

    const isEvent = type === 'event';
    const event = isEvent ? (data as GroupEvent) : null;
    const post = !isEvent ? (data as Post) : null;

    const shareUrl = isEvent
        ? `${window.location.origin}/#/event/${event?.id}`
        : `${window.location.origin}/#/post/${post?.postId}`;

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const handleNativeShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: isEvent ? event?.title : '分享貼文',
                    text: isEvent ? `快來加入我的團局：${event?.title}` : post?.content.substring(0, 50),
                    url: shareUrl,
                });
            } catch (err) {
                console.error('Share failed:', err);
            }
        } else {
            handleCopyLink();
        }
    };

    const handleDownloadImage = async () => {
        if (!cardRef.current) return;

        setIsGenerating(true);
        try {
            // 1. 給予更多時間處理圖形與 QR Code (針對大型圖片增加延遲)
            await new Promise(resolve => setTimeout(resolve, 1500));

            // 2. 確保所有圖片都已載入完畢
            const images = cardRef.current.getElementsByTagName('img');
            const loadPromises = Array.from(images).map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise((resolve) => {
                    img.onload = resolve;
                    img.onerror = resolve;
                });
            });
            await Promise.all(loadPromises);

            // 3. 執行擷取
            const canvas = await html2canvas(cardRef.current, {
                useCORS: true,
                allowTaint: false,
                scale: 3, // 進一步提高解析度
                backgroundColor: '#ffffff', // 設定為白色背景
                logging: false,
                // width: 375 - Removed to allow natural responsive width
                height: cardRef.current.offsetHeight,
            });

            const link = document.createElement('a');
            link.download = `mahjong-share-${Date.now()}.png`;
            link.href = canvas.toDataURL('image/png', 1.0);
            link.click();
        } catch (err) {
            console.error('Failed to generate image:', err);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleLineShare = () => {
        const content = post?.content || '';
        const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;

        const text = isEvent
            ? `両雀團局分享\n${event?.title}\n時間：${new Date(event?.date || '').toLocaleString()}\n地點：${event?.location}\n籌碼底台：${event?.stakes}\n下載両雀找你的麻將搭子：${shareUrl}`
            : `両雀貼文分享\n${contentPreview}\n下載両雀找你的麻將搭子：${shareUrl}`;

        window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, '_blank');
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
                onClick={onClose}
            ></div>

            {/* Action Sheet - Minimal Lux Style */}
            <div className="relative bg-white border-t border-black/[0.03] rounded-t-lg p-6 pb-SafeBottom animate-slide-up shadow-[0_-0.625rem_2.5rem_rgba(0,0,0,0.1)]">
                {/* Handle */}
                <div className="w-12 h-1 bg-neutral-200 rounded-full mx-auto mb-8"></div>

                <div className="flex items-center justify-between mb-8">
                    <div className="flex flex-col">
                        <span className="text-[0.5625rem] text-[#c5a059] font-black uppercase tracking-[0.4em] mb-0.5 ml-0.5">SHARE TO</span>
                        <h3 className="text-xl font-black text-neutral-900 tracking-tight">分享到</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 bg-neutral-50 rounded-lg flex items-center justify-center text-neutral-400 hover:text-neutral-900 transition-all active:scale-90 border border-black/[0.01]"
                    >
                        <X size="1.25rem" strokeWidth={2.5} />
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                    <button
                        onClick={handleLineShare}
                        className="flex flex-col items-center gap-2 group"
                    >
                        <div className="w-16 h-16 bg-[#06C755]/5 rounded-lg flex items-center justify-center text-[#06C755] border border-[#06C755]/10 group-hover:bg-[#06C755]/10 transition-all shadow-sm">
                            <MessageCircle size="1.75rem" fill="currentColor" className="opacity-80" />
                        </div>
                        <span className="text-[0.6875rem] font-black text-neutral-500 uppercase tracking-widest">LINE</span>
                    </button>

                    <button
                        onClick={handleDownloadImage}
                        disabled={isGenerating}
                        className="flex flex-col items-center gap-2 group"
                    >
                        <div className="w-16 h-16 bg-[#c5a059]/5 rounded-lg flex items-center justify-center text-[#c5a059] border border-[#c5a059]/10 group-hover:bg-[#c5a059]/10 transition-all shadow-sm">
                            {isGenerating ? <Loader2 size="1.75rem" className="animate-spin" /> : <Download size="1.75rem" strokeWidth={2.5} />}
                        </div>
                        <span className="text-[0.6875rem] font-black text-neutral-500 uppercase tracking-widest">分享圖卡</span>
                    </button>
                </div>

                {/* Preview Hint */}
                <div className="bg-neutral-50/50 rounded-lg p-5 border border-black/5">
                    <p className="text-[0.5625rem] text-[#c5a059] font-black uppercase mb-3 tracking-[0.3em]">分享預覽</p>
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center text-neutral-400 shadow-sm border border-black/[0.02]">
                            {isEvent ? <Share2 size="1.75rem" /> : <MessageCircle size="1.75rem" />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[0.9375rem] text-neutral-900 font-bold truncate tracking-tight">
                                {isEvent ? event?.title : '両雀貼文'}
                            </div>
                            <div className="text-[0.6875rem] text-neutral-400 truncate font-medium mt-0.5">
                                {shareUrl}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Hidden Share Card for Image Generation */}
            <ShareCard
                type={type}
                data={data}
                gameDetail={gameDetail}
                cardRef={cardRef}
                authorAvatarBase64={authorAvatarBase64}
                postImageBase64={postImageBase64}
            />
        </div>,
        document.body
    );
};

export default ShareActionSheet;

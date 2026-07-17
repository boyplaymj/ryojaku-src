import React from 'react';
import { Post } from '../types';
import { MessageSquare, Heart, Share2, MoreHorizontal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface PostCardProps {
    post: Post;
    onClick?: (postId: string, position: { x: number; y: number }) => void;
    onLike?: (postId: string) => void;
    onUserClick?: (userId: string) => void;
}

// 過濾掉瀏覽器無法顯示的圖片格式（如 .dng RAW 檔）
const WEB_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const isWebImage = (url: string) => {
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
    return WEB_IMAGE_EXTENSIONS.includes(ext);
};

const PostCard: React.FC<PostCardProps> = ({ post, onClick, onLike, onUserClick }) => {
    const handleLike = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onLike) {
            onLike(post.postId);
        }
    };

    return (
        <div
            onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest('button')) return;
                onClick && onClick(post.postId, { x: e.clientX, y: e.clientY });
            }}
            className="group relative bg-white w-full cursor-pointer transition-colors hover:bg-neutral-50/50 animate-fade-in"
        >
            <div className="flex px-4 py-4 gap-3">
                {/* Left Column: User Avatar */}
                <div
                    className="flex-shrink-0 cursor-pointer active:opacity-75 transition-opacity"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (post.authorId && onUserClick) {
                            onUserClick(post.authorId);
                        }
                    }}
                >
                    <div className="w-10 h-10 rounded-full bg-neutral-100 overflow-hidden border border-black/[0.04] shadow-sm">
                        {post.authorAvatar ? (
                            <img src={post.authorAvatar} alt={post.authorName} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-400 font-bold text-sm bg-neutral-50">
                                {post.authorName?.[0] || '?'}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Content */}
                <div className="flex-1 min-w-0">
                    {/* Header: Name, Time, More */}
                    <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                            <h3 className="font-bold text-neutral-900 text-[0.9375rem] truncate">
                                {post.authorName || '匿名雀友'}
                            </h3>
                            <span className="text-[0.6875rem] text-neutral-300 flex-shrink-0">
                                {new Date(post.createdAt).toLocaleDateString()} {new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                        <button className="text-neutral-300 hover:text-neutral-600 transition-colors p-1 -mr-1">
                            <MoreHorizontal size="1.125rem" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="text-neutral-800 text-[0.875rem] leading-[1.6]">
                        {post.contentType === 'markdown' ? (
                            <ReactMarkdown>{post.content}</ReactMarkdown>
                        ) : (
                            <p className="whitespace-pre-wrap">{post.content}</p>
                        )}
                    </div>

                    {/* Images - 過濾不支援的格式，加上 lazy loading 和錯誤處理 */}
                    {post.images && post.images.filter(isWebImage).length > 0 && (
                        <div className="mt-3 flex overflow-x-auto gap-2 no-scrollbar -mr-4">
                            {post.images.filter(isWebImage).map((img, idx) => (
                                <div key={idx} className="flex-none w-40 aspect-[4/3] rounded-lg overflow-hidden bg-neutral-100 border border-black/[0.02]">
                                    <img
                                        src={img}
                                        alt=""
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                        onError={(e) => {
                                            const target = e.currentTarget;
                                            target.style.display = 'none';
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Tags */}
                    {post.tags && post.tags.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {post.tags.map(tag => (
                                <span key={tag} className="text-[0.625rem] text-[#c5a059] font-bold px-2 py-0.5 bg-[#c5a059]/5 rounded-md">
                                    #{tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Compact Interaction Bar */}
                    <div className="mt-3 flex items-center gap-5">
                        <button
                            onClick={handleLike}
                            className={`flex items-center gap-1.5 transition-colors active:scale-95 ${post.isLikedByMe ? 'text-[#c5a059]' : 'text-neutral-400 hover:text-neutral-600'}`}
                        >
                            <Heart size="1rem" strokeWidth={2} fill={post.isLikedByMe ? "currentColor" : "none"} />
                            <span className="text-[0.75rem] font-bold">{post.likeCount || 0}</span>
                        </button>

                        <button className="flex items-center gap-1.5 text-neutral-400 hover:text-neutral-600 transition-colors active:scale-95">
                            <MessageSquare size="1rem" strokeWidth={2} />
                            <span className="text-[0.75rem] font-bold">{post.commentCount || 0}</span>
                        </button>

                        <button className="text-neutral-400 hover:text-neutral-600 transition-colors active:scale-95">
                            <Share2 size="1rem" strokeWidth={2} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Separator */}
            <div className="h-[0.375rem] bg-neutral-50 border-t border-black/[0.02]"></div>
        </div>
    );
};

export default PostCard;

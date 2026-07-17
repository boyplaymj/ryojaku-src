/**
 * PostDetailModal - 貼文詳情假切頁組件
 * 使用 Portal 渲染到 body，覆蓋在當前頁面上
 * Minimal Lux Theme (Traditional Chinese)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Post, Comment, User } from '../types';
import { ArrowLeft, MessageSquare, Heart, Share2, MoreHorizontal, Send } from 'lucide-react';
import ShareActionSheet from './share/ShareActionSheet';
import ReactMarkdown from 'react-markdown';
import * as apiService from '../services/apiService';
import PullToRefresh from './PullToRefresh';
import { useRefresh, usePullToRefresh } from '../contexts/RefreshContext';

// 過濾掉瀏覽器無法顯示的圖片格式（如 .dng RAW 檔）
const WEB_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const isWebImage = (url: string) => {
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
    return WEB_IMAGE_EXTENSIONS.includes(ext);
};

interface PostDetailModalProps {
    postId: string;
    user: User | null;
    onClose: () => void;
    clickPosition?: { x: number; y: number };
    onUserClick?: (userId: string) => void;
}

const PostDetailModal: React.FC<PostDetailModalProps> = ({ postId, user, onClose, clickPosition, onUserClick }) => {
    const { onRefresh } = useRefresh();
    const [post, setPost] = useState<Post | null>(null);
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(true);
    const [commentInput, setCommentInput] = useState('');
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [showShareSheet, setShowShareSheet] = useState(false);

    // Disable background scroll
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);

    // Handle browser back button
    useEffect(() => {
        const handlePopState = (e: PopStateEvent) => {
            e.preventDefault();
            onClose();
        };
        window.history.pushState({ modal: 'postDetail' }, '');
        window.addEventListener('popstate', handlePopState);
        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, [onClose]);

    const fetchPost = useCallback(async () => {
        setLoading(true);
        try {
            const response = await apiService.getCommunityPostDetail(postId, user?.userId);
            if (response.success && response.data) {
                setPost(response.data.post);
                setComments(response.data.comments || []);
            }
        } catch (e) {
            console.error("Failed to load post", e);
        } finally {
            setLoading(false);
        }
    }, [postId, user?.userId]);

    usePullToRefresh(fetchPost);

    useEffect(() => {
        if (postId) fetchPost();
    }, [fetchPost, postId]);

    const handleSendComment = async () => {
        if (!commentInput.trim() || !user || !post) return;
        const content = commentInput;
        setCommentInput('');
        try {
            const response = await apiService.addComment(post.postId, user.userId, content);
            if (response.success) {
                const newComment: Comment = {
                    postId: post.postId,
                    sortKey: Date.now().toString(),
                    authorId: user.userId,
                    authorName: user.displayName,
                    authorAvatar: user.pictureUrl,
                    content: content,
                    likeCount: 0,
                    createdAt: new Date().toISOString(),
                    isAuthor: true
                };
                setComments(prev => [newComment, ...prev]);
                setPost(prev => prev ? { ...prev, commentCount: prev.commentCount + 1 } : null);
            }
        } catch (e) {
            console.error("Failed to send comment", e);
        }
    };

    const handleLikePost = async () => {
        if (!post || !user) return;
        const wasLiked = post.isLikedByMe;
        setPost(prev => prev ? {
            ...prev,
            isLikedByMe: !wasLiked,
            likeCount: wasLiked ? prev.likeCount - 1 : prev.likeCount + 1
        } : null);
        try {
            await apiService.likePost(post.postId, user.userId);
        } catch (e) {
            console.error("Failed to like post", e);
        }
    };

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 bg-white">
                    <div className="animate-spin rounded-full h-7 w-7 border-2 border-neutral-100 border-t-[#c5a059]"></div>
                    <span className="text-[0.6875rem] text-neutral-400 font-bold">載入中...</span>
                </div>
            );
        }

        if (!post) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 bg-white">
                    <p className="text-neutral-400 text-sm">找不到貼文內容</p>
                    <button onClick={onClose} className="text-[#c5a059] font-bold text-sm">返回</button>
                </div>
            );
        }

        return (
            <div className="flex flex-col animate-fade-in">
                {/* Main Post Section */}
                <div className="bg-white px-4 py-4">
                    <div className="flex gap-3">
                        {/* Avatar */}
                        <div
                            className="flex-shrink-0 cursor-pointer active:opacity-75 transition-opacity"
                            onClick={() => post.authorId && onUserClick?.(post.authorId)}
                        >
                            <div className="w-10 h-10 rounded-full bg-neutral-100 overflow-hidden border border-black/[0.04]">
                                {post.authorAvatar ? (
                                    <img src={post.authorAvatar} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center font-bold text-neutral-400 text-sm bg-neutral-50">
                                        {post.authorName?.[0] || '?'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                    <h3
                                        className="font-bold text-neutral-900 text-[0.9375rem] cursor-pointer"
                                        onClick={() => post.authorId && onUserClick?.(post.authorId)}
                                    >
                                        {post.authorName}
                                    </h3>
                                    <span className="text-[0.6875rem] text-neutral-300">
                                        {new Date(post.createdAt).toLocaleDateString()} {new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                                <button className="text-neutral-300 hover:text-neutral-600 transition-colors p-1">
                                    <MoreHorizontal size="1.125rem" />
                                </button>
                            </div>

                            {/* Post Content */}
                            <div className="text-neutral-800 text-[0.875rem] leading-[1.6] mb-3">
                                {post.contentType === 'markdown' ? (
                                    <ReactMarkdown>{post.content}</ReactMarkdown>
                                ) : (
                                    <div className="whitespace-pre-wrap">{post.content}</div>
                                )}
                            </div>

                            {/* Images - 過濾不支援的格式 */}
                            {post.images && post.images.filter(isWebImage).length > 0 && (
                                <div className="mb-3 space-y-2">
                                    {post.images.filter(isWebImage).map((img, i) => (
                                        <div
                                            key={i}
                                            onClick={() => setSelectedImage(img)}
                                            className="w-full aspect-[16/9] rounded-2xl overflow-hidden border border-black/[0.02] cursor-pointer"
                                        >
                                            <img
                                                src={img}
                                                alt=""
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                                onError={(e) => {
                                                    e.currentTarget.style.display = 'none';
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Tags */}
                            {post.tags && post.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mb-3">
                                    {post.tags.map(tag => (
                                        <span key={tag} className="text-[0.625rem] text-[#c5a059] font-bold px-2 py-0.5 bg-[#c5a059]/5 rounded-md">
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-5 pt-2">
                                <button
                                    onClick={handleLikePost}
                                    className={`flex items-center gap-1.5 transition-colors active:scale-95 ${post.isLikedByMe ? 'text-[#c5a059]' : 'text-neutral-400 hover:text-neutral-600'}`}
                                >
                                    <Heart size="1rem" strokeWidth={2} fill={post.isLikedByMe ? "currentColor" : "none"} />
                                    <span className="text-[0.75rem] font-bold">{post.likeCount}</span>
                                </button>
                                <div className="flex items-center gap-1.5 text-neutral-400">
                                    <MessageSquare size="1rem" strokeWidth={2} />
                                    <span className="text-[0.75rem] font-bold">{post.commentCount}</span>
                                </div>
                                <button
                                    onClick={() => setShowShareSheet(true)}
                                    className="text-neutral-400 hover:text-neutral-600 transition-colors active:scale-95"
                                >
                                    <Share2 size="1rem" strokeWidth={2} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Separator */}
                <div className="h-2 bg-neutral-50 border-y border-black/[0.02]"></div>

                {/* Comments Section */}
                <div className="bg-white">
                    <div className="px-4 py-3 border-b border-black/[0.02]">
                        <span className="text-[0.6875rem] font-bold text-neutral-400">留言 ({comments.length})</span>
                    </div>

                    {comments.length === 0 ? (
                        <div className="text-center py-12">
                            <MessageSquare size="1.5rem" className="text-neutral-200 mx-auto mb-2" />
                            <p className="text-neutral-300 text-[0.75rem]">尚無留言</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-black/[0.02]">
                            {comments.map((comment, idx) => (
                                <div key={idx} className="flex gap-3 px-4 py-3">
                                    <div className="flex-shrink-0">
                                        <div
                                            className="w-8 h-8 rounded-full bg-neutral-100 border border-black/[0.03] overflow-hidden cursor-pointer active:opacity-75 transition-opacity"
                                            onClick={() => comment.authorId && onUserClick?.(comment.authorId)}
                                        >
                                            {comment.authorAvatar ? (
                                                <img src={comment.authorAvatar} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-[0.625rem] font-bold text-neutral-400 bg-neutral-50">
                                                    {comment.authorName?.[0] || '?'}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span
                                                className="font-bold text-neutral-900 text-[0.8125rem] cursor-pointer"
                                                onClick={() => comment.authorId && onUserClick?.(comment.authorId)}
                                            >
                                                {comment.authorName}
                                            </span>
                                            {comment.authorId === post.authorId && (
                                                <span className="text-[0.5625rem] bg-[#c5a059] text-white px-1.5 py-0.5 rounded font-bold">作者</span>
                                            )}
                                            <span className="text-[0.625rem] text-neutral-300">
                                                {new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <p className="text-neutral-700 text-[0.8125rem] leading-[1.5]">{comment.content}</p>
                                        <button
                                            onClick={() => {
                                                if (!user) return;
                                                setComments(prev => prev.map(c => {
                                                    if (c.sortKey === comment.sortKey) {
                                                        const wasLiked = c.isLikedByMe;
                                                        return {
                                                            ...c,
                                                            isLikedByMe: !wasLiked,
                                                            likeCount: wasLiked ? c.likeCount - 1 : c.likeCount + 1
                                                        };
                                                    }
                                                    return c;
                                                }));
                                                apiService.likeComment(post.postId, comment.sortKey, user.userId);
                                            }}
                                            className={`flex items-center gap-1 mt-2 transition-colors text-[0.6875rem] ${comment.isLikedByMe ? 'text-[#c5a059]' : 'text-neutral-300 hover:text-neutral-500'}`}
                                        >
                                            <Heart size="0.75rem" strokeWidth={2} fill={comment.isLikedByMe ? "currentColor" : "none"} />
                                            <span className="font-bold">{comment.likeCount || 0}</span>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Bottom Padding for Input */}
                <div className="h-20 bg-white"></div>
            </div>
        );
    };

    // Calculate click origin for animation
    const originX = clickPosition ? `${(clickPosition.x / window.innerWidth) * 100}%` : '50%';
    const originY = clickPosition ? `${(clickPosition.y / window.innerHeight) * 100}%` : '50%';

    return createPortal(
        <div
            className="fixed inset-0 z-[100] bg-[#f9f9f7] flex flex-col animate-expand-from-point overflow-hidden"
            style={{
                '--origin-x': originX,
                '--origin-y': originY,
            } as React.CSSProperties}
        >
            {/* Header */}
            {/* Header */}
            <div className="flex-shrink-0 bg-white border-b border-black/[0.03] pt-safe z-50 relative">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#c5a059]/20 to-transparent"></div>
                <div className="h-16 px-4 flex items-center justify-between">
                    <button
                        onClick={onClose}
                        className="w-10 h-10 rounded-xl bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-neutral-900 transition-colors border border-black/[0.03] active:scale-90 transition-all shadow-sm"
                    >
                        <ArrowLeft size="1.25rem" />
                    </button>

                    <div className="flex flex-col items-center">
                        <span className="text-[0.5625rem] font-black text-[#c5a059] uppercase tracking-[0.3em] mb-0.5">Community</span>
                        <span className="text-neutral-900 font-black text-[0.875rem] tracking-tight">貼文詳情</span>
                    </div>

                    <button
                        onClick={() => setShowShareSheet(true)}
                        className="w-10 h-10 rounded-xl bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-[#c5a059] transition-colors border border-black/[0.03] active:scale-90 transition-all shadow-sm"
                    >
                        <Share2 size="1.25rem" />
                    </button>
                </div>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto no-scrollbar relative z-10 bg-[#f9f9f7]">
                <PullToRefresh onRefresh={fetchPost}>
                    {renderContent()}
                </PullToRefresh>
            </div>

            {/* Bottom Comment Input */}
            {!loading && post && (
                <div
                    className="flex-shrink-0 bg-white border-t border-black/[0.03] px-4 py-3 z-50"
                    style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0.75rem), 0.75rem)' }}
                >
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-neutral-100 flex-shrink-0 border border-black/[0.04] overflow-hidden">
                            {user?.pictureUrl ? (
                                <img src={user.pictureUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-neutral-50 flex items-center justify-center text-neutral-400 font-bold text-[0.625rem]">
                                    {user?.displayName?.[0] || 'U'}
                                </div>
                            )}
                        </div>
                        <div className="flex-1 relative">
                            <input
                                type="text"
                                value={commentInput}
                                onChange={(e) => setCommentInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSendComment()}
                                placeholder="發表留言..."
                                className="w-full bg-neutral-50 text-neutral-900 rounded-full pl-4 pr-12 py-2.5 focus:outline-none border border-black/[0.02] placeholder:text-neutral-300 text-[0.8125rem]"
                            />
                            <button
                                onClick={handleSendComment}
                                disabled={!commentInput.trim()}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 bg-neutral-900 text-white rounded-full flex items-center justify-center disabled:opacity-20 transition-all active:scale-90"
                            >
                                <Send size="0.875rem" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Full Screen Image Viewer */}
            {selectedImage && (
                <div
                    className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4"
                    onClick={() => setSelectedImage(null)}
                >
                    <img
                        src={selectedImage}
                        alt="Full view"
                        className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                    <div className="absolute bottom-10 text-center">
                        <span className="text-white/50 text-[0.625rem] font-bold uppercase tracking-widest">點擊背景關閉</span>
                    </div>
                </div>
            )}

            {/* Share Sheet */}
            {post && (
                <ShareActionSheet
                    isOpen={showShareSheet}
                    onClose={() => setShowShareSheet(false)}
                    type="post"
                    data={post}
                />
            )}
        </div>,
        document.body
    );
};

export default PostDetailModal;


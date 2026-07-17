import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Post, Comment, User } from '../types';
import { ArrowLeft, MessageSquare, Heart, Send, Share2, MoreHorizontal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import * as apiService from '../services/apiService';

interface PostDetailProps {
    user: User | null;
}

const PostDetail: React.FC<PostDetailProps> = ({ user }) => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [post, setPost] = useState<Post | null>(null);
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(true);
    const [commentInput, setCommentInput] = useState('');

    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    useEffect(() => {
        const fetchPost = async () => {
            setLoading(true);
            try {
                // Try fetching from API
                const response = await apiService.getCommunityPostDetail(id || '', user?.userId);
                if (response.success && response.data) {
                    setPost(response.data.post);
                    setComments(response.data.comments || []);
                } else {
                    // Fallback Mock for now until Backend Lambda is implemented
                    console.warn("API not ready, using mock data");
                    setPost({
                        postId: id || '1',
                        authorId: 'user1',
                        authorName: '路人王強森',
                        content: '今天在俱樂部打了一局超精彩的！最後靠著一張海底撈月翻盤，真的太刺激了。大家都發揮得很好，期待下次再戰！🀄️✨',
                        contentType: 'text',
                        likeCount: 128,
                        commentCount: 5,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        tags: ['大三元', '海底撈月', '麻將心得', '俱樂部日常'],
                        images: [
                            'https://images.unsplash.com/photo-1595152772835-219674b2a8a6?q=80&w=1000&auto=format&fit=crop',
                            'https://images.unsplash.com/photo-1595152434543-c5c4c0db50e2?q=80&w=1000&auto=format&fit=crop'
                        ]
                    });
                    setComments([
                        {
                            postId: id || '1',
                            sortKey: '1',
                            authorId: 'user2',
                            authorName: '小甜甜',
                            authorAvatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704d',
                            content: '強森哥太強了吧！下次帶我飛～',
                            likeCount: 5,
                            createdAt: new Date(Date.now() - 3600000).toISOString(),
                            isAuthor: false
                        },
                        {
                            postId: id || '1',
                            sortKey: '2',
                            authorId: 'user3',
                            authorName: '孤獨的雀士',
                            authorAvatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704e',
                            content: '海底撈月機率超低的，這手氣沒誰了。羨慕！',
                            likeCount: 2,
                            createdAt: new Date(Date.now() - 7200000).toISOString(),
                            isAuthor: false
                        },
                        {
                            postId: id || '1',
                            sortKey: '3',
                            authorId: 'user4',
                            authorName: '麻將小天才',
                            authorAvatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704f',
                            content: '想知道在哪個分店打的？我也想去沾沾喜氣。',
                            likeCount: 8,
                            createdAt: new Date(Date.now() - 10800000).toISOString(),
                            isAuthor: false
                        },
                        {
                            postId: id || '1',
                            sortKey: '4',
                            authorId: 'user5',
                            authorName: '大三元殺手',
                            authorAvatar: 'https://i.pravatar.cc/150?u=a042581f4e29026024d',
                            content: '這貼文有毒，看完我也想打兩圈了。',
                            likeCount: 1,
                            createdAt: new Date(Date.now() - 14400000).toISOString(),
                            isAuthor: false
                        },
                        {
                            postId: id || '1',
                            sortKey: '5',
                            authorId: 'user6',
                            authorName: '槓上開花',
                            authorAvatar: 'https://i.pravatar.cc/150?u=a04258114e29026702d',
                            content: '恭喜！這戰績真的可以吹一整年了 XD',
                            likeCount: 0,
                            createdAt: new Date(Date.now() - 18000000).toISOString(),
                            isAuthor: false
                        }
                    ]);
                }
            } catch (e) {
                console.error("Failed to load post", e);
            } finally {
                setLoading(false);
            }
        };

        if (id) fetchPost();
    }, [id]);

    const handleSendComment = async () => {
        if (!commentInput.trim() || !user || !post) return;

        const content = commentInput;
        setCommentInput(''); // Clear immediately

        try {
            const response = await apiService.addComment(post.postId, user.userId, content);
            if (response.success) {
                // Refresh or append comment
                const newComment: Comment = {
                    postId: post.postId,
                    sortKey: Date.now().toString(), // Temp
                    authorId: user.userId,
                    authorName: user.displayName,
                    authorAvatar: user.pictureUrl,
                    content: content,
                    likeCount: 0,
                    createdAt: new Date().toISOString(),
                    isAuthor: true
                };
                setComments(prev => [...prev, newComment]);
                setPost(prev => prev ? { ...prev, commentCount: prev.commentCount + 1 } : null);
            }
        } catch (e) {
            console.error("Failed to send comment", e);
        }
    };

    const handleLikePost = async () => {
        if (!post || !user) return;

        // Optimistic update
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


    if (loading) return (
        <div className="min-h-screen bg-[#050b14] flex flex-col items-center justify-center">
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute inset-0 cyber-grid opacity-20 animate-grid-flow"></div>
            </div>
            <div className="relative z-10 flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-2 border-cyber-cyan border-t-transparent rounded-full animate-spin"></div>
                <span className="text-cyber-cyan font-mono animate-pulse">載入中...</span>
            </div>
        </div>
    );

    if (!post) return (
        <div className="min-h-screen bg-[#050b14] flex items-center justify-center text-slate-400 font-mono relative">
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute inset-0 cyber-grid opacity-20 animate-grid-flow"></div>
            </div>
            <div className="relative z-10">找不到貼文</div>
        </div>
    );

    return (
        <div className="h-screen flex flex-col bg-[#050b14] overflow-hidden relative">
            {/* Background Decorations */}
            <div className="absolute inset-0 z-0 pointer-events-none">
                <div className="absolute inset-0 cyber-grid opacity-20 animate-grid-flow"></div>
                <div className="absolute top-[-10%] right-[-20%] w-80 h-80 bg-cyber-cyan/10 rounded-full blur-[6.25rem] mix-blend-screen animate-pulse-slow"></div>
                <div className="absolute bottom-[-10%] left-[-20%] w-80 h-80 bg-cyber-pink/10 rounded-full blur-[6.25rem] mix-blend-screen animate-pulse-slow" style={{ animationDelay: '2s' }}></div>

                {/* Cyberpunk Corner Accents */}
                <div className="absolute top-0 left-0 w-8 h-8 border-l-2 border-t-2 border-cyber-cyan/30 rounded-tl-xl"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-r-2 border-t-2 border-cyber-cyan/30 rounded-tr-xl"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-l-2 border-b-2 border-cyber-cyan/30 rounded-bl-xl"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-r-2 border-b-2 border-cyber-cyan/30 rounded-br-xl"></div>
            </div>

            {/* Header - Fixed at top */}
            {/* Header - Fixed at top */}
            <div
                className="flex-shrink-0 bg-[#050b14]/90 backdrop-blur-md border-b border-slate-800/50 pt-safe z-50"
            >
                <div className="h-16 px-4 flex items-center gap-3">
                    <button
                        onClick={() => navigate(-1)}
                        className="w-10 h-10 rounded-lg bg-slate-900/50 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors border border-white/5"
                    >
                        <ArrowLeft size="1.25rem" />
                    </button>
                    <div className="flex-1">
                        <div className="flex items-center gap-2 text-cyber-cyan/70 text-[0.625rem] font-mono mb-0.5">
                            <span className="uppercase tracking-widest text-cyber-cyan">社群</span>
                            <div className="h-[0.0625rem] w-4 bg-cyber-cyan/30"></div>
                        </div>
                        <span className="text-white font-bold tracking-widest text-sm uppercase">貼文詳情</span>
                    </div>
                    <button className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                        <MoreHorizontal size="1.375rem" />
                    </button>
                </div>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto no-scrollbar relative z-10 px-4 pt-6 pb-6">
                <div className="max-w-4xl mx-auto flex flex-col gap-6">

                    {/* Module 1: Author Info Card - Follow button removed */}
                    <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-lg p-4 flex items-center gap-4 shadow-xl">
                        <div className="w-14 h-14 rounded-lg bg-slate-800 overflow-hidden border border-white/10 shadow-lg p-0.5">
                            <div className="w-full h-full rounded-[0.875rem] overflow-hidden">
                                {post.authorAvatar ? <img src={post.authorAvatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-700 flex items-center justify-center font-bold text-slate-400 text-xl">{post.authorName[0]}</div>}
                            </div>
                        </div>
                        <div className="flex-1">
                            <div className="font-bold text-slate-100 text-lg leading-tight">{post.authorName}</div>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[0.625rem] text-slate-500 font-mono">{new Date(post.createdAt).toLocaleDateString()}</span>
                                <span className="w-1 h-1 rounded-full bg-slate-700"></span>
                                <span className="text-[0.625rem] text-slate-500 font-mono">{new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        </div>
                    </div>

                    {/* Module 2: Content Area */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2 px-1">
                            <div className="w-1 h-3 bg-cyber-cyan shadow-[0_0_0.5rem_rgba(6,182,212,0.5)]"></div>
                            <span className="text-[0.625rem] font-bold text-slate-500 tracking-widest uppercase font-mono">貼文內容</span>
                        </div>
                        <div className="bg-slate-900/60 backdrop-blur-xl border border-white/5 rounded-lg p-6 shadow-2xl relative">
                            {/* Decorative line */}
                            <div className="absolute top-4 left-0 w-[0.125rem] h-8 bg-gradient-to-b from-cyber-cyan to-transparent"></div>

                            <div className="text-slate-200 leading-relaxed text-base font-medium">
                                {post.contentType === 'markdown' ? (
                                    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-p:text-slate-300">
                                        <ReactMarkdown>{post.content}</ReactMarkdown>
                                    </div>
                                ) : (
                                    <div className="whitespace-pre-wrap">{post.content}</div>
                                )}
                            </div>

                            {/* Tags Area inside content */}
                            {post.tags && post.tags.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-6">
                                    {post.tags.map(tag => (
                                        <span key={tag} className="text-[0.625rem] text-cyber-cyan bg-cyber-cyan/10 px-2.5 py-1 rounded-lg border border-cyber-cyan/20 font-mono uppercase tracking-tighter">#{tag}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Module 3: Image Carousel */}
                    {post.images && post.images.length > 0 && (
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between px-1">
                                <div className="flex items-center gap-2">
                                    <div className="w-1 h-3 bg-cyber-pink shadow-[0_0_0.5rem_rgba(217,70,239,0.5)]"></div>
                                    <span className="text-[0.625rem] font-bold text-slate-500 tracking-widest uppercase font-mono">媒體展示</span>
                                </div>
                                <span className="text-[0.625rem] font-mono text-slate-600">{post.images.length} 張照片</span>
                            </div>

                            {/* Horizontal Scroll with Snap */}
                            <div className="flex overflow-x-auto gap-4 pb-2 snap-x snap-mandatory no-scrollbar scroll-smooth">
                                {post.images.map((img, i) => (
                                    <div
                                        key={i}
                                        onClick={() => setSelectedImage(img)}
                                        className="flex-none w-[88vw] sm:w-[31.25rem] aspect-[4/3] rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl snap-center relative group cursor-pointer"
                                    >
                                        <img src={img} alt="" className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        <div className="absolute top-4 right-4 px-3 py-1 bg-black/60 backdrop-blur-md rounded-full text-[0.625rem] font-mono text-white/50 border border-white/10">
                                            {i + 1} / {post.images?.length}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Module 4: Interaction Bar - Redesigned */}
                    <div className="bg-[#0f172a]/60 backdrop-blur-md border border-white/5 rounded-lg p-3 flex items-center justify-start gap-4 shadow-xl">
                        <button
                            onClick={handleLikePost}
                            className={`flex items-center gap-2.5 group transition-all px-3 py-1.5 rounded-lg ${post.isLikedByMe ? 'bg-cyber-pink/10 text-cyber-pink' : 'text-slate-400 hover:bg-white/5'}`}
                        >
                            <Heart size="1.125rem" fill={post.isLikedByMe ? "currentColor" : "none"} className={post.isLikedByMe ? "animate-heartbeat" : ""} />
                            <div className="flex flex-col text-left">
                                <span className="text-sm font-bold font-mono leading-none">{post.likeCount}</span>
                                <span className="text-[0.5625rem] font-bold opacity-60 uppercase tracking-tight">個點讚</span>
                            </div>
                        </button>

                        <div className="w-[0.0625rem] h-6 bg-white/5"></div>

                        <div className="flex items-center gap-2.5 text-slate-400 px-3 py-1.5">
                            <MessageSquare size="1.125rem" />
                            <div className="flex flex-col text-left">
                                <span className="text-sm font-bold font-mono leading-none">{post.commentCount}</span>
                                <span className="text-[0.5625rem] font-bold opacity-60 uppercase tracking-tight">則留言</span>
                            </div>
                        </div>
                    </div>

                    {/* Comments Section - Redesigned */}
                    <div className="mt-4 pb-12">
                        <div className="flex items-center gap-2 mb-6 px-1">
                            <div className="h-[0.125rem] flex-1 bg-gradient-to-r from-transparent via-slate-800 to-transparent"></div>
                            <h3 className="text-slate-500 text-[0.625rem] font-bold uppercase tracking-[0.2em] font-mono">
                                留言討論區 ({comments.length})
                            </h3>
                            <div className="h-[0.125rem] flex-1 bg-gradient-to-r from-transparent via-slate-800 to-transparent"></div>
                        </div>

                        <div className="flex flex-col gap-6">
                            {comments.length === 0 ? (
                                <div className="text-center py-16 text-slate-600 font-mono text-sm border border-dashed border-slate-800 rounded-lg bg-white/[0.01]">
                                    尚無留言，成為第一個留言的人吧！
                                </div>
                            ) : (
                                comments.map((comment, idx) => (
                                    <div key={idx} className="flex gap-4 group animate-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: `${idx * 100}ms` }}>
                                        {/* Left: Avatar with decorative line */}
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-12 h-12 rounded-lg bg-slate-800 flex-shrink-0 border border-white/10 overflow-hidden shadow-lg p-0.5 relative group-hover:border-cyber-cyan/50 transition-colors">
                                                <div className="w-full h-full rounded-[0.875rem] overflow-hidden">
                                                    {comment.authorAvatar ? <img src={comment.authorAvatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-sm font-bold text-slate-500 bg-slate-700">{comment.authorName[0]}</div>}
                                                </div>
                                            </div>
                                            <div className="w-[0.0625rem] flex-1 bg-gradient-to-b from-slate-800 to-transparent"></div>
                                        </div>

                                        {/* Right: Content */}
                                        <div className="flex-1 flex flex-col gap-2 pb-4">
                                            <div className="bg-slate-900/40 border border-white/5 rounded-lg p-4 backdrop-blur-sm relative group-hover:bg-slate-900/60 transition-all">
                                                {/* Header: Name & Time */}
                                                <div className="flex justify-between items-center mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-slate-100 text-sm">{comment.authorName}</span>
                                                        {comment.authorId === post.authorId && (
                                                            <span className="text-[0.5625rem] bg-cyber-cyan/10 text-cyber-cyan border border-cyber-cyan/20 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-tighter">作者</span>
                                                        )}
                                                    </div>
                                                    <span className="text-[0.625rem] text-slate-600 font-mono">{new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>

                                                {/* Body: Content */}
                                                <div className="text-slate-300 text-sm whitespace-pre-wrap leading-relaxed mb-3">
                                                    {comment.content}
                                                </div>

                                                {/* Compact Like Button - Absolute Positioned */}
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
                                                    className={`absolute -bottom-2 -right-1 flex items-center gap-1.5 px-2 py-1 rounded-lg backdrop-blur-md transition-all border shadow-lg ${comment.isLikedByMe ? 'bg-cyber-pink/20 text-cyber-pink border-cyber-pink/30 shadow-cyber-pink/10' : 'bg-slate-800/80 text-slate-500 border-white/5 hover:text-slate-300'}`}
                                                >
                                                    <Heart size="0.75rem" fill={comment.isLikedByMe ? "currentColor" : "none"} className={comment.isLikedByMe ? "animate-heartbeat" : ""} />
                                                    <span className="text-[0.625rem] font-bold font-mono">{comment.likeCount || 0}</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Input - Fixed Wrapper */}
            <div className="flex-shrink-0 bg-[#050b14]/95 backdrop-blur-xl border-t border-slate-800/50 p-4 pb-safe z-50">
                <div className="max-w-4xl mx-auto flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 flex-shrink-0 border border-white/10 overflow-hidden shadow-2xl p-0.5">
                        <div className="w-full h-full rounded-[0.625rem] overflow-hidden">
                            {user?.pictureUrl ? <img src={user.pictureUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-700 flex items-center justify-center text-slate-500 font-bold">U</div>}
                        </div>
                    </div>
                    <div className="flex-1 relative group">
                        <input
                            type="text"
                            value={commentInput}
                            onChange={(e) => setCommentInput(e.target.value)}
                            placeholder="發表留言..."
                            className="w-full bg-[#0f172a]/90 text-white rounded-[1.25rem] pl-5 pr-12 py-3.5 focus:outline-none focus:ring-1 focus:ring-cyber-cyan/30 border border-slate-800 focus:border-cyber-cyan/50 transition-all placeholder:text-slate-600 text-sm shadow-inner"
                        />
                        <button
                            onClick={handleSendComment}
                            disabled={!commentInput.trim()}
                            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 bg-cyber-cyan/10 text-cyber-cyan rounded-lg text-xs font-bold hover:bg-cyber-cyan/20 transition-all disabled:text-slate-800 disabled:bg-transparent disabled:cursor-not-allowed border border-cyber-cyan/20"
                        >
                            發佈
                        </button>
                    </div>
                </div>
            </div>

            {/* Full Screen Image Viewer Modal */}
            {selectedImage && (
                <div
                    className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300"
                    onClick={() => setSelectedImage(null)}
                >

                    <img
                        src={selectedImage}
                        alt="Full view"
                        className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-[0_0_3.125rem_rgba(0,0,0,0.5)] animate-in zoom-in-95 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <div className="absolute bottom-10 left-0 right-0 text-center">
                        <span className="text-slate-500 font-mono text-xs uppercase tracking-[0.3em]">點擊背景關閉</span>
                    </div>
                </div>
            )}
        </div>

    );
};

export default PostDetail;

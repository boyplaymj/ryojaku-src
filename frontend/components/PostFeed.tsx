import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Post } from '../types';
import PostCard from './PostCard';
import { Loader2, AlertCircle } from 'lucide-react';
import * as apiService from '../services/apiService';

interface PostFeedProps {
    refreshTrigger?: number;
    onPostClick: (postId: string, position: { x: number; y: number }) => void;
    userId: string;
    onUserClick?: (userId: string) => void;
}

const PostFeed: React.FC<PostFeedProps> = ({ refreshTrigger, onPostClick, userId, onUserClick }) => {
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [lastKey, setLastKey] = useState<any>(null);
    const observer = useRef<IntersectionObserver | null>(null);
    const lastPostElementRef = useCallback((node: HTMLDivElement) => {
        if (loading) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                loadMorePosts();
            }
        });
        if (node) observer.current.observe(node);
    }, [loading, hasMore]);

    // Initial load and Refresh logic
    useEffect(() => {
        setPosts([]);
        setLastKey(null);
        setHasMore(true);
        loadMorePosts(true);
    }, [refreshTrigger]);

    const loadMorePosts = async (isInitial = false) => {
        if (loading) return;
        setLoading(true);
        setError(null);

        try {
            const currentLastKey = isInitial ? null : lastKey;
            const response = await apiService.getCommunityPosts(userId, 10, currentLastKey);

            if (response.success && response.data) {
                const newPosts: Post[] = response.data;
                const newLastKey = response.lastKey;

                setPosts(prev => isInitial ? newPosts : [...prev, ...newPosts]);
                setHasMore(!!newLastKey);
                setLastKey(newLastKey);
            } else {
                setError('無法載入文章');
            }
        } catch (err) {
            console.error('Failed to load posts', err);
            setError('載入失敗');
        } finally {
            setLoading(false);
        }
    };

    const handleLike = async (postId: string) => {
        // Optimistic update
        setPosts(prev => prev.map(p => {
            if (p.postId === postId) {
                const isLiked = !p.isLikedByMe;
                return {
                    ...p,
                    isLikedByMe: isLiked,
                    likeCount: isLiked ? p.likeCount + 1 : p.likeCount - 1
                };
            }
            return p;
        }));

        try {
            await apiService.likePost(postId, userId);
        } catch (error) {
            console.error('Failed to like post', error);
        }
    };

    return (
        <div className="flex flex-col pb-20">
            {posts.map((post, index) => {
                if (posts.length === index + 1) {
                    return (
                        <div ref={lastPostElementRef} key={post.postId}>
                            <PostCard post={post} onClick={(id, pos) => onPostClick(id, pos)} onLike={handleLike} onUserClick={onUserClick} />
                        </div>
                    );
                } else {
                    return <PostCard key={post.postId} post={post} onClick={(id, pos) => onPostClick(id, pos)} onLike={handleLike} onUserClick={onUserClick} />;
                }
            })}

            {loading && (
                <div className="flex justify-center py-4">
                    <Loader2 className="animate-spin text-cyber-cyan" />
                </div>
            )}

            {!hasMore && posts.length > 0 && (
                <div className="text-center text-slate-500 py-4 text-xs font-mono">
                    --- 已顯示所有文章 ---
                </div>
            )}

            {error && (
                <div className="flex items-center justify-center gap-2 text-red-400 py-4">
                    <AlertCircle size="1rem" />
                    <span>{error}</span>
                </div>
            )}

            {!loading && posts.length === 0 && !error && (
                <div className="text-center text-slate-500 py-10">
                    <p>尚無文章，快來搶頭香！</p>
                </div>
            )}
        </div>
    );
};

export default PostFeed;

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Image as ImageIcon, Send, Loader2, Hash, ArrowLeft } from 'lucide-react';
import * as apiService from '../services/apiService';
import { User } from '../types';
import { AppInput } from './ui/CommonUI';

interface ImageItem {
    id: string;
    file: File;
    preview: string;
    url?: string;
    status: 'uploading' | 'done' | 'error';
}

interface PostEditorProps {
    isOpen: boolean;
    onClose: () => void;
    onPostCreated: () => void;
    user: User | null;
}

const PostEditor: React.FC<PostEditorProps> = ({ isOpen, onClose, onPostCreated, user }) => {
    const [content, setContent] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    const [imageItems, setImageItems] = useState<ImageItem[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [content]);

    // 允許上傳的圖片格式與大小限制
    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0 && user) {
            const newFiles = Array.from(e.target.files);

            newFiles.forEach(async (file) => {
                // 檢查檔案類型
                if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                    alert(`不支援的圖片格式：${file.name}\n請使用 JPG、PNG、GIF 或 WebP 格式`);
                    return;
                }
                // 檢查檔案大小
                if (file.size > MAX_IMAGE_SIZE) {
                    alert(`圖片太大：${file.name}（${(file.size / 1024 / 1024).toFixed(1)}MB）\n請選擇 10MB 以下的圖片`);
                    return;
                }
                const id = Math.random().toString(36).substr(2, 9);
                const preview = URL.createObjectURL(file);

                const newItem: ImageItem = { id, file, preview, status: 'uploading' };
                setImageItems(prev => [...prev, newItem]);

                try {
                    const response = await apiService.getCommunityUploadUrl(user.userId, file.name, file.type);
                    if (response.success && response.data) {
                        const { uploadUrl, publicUrl } = response.data;
                        await fetch(uploadUrl, {
                            method: 'PUT',
                            body: file,
                            headers: {
                                'Content-Type': file.type,
                                'Cache-Control': 'public, max-age=31536000, immutable'
                            }
                        });
                        setImageItems(prev => prev.map(item =>
                            item.id === id ? { ...item, url: publicUrl, status: 'done' } : item
                        ));
                    } else {
                        throw new Error('Failed to get upload URL');
                    }
                } catch (error) {
                    console.error('Image upload failed:', error);
                    setImageItems(prev => prev.map(item =>
                        item.id === id ? { ...item, status: 'error' } : item
                    ));
                }
            });
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeImage = (id: string) => {
        setImageItems(prev => {
            const item = prev.find(i => i.id === id);
            if (item) URL.revokeObjectURL(item.preview);
            return prev.filter(i => i.id !== id);
        });
    };

    const handleTagKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            addTag();
        }
    };

    const addTag = () => {
        const tag = tagInput.trim().replace(/^#/, '');
        if (tag && !tags.includes(tag)) {
            setTags([...tags, tag]);
            setTagInput('');
        }
    };

    const removeTag = (tagToRemove: string) => {
        setTags(tags.filter(tag => tag !== tagToRemove));
    };

    const isUploading = imageItems.some(item => item.status === 'uploading');

    const handleSubmit = async () => {
        if (!content.trim() && imageItems.length === 0) return;
        if (!user) return;
        if (isUploading) return;

        setIsSubmitting(true);
        try {
            const uploadedImageUrls = imageItems
                .filter(item => item.status === 'done' && item.url)
                .map(item => item.url as string);

            await apiService.createCommunityPost({
                userId: user.userId,
                content: content,
                contentType: 'text',
                images: uploadedImageUrls,
                tags: tags
            });

            setContent('');
            setTags([]);
            setImageItems([]);
            onPostCreated();
            onClose();

        } catch (error) {
            console.error('Failed to create post:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    // origin point logic for animation
    const originX = '50%';
    const originY = '50%';

    return createPortal(
        <div className="fixed inset-0 z-[999] bg-[#f9f9f7] flex flex-col animate-expand-from-point"
            style={{
                '--origin-x': originX,
                '--origin-y': originY,
            } as React.CSSProperties}
        >
            {/* Header */}
            <div className="flex-shrink-0 bg-white/80 backdrop-blur-xl border-b border-black/[0.03] z-50 pt-safe font-inter">
                <div className="h-16 px-4 flex items-center justify-between">
                    <button
                        onClick={onClose}
                        className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-neutral-900 border border-black/[0.01] shadow-sm active:scale-90 transition-all font-black"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="text-center">
                        <span className="text-neutral-900 font-black tracking-[0.2em] text-[0.6875rem] uppercase">建立貼文</span>
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || isUploading || (!content.trim() && imageItems.length === 0)}
                        className="h-10 px-5 bg-neutral-900 text-white rounded-lg disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2.5 transition-all shadow-xl active:scale-95 group"
                    >
                        {isSubmitting ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <>
                                <span className="text-xs font-black uppercase tracking-widest">發布貼文</span>
                                <Send size={15} strokeWidth={2.5} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Scrollable Form Area */}
            <div className="flex-1 overflow-y-auto no-scrollbar pt-4 pb-20">
                <div className="flex flex-col gap-4">

                    {/* Meta Section: User Info Anchor */}
                    <div className="flex items-center gap-4 bg-white p-4 border-y border-black/[0.03] shadow-sm">
                        <div className="w-12 h-12 rounded-lg bg-neutral-50 overflow-hidden border border-black/[0.05] shadow-inner">
                            {user?.pictureUrl ? (
                                <img src={user.pictureUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-neutral-400 font-black text-xs uppercase">{user?.displayName?.[0] || 'U'}</div>
                            )}
                        </div>
                        <div className="flex flex-col">
                            <span className="text-neutral-900 font-black text-sm tracking-tight">{user?.displayName}</span>
                            <div className="flex items-center gap-1.5 mt-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                                <span className="text-[0.625rem] text-neutral-300 font-black uppercase tracking-widest">發佈狀態：就緒</span>
                            </div>
                        </div>
                    </div>

                    {/* Content Section: Text Overlay */}
                    <div className="flex flex-col gap-2">
                        <label className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-[0.3em] px-4">分享內容</label>
                        <div className="bg-white border-y border-black/[0.03] p-5 shadow-sm min-h-[11.25rem]">
                            <textarea
                                ref={textareaRef}
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                placeholder="分享一下剛才這局的戰況，或者有什麼打牌心得想說嗎？"
                                className="w-full bg-transparent text-neutral-800 text-[1rem] placeholder:text-neutral-200 outline-none resize-none font-medium leading-relaxed"
                            />
                        </div>
                    </div>

                    {/* Media Section: Evidence Logs */}
                    <div className="flex flex-col gap-2">
                        <label className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-[0.3em] px-4">相片紀錄</label>
                        <div className="px-4">
                            <div className="flex overflow-x-auto gap-3 pb-2 no-scrollbar">
                                {imageItems.map((item) => (
                                    <div key={item.id} className="relative flex-none w-40 aspect-[4/3] rounded-lg overflow-hidden border border-black/[0.03] shadow-md group animate-in fade-in zoom-in-95 duration-300">
                                        <img src={item.preview} alt="" className={`w-full h-full object-cover ${item.status === 'uploading' ? 'opacity-40 grayscale' : ''}`} />
                                        {item.status === 'uploading' && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/5">
                                                <Loader2 size={16} className="text-[#c5a059] animate-spin" />
                                            </div>
                                        )}
                                        <button
                                            onClick={() => removeImage(item.id)}
                                            className="absolute top-2 right-2 w-7 h-7 bg-neutral-900/80 text-white rounded-full flex items-center justify-center shadow-lg transform active:scale-90 transition-all border border-white/10"
                                        >
                                            <X size={14} strokeWidth={3} />
                                        </button>
                                    </div>
                                ))}

                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex-none w-40 aspect-[4/3] rounded-lg bg-white border border-dashed border-black/[0.1] flex flex-col items-center justify-center gap-2 text-neutral-300 hover:text-[#c5a059] hover:border-[#c5a059]/30 transition-all group shadow-sm"
                                >
                                    <div className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <ImageIcon size={20} strokeWidth={2} />
                                    </div>
                                    <span className="text-[0.5625rem] font-black uppercase tracking-widest group-hover:text-neutral-900 transition-colors">上傳照片</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Tag Section: Registry Metadata */}
                    <div className="flex flex-col gap-2">
                        <label className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-[0.3em] px-4">標籤分類</label>
                        <div className="bg-white border-y border-black/[0.03] p-5 shadow-sm space-y-4">
                            <div className="flex flex-wrap gap-2 min-h-[1.25rem]">
                                {tags.map(tag => (
                                    <span key={tag} className="flex items-center gap-1.5 text-[0.625rem] text-[#c5a059] bg-[#c5a059]/5 px-3 py-1.5 rounded-lg border border-[#c5a059]/10 font-black uppercase tracking-widest animate-in zoom-in-90">
                                        <Hash size={10} strokeWidth={3} />
                                        {tag}
                                        <button onClick={() => removeTag(tag)} className="ml-1 text-[#c5a059]/40 hover:text-red-500 transition-colors"><X size={12} strokeWidth={3} /></button>
                                    </span>
                                ))}
                                {tags.length === 0 && <span className="text-neutral-200 text-[0.625rem] font-black uppercase italic tracking-widest">尚未新增標籤...</span>}
                            </div>
                            <AppInput
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyDown={handleTagKeyDown}
                                onBlur={addTag}
                                placeholder="輸入標籤關鍵字..."
                                icon={Hash}
                            />
                        </div>
                    </div>

                </div>
            </div>

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageSelect}
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                className="hidden"
            />
        </div>,
        document.body
    );
};

export default PostEditor;

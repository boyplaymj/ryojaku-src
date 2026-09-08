// hooks/useEventImages.ts — 團局照片的上傳狀態與 handler（[A3-p]）
//
// 從 `pages/CreateGroup.tsx` 原封抽出（三步驟：拿 presigned URL → PUT 上 S3 →
// 把 url 寫回該筆），行為逐字不變，只是把 state 與兩個 handler 搬進 hook。
//
// 🔴 抽出來的理由是**編輯頁要用同一份**。這段有三個各自的失敗狀態
//    （拿不到 URL／PUT 失敗／使用者中途移除），複製一份到編輯頁的話，
//    日後只會有一邊被修 —— 而兩邊的差別只有「同一張圖在兩個入口上傳結果不同」
//    才看得出來，那是使用者會遇到、我們不會遇到的情形。
//
// ⚠️ **只有 `status === 'done'` 的才會被送出去**（呼叫端負責過濾，
//    `buildCreateGamePayload` 與編輯頁都是這樣做）。上傳中／失敗的留在畫面上
//    讓使用者看得到，但不進 payload。
import { useCallback, useRef, useState } from 'react';
import type { ImageItem } from '../components/CreateGroupStage2';
import * as apiService from '../services/apiService';

/**
 * @param userId 取 presigned URL 需要它；沒有登入者時 `handleImageSelect` 直接不做事
 *               （與抽出前的 `&& user` 判斷等價）。
 * @param initialUrls 編輯既有團局時，把已經上傳過的圖先鋪進來。
 *                    它們沒有 `file`，`status` 一開始就是 `'done'` ——
 *                    🔴 少了這一半，編輯頁存檔會把既有照片**整批洗掉**
 *                       （`update-game` 的 images 是整欄覆寫）。
 */
export function useEventImages(userId: string | undefined, initialUrls?: string[]) {
    const [imageItems, setImageItems] = useState<ImageItem[]>(() =>
        (initialUrls || []).map((url, i) => ({
            id: `existing-${i}-${url}`,
            preview: url,
            url,
            status: 'done' as const,
        })),
    );
    const fileInputRef = useRef<HTMLInputElement>(null);

    /** 用已存在的 url 重鋪一次（非同步載入完團局細節之後呼叫）。 */
    const resetToUrls = useCallback((urls: string[]) => {
        setImageItems(urls.map((url, i) => ({
            id: `existing-${i}-${url}`,
            preview: url,
            url,
            status: 'done' as const,
        })));
    }, []);

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0 && userId) {
            const newFiles = Array.from(e.target.files);

            newFiles.forEach(async (file) => {
                const id = Math.random().toString(36).substr(2, 9);
                const preview = URL.createObjectURL(file);

                // Add to state immediately
                const newItem: ImageItem = { id, file, preview, status: 'uploading' };
                setImageItems(prev => [...prev, newItem]);

                try {
                    // 1. Get Presigned URL
                    const response = await apiService.getEventUploadUrl(userId, file.name, file.type);

                    if (response.success && response.data) {
                        const { uploadUrl, publicUrl } = response.data;

                        // 2. Upload to S3
                        await fetch(uploadUrl, {
                            method: 'PUT',
                            body: file,
                            headers: {
                                'Content-Type': file.type,
                                'Cache-Control': 'public, max-age=31536000, immutable'
                            }
                        });

                        // 3. Update state with URL
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
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeImage = (id: string) => {
        setImageItems(prev => {
            const item = prev.find(i => i.id === id);
            // ⚠️ 只 revoke 我們自己 createObjectURL 出來的那些（blob:）——
            //    既有照片的 preview 是遠端 https URL，revoke 它是 no-op 但語意上錯。
            if (item && item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview);
            return prev.filter(i => i.id !== id);
        });
    };

    return { imageItems, setImageItems, resetToUrls, fileInputRef, handleImageSelect, removeImage };
}

/**
 * 表單草稿暫存工具函數
 * 使用 localStorage 來暫存創建團局的表單資料
 */

import { CreateMahjongGamePayload } from '../types';

// LocalStorage Key 常數
const STORAGE_KEYS = {
    CREATE_GAME_DRAFT: 'mahjongclub_create_game_draft',
};

// 草稿有效期（小時）
const DRAFT_EXPIRY_HOURS = 24;

/**
 * 創建團局草稿資料結構
 */
export interface CreateGameDraft {
    formData: CreateMahjongGamePayload;
    coordinates: { latitude: number; longitude: number };
    envOptions?: {
        smoking: string;
        parking: string[];
        elevator: string;
        mahjongTable: string;
        tableModel: string;
        venueType?: string;
        skillLevel?: string;
    };
    savedAt: number;  // Unix timestamp，用於檢查資料是否過期
}

/**
 * 儲存創建團局的草稿資料
 * 
 * @param formData 表單資料
 * @param coordinates GPS 座標
 */
export function saveCreateGameDraft(
    formData: CreateMahjongGamePayload,
    coordinates: { latitude: number; longitude: number },
    envOptions?: CreateGameDraft['envOptions']
): void {
    try {
        const draft: CreateGameDraft = {
            formData,
            coordinates,
            envOptions,
            savedAt: Date.now(),
        };
        localStorage.setItem(STORAGE_KEYS.CREATE_GAME_DRAFT, JSON.stringify(draft));
    } catch (error) {
        console.error('Failed to save create game draft:', error);
    }
}

/**
 * 讀取創建團局的草稿資料
 * 若草稿不存在或已過期（超過 24 小時），則返回 null
 * 
 * @returns 草稿資料，若不存在或已過期則返回 null
 */
export function loadCreateGameDraft(): CreateGameDraft | null {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.CREATE_GAME_DRAFT);
        if (!saved) return null;

        const draft: CreateGameDraft = JSON.parse(saved);

        // 檢查是否過期（24 小時）
        const expiryTime = DRAFT_EXPIRY_HOURS * 60 * 60 * 1000;
        if (Date.now() - draft.savedAt > expiryTime) {
            clearCreateGameDraft();
            return null;
        }

        return draft;
    } catch (error) {
        console.error('Failed to load create game draft:', error);
        return null;
    }
}

/**
 * 清除創建團局的草稿資料
 */
export function clearCreateGameDraft(): void {
    try {
        localStorage.removeItem(STORAGE_KEYS.CREATE_GAME_DRAFT);
    } catch (error) {
        console.error('Failed to clear create game draft:', error);
    }
}

/**
 * 檢查是否有草稿資料
 * 
 * @returns 是否有有效的草稿
 */
export function hasCreateGameDraft(): boolean {
    return loadCreateGameDraft() !== null;
}

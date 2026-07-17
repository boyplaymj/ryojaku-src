/**
 * 個人資料完整性檢查工具函數
 * 用於判斷使用者是否已完成必填的個人資料
 */

import { User } from '../types';

// 有效的性別選項
export const VALID_GENDERS = ['男', '女', '其他'];

// 有效的年齡範圍選項
export const VALID_AGE_RANGES = ['18-25', '26-35', '36-45', '46-55', '56+'];

// 有效的麻將經驗選項
export const VALID_EXPERIENCES = ['新手', '初級', '中級', '高級', '專家'];

/**
 * 檢查使用者個人資料是否完整
 * 必填欄位：displayName, gender, ageRange, mahjongExperience, lineId
 * 非必填欄位：pictureUrl
 * 
 * @param user 使用者資料
 * @returns 是否完整
 */
export function isProfileComplete(user: User | null): boolean {
    if (!user) {
        console.log('🔍 [ProfileCheck] No user object');
        return false;
    }

    const isInvalid = (val: string | undefined) => {
        if (!val) return true;
        const trimmed = val.trim();
        return trimmed === '' || trimmed === '未設定' || trimmed === 'N/A' || trimmed === '空字串';
    };

    const checks = {
        displayName: !isInvalid(user.displayName),
        gender: VALID_GENDERS.includes(user.gender || '') && !isInvalid(user.gender),
        ageRange: VALID_AGE_RANGES.includes(user.ageRange || '') && !isInvalid(user.ageRange),
        mahjongExperience: VALID_EXPERIENCES.includes(user.mahjongExperience || '') && !isInvalid(user.mahjongExperience),
        lineId: !isInvalid(user.lineId)
    };

    const isComplete = Object.values(checks).every(v => v === true);

    if (!isComplete) {
        console.log('🔍 [ProfileCheck] Incomplete profile:', checks);
        console.log('🔍 [ProfileCheck] User data:', {
            displayName: user.displayName,
            gender: user.gender,
            ageRange: user.ageRange,
            mahjongExperience: user.mahjongExperience,
            lineId: user.lineId
        });
    }

    return isComplete;
}

/**
 * 取得缺少的個人資料欄位名稱
 * 
 * @param user 使用者資料
 * @returns 缺少的欄位名稱陣列
 */
export function getMissingProfileFields(user: User | null): string[] {
    if (!user) return ['所有資料'];

    const missing: string[] = [];
    const isInvalid = (val: string | undefined) => {
        if (!val) return true;
        const trimmed = val.trim();
        return trimmed === '' || trimmed === '未設定' || trimmed === 'N/A' || trimmed === '空字串';
    };

    if (isInvalid(user.displayName)) missing.push('顯示名稱');
    if (isInvalid(user.gender) || !VALID_GENDERS.includes(user.gender || '')) missing.push('性別');
    if (isInvalid(user.ageRange) || !VALID_AGE_RANGES.includes(user.ageRange || '')) missing.push('年齡範圍');
    if (isInvalid(user.mahjongExperience) || !VALID_EXPERIENCES.includes(user.mahjongExperience || '')) missing.push('麻將經驗');
    if (isInvalid(user.lineId)) missing.push('LINE ID');

    return missing;
}

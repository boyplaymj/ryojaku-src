import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/dataService';
import { User } from '../types';

export const useDailyBonus = (user: User | null) => {
    const [showModal, setShowModal] = useState(false);
    const [bonusData, setBonusData] = useState<{
        pointsEarned: number;
        consecutiveDays: number;
        isStreakBonus: boolean;
    } | null>(null);

    const checkAndClaimBonus = useCallback(async () => {
        if (!user) return;

        // 1. Client-side check with localStorage (+8 Timezone)
        const now = new Date();
        const taipeiTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
        const todayStr = taipeiTime.toISOString().split('T')[0];

        const lastClaimDate = localStorage.getItem(`lastDailyClaim_${user.userId}`);

        if (lastClaimDate === todayStr) {
            console.log('DailyBonus: Already claimed today (local check)');
            return;
        }

        // 2. Call API to claim
        try {
            const response = await api.claimDailyBonus();
            if (response.success && response.data) {
                setBonusData(response.data);
                setShowModal(true);
                // 3. Mark as claimed locally
                localStorage.setItem(`lastDailyClaim_${user.userId}`, todayStr);
            } else if (response.error?.includes('already claimed')) {
                // If backend says already claimed, sync local storage
                localStorage.setItem(`lastDailyClaim_${user.userId}`, todayStr);
            }
        } catch (error) {
            console.error('DailyBonus: Failed to claim daily bonus', error);
        }
    }, [user?.userId]);

    return {
        showModal,
        setShowModal,
        bonusData,
        checkAndClaimBonus
    };
};

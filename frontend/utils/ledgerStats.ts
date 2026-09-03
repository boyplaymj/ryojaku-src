// utils/ledgerStats.ts — 帳本頁的純計算邏輯（[A1-a-1]）
//
// 從 pages/Ledger.tsx 逐字搬出來的兩段：月份過濾＋排序、月度統計。
// 搬出來的理由：frontend/ 底下沒有任何元件測試，後面 [A1-a] 要拆 LedgerPage 的殼，
// 只有先把可測的純邏輯抽出來，才有回歸網可以掛。
//
// 🔴 本檔是「純抽取」：行為與 Ledger.tsx 搬走前**逐字相同**，包含它已知的不一致（見下）。

export interface Opponent {
    name: string;
    userId?: string;
}

export interface LedgerEntry {
    userId: string;
    ledgerId?: string;
    date: string;
    stakes: string;
    rounds: number;
    winLoss: number;
    actualAmount: number;
    opponents: Opponent[];
    mood: string;
    note: string;
    gameId?: string;
    createdAt?: number;
}

// ⚠️ 這不是 Ledger.tsx 裡的 LedgerSummary（那份是後端回來的，欄位不同）。
//    這份是前端自己從當月 entries 算出來的，欄位就是 computeLedgerStats 回傳的那 8 個。
export interface LedgerStats {
    totalEntries: number;
    totalRounds: number;
    totalWinLoss: number;
    averageWin: number;
    winRate: number;
    mostFrequentOpponent: string;
    mostWonOpponent: string;
    topStakes: { label: string; count: number; percentage: number }[];
}

/** 只留 `month` 那個年月的 entries，並依日期由新到舊排序。 */
export function filterEntriesByMonth(entries: LedgerEntry[], month: Date): LedgerEntry[] {
    return entries.filter(e => {
        const [y, m] = e.date.split('-').map(Number);
        return y === month.getFullYear() && (m - 1) === month.getMonth();
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * 由（已過濾的）當月 entries 算出統計。
 *
 * 🔴 已知不一致（搬過來時的現況，不是設計意圖，`[A1-c]` 要回頭決定）：
 *    - `winRate` 把 `winLoss === 0` 算成贏（`>= 0`）
 *    - `opponentWinCounts`（⇒ `mostWonOpponent`）只算 `> 0`
 *    兩個「贏」的門檻不同。本檔是純抽取，**不在這裡修**；
 *    `ledgerStats.test.ts` 有一條測試把這個現況釘住，改了任何一邊它就會紅。
 */
export function computeLedgerStats(filteredEntries: LedgerEntry[]): LedgerStats {
    const totalEntries = filteredEntries.length;
    const totalRounds = filteredEntries.reduce((sum, e) => sum + (e.rounds || 0), 0);
    const totalWinLoss = filteredEntries.reduce((sum, e) => sum + (e.winLoss || 0), 0);
    const averageWin = totalEntries > 0 ? totalWinLoss / totalEntries : 0;
    const winRate = totalEntries > 0 ? (filteredEntries.filter(e => e.winLoss >= 0).length / totalEntries) * 100 : 0;

    // Opponent stats
    const opponentCounts: Record<string, number> = {};
    const opponentWinCounts: Record<string, number> = {};
    const stakesCounts: Record<string, number> = {};

    filteredEntries.forEach(entry => {
        // Stakes
        if (entry.stakes) {
            stakesCounts[entry.stakes] = (stakesCounts[entry.stakes] || 0) + 1;
        }

        // Opponents
        (entry.opponents || []).forEach(opp => {
            if (opp.name && opp.name.trim()) {
                opponentCounts[opp.name] = (opponentCounts[opp.name] || 0) + 1;
                if ((entry.winLoss || 0) > 0) {
                    opponentWinCounts[opp.name] = (opponentWinCounts[opp.name] || 0) + 1;
                }
            }
        });
    });

    const sortedOpps = Object.entries(opponentCounts).sort((a, b) => b[1] - a[1]);
    const mostFrequentOpponent = sortedOpps[0]?.[0] || '無';

    const sortedWinOpps = Object.entries(opponentWinCounts).sort((a, b) => b[1] - a[1]);
    const mostWonOpponent = sortedWinOpps[0]?.[0] || '無';

    const sortedStakes = Object.entries(stakesCounts).sort((a, b) => b[1] - a[1]);
    const topStakes = sortedStakes.slice(0, 3).map(([stake, count]) => ({
        label: stake,
        count: count,
        percentage: totalEntries > 0 ? Math.round((count / totalEntries) * 100) : 0
    }));

    return {
        totalEntries,
        totalRounds,
        totalWinLoss,
        averageWin,
        winRate,
        mostFrequentOpponent,
        mostWonOpponent,
        topStakes
    };
}

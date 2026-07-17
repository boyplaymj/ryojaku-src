import React, { useState, useEffect } from 'react';
import { Search, MoreVertical, Shield, Loader2, Ban, Coins, X } from 'lucide-react';
import { api } from '../services/api';

interface UserData {
    id: string;
    displayName?: string;
    name?: string;
    email: string;
    status: string;
    role: string;
    points?: number;
    lastLoginAt?: string;
    lastLogin?: string;
}

interface PointTransaction {
    txId: string;
    type: 'CREDIT' | 'DEBIT';
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    reason: string;
    source: string;
    createdAt: number;
}

const Users: React.FC = () => {
    const [users, setUsers] = useState<UserData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Search & Pagination States
    const [searchId, setSearchId] = useState('');
    const [searchName, setSearchName] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [pageKeys, setPageKeys] = useState<{ [key: number]: string }>({ 1: '' });
    const [isSearching, setIsSearching] = useState(false);

    const [historyUserId, setHistoryUserId] = useState<string | null>(null);
    const [historyData, setHistoryData] = useState<PointTransaction[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    const fetchUsers = async (page: number, params?: { userId?: string, displayName?: string }) => {
        try {
            setLoading(true);
            const key = pageKeys[page] || '';
            const res = await api.users.list({
                ...params,
                lastKey: key
            });

            setUsers(res.data || []);
            setTotalItems(res.meta?.total || 0);

            // If we have a next key, save it for the next page
            if (res.lastKey) {
                setPageKeys(prev => ({ ...prev, [page + 1]: res.lastKey }));
            }
            setCurrentPage(page);
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            console.error(err);
            setError('無法載入用戶列表');
        } finally {
            setLoading(false);
            setIsSearching(false);
        }
    };

    useEffect(() => {
        fetchUsers(1);
    }, []);

    const handleSearch = () => {
        setIsSearching(true);
        setCurrentPage(1);
        setPageKeys({ 1: '' });
        fetchUsers(1, {
            userId: searchId.trim() || undefined,
            displayName: searchName.trim() || undefined
        });
    };

    const handlePageChange = (newPage: number) => {
        if (newPage < 1) return;
        fetchUsers(newPage, {
            userId: searchId.trim() || undefined,
            displayName: searchName.trim() || undefined
        });
    };

    const totalPages = Math.ceil(totalItems / 20);

    const handleViewHistory = async (userId: string) => {
        setHistoryUserId(userId);
        setHistoryLoading(true);
        try {
            const res = await api.users.getPointHistory(userId);
            setHistoryData(res.transactions || []);
        } catch (err) {
            console.error(err);
            setHistoryData([]);
        } finally {
            setHistoryLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="p-8 flex justify-center items-center h-64">
                <Loader2 className="animate-spin text-cyan-500" size={40} />
            </div>
        );
    }

    const selectedUserName = users.find(u => u.id === historyUserId)?.displayName || '用戶';

    return (
        <div className="p-4 md:p-8 space-y-6">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-white">用戶管理</h1>
                    <p className="text-slate-400 mt-2 text-sm md:text-base">查詢與管理所有註冊用戶狀態</p>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
                    <div className="relative w-full sm:w-48">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                        <input
                            type="text"
                            placeholder="使用者 ID..."
                            value={searchId}
                            onChange={(e) => setSearchId(e.target.value)}
                            className="bg-slate-900/50 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-white text-sm focus:outline-none focus:border-cyan-500/50 w-full"
                        />
                    </div>
                    <div className="relative w-full sm:w-48">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                        <input
                            type="text"
                            placeholder="使用者暱稱..."
                            value={searchName}
                            onChange={(e) => setSearchName(e.target.value)}
                            className="bg-slate-900/50 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-white text-sm focus:outline-none focus:border-cyan-500/50 w-full"
                        />
                    </div>
                    <button
                        onClick={handleSearch}
                        disabled={isSearching}
                        className="w-full sm:w-auto px-6 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-900/20"
                    >
                        {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                        查詢
                    </button>
                </div>
            </div>

            {error && <div className="text-red-400 bg-red-400/10 p-4 rounded-xl border border-red-400/20">{error}</div>}

            <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left bg-transparent min-w-[800px]">
                        {/* ... Table Header ... */}
                        <thead className="bg-white/5 text-slate-400 border-b border-white/5">
                            <tr>
                                <th className="p-4 font-medium">用戶資訊</th>
                                <th className="p-4 font-medium text-center">剩餘點數</th>
                                <th className="p-4 font-medium">狀態</th>
                                <th className="p-4 font-medium">角色</th>
                                <th className="p-4 font-medium">最後登入</th>
                                <th className="p-4 font-medium text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {users.map((user) => (
                                <tr key={user.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-cyan-400 font-bold border border-white/5 group-hover:border-cyan-500/30 transition-all">
                                                {(user.displayName || user.name || 'U')[0]}
                                            </div>
                                            <div>
                                                <div className="font-medium text-white">{user.displayName || user.name}</div>
                                                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{user.id}</div>
                                                <div className="text-xs text-slate-500">{user.email || 'LINE用戶'}</div>
                                            </div>
                                        </div>
                                    </td>
                                    {/* ... rest of columns ... */}
                                    <td className="p-4 text-center">
                                        <div className="flex items-center justify-center gap-1.5 text-amber-400 font-bold">
                                            <Coins size={14} />
                                            {user.points || 0}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className={`px-3 py-1 rounded-full text-xs font-medium border ${user.status === 'active'
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                                            }`}>
                                            {user.status === 'active' ? '正常' : '已封鎖'}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <div className="text-slate-300 flex items-center gap-1.5">
                                            <Shield size={14} className="text-cyan-400" />
                                            {user.role}
                                        </div>
                                    </td>
                                    <td className="p-4 text-slate-400 font-mono text-sm">
                                        {user.lastLoginAt || user.lastLogin || 'Never'}
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button
                                                onClick={() => handleViewHistory(user.id)}
                                                className="text-amber-400 hover:text-amber-300 p-2 hover:bg-amber-400/10 rounded-lg transition-colors" title="點數歷史">
                                                <Coins size={18} />
                                            </button>
                                            <button className="text-slate-400 hover:text-red-400 p-2 hover:bg-white/10 rounded-lg transition-colors" title="封鎖用戶">
                                                <Ban size={18} />
                                            </button>
                                            <button className="text-slate-400 hover:text-white p-2 hover:bg-white/10 rounded-lg transition-colors">
                                                <MoreVertical size={18} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-900/40 backdrop-blur-md border border-white/5 p-4 rounded-2xl shadow-lg">
                    <div className="text-slate-400 text-sm">
                        顯示第 <span className="text-white font-medium">{(currentPage - 1) * 20 + 1}</span> 至 <span className="text-white font-medium">{Math.min(currentPage * 20, totalItems)}</span> 筆，共 <span className="text-cyan-400 font-bold">{totalItems}</span> 筆用戶
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1 || loading}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 text-slate-300 rounded-xl text-sm font-medium transition-all border border-white/5"
                        >
                            上一頁
                        </button>
                        <div className="px-4 py-2 bg-cyan-600/10 border border-cyan-500/20 text-cyan-400 rounded-xl text-sm font-bold min-w-[80px] text-center">
                            第 {currentPage} / {totalPages} 頁
                        </div>
                        <button
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages || loading}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 text-slate-300 rounded-xl text-sm font-medium transition-all border border-white/5"
                        >
                            下一頁
                        </button>
                    </div>
                </div>
            )}

            {/* Point History Modal */}
            {historyUserId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setHistoryUserId(null)} />
                    <div className="relative bg-slate-900 border border-white/10 rounded-2xl w-full max-w-4xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Coins className="text-amber-400" size={20} />
                                    點數變動紀錄 - {selectedUserName}
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">顯示最近 100 筆紀錄</p>
                            </div>
                            <button onClick={() => setHistoryUserId(null)} className="text-slate-400 hover:text-white p-2">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {historyLoading ? (
                                <div className="p-12 flex justify-center">
                                    <Loader2 className="animate-spin text-amber-500" size={32} />
                                </div>
                            ) : historyData.length > 0 ? (
                                <table className="w-full text-left">
                                    <thead className="sticky top-0 bg-slate-900 text-xs text-slate-400 uppercase border-b border-white/5">
                                        <tr>
                                            <th className="p-4">時間</th>
                                            <th className="p-4">類型</th>
                                            <th className="p-4 text-right">變動</th>
                                            <th className="p-4 text-right">變動後</th>
                                            <th className="p-4">原因</th>
                                            <th className="p-4">來源</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {historyData.map((tx) => (
                                            <tr key={tx.txId} className="hover:bg-white/5 transition-colors text-sm">
                                                <td className="p-4 text-slate-400 font-mono whitespace-nowrap">
                                                    {new Date(tx.createdAt).toLocaleString()}
                                                </td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${tx.type === 'CREDIT'
                                                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                                        }`}>
                                                        {tx.type === 'CREDIT' ? '增加' : '扣除'}
                                                    </span>
                                                </td>
                                                <td className={`p-4 text-right font-bold ${tx.type === 'CREDIT' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                    {tx.type === 'CREDIT' ? '+' : '-'}{tx.amount}
                                                </td>
                                                <td className="p-4 text-right text-white font-mono">
                                                    {tx.balanceAfter}
                                                </td>
                                                <td className="p-4 text-slate-300">
                                                    {tx.reason}
                                                </td>
                                                <td className="p-4 text-slate-500 text-xs">
                                                    {tx.source}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-12 text-center text-slate-500">
                                    尚無點數異動紀錄
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Users;

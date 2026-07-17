import React, { useState, useEffect } from 'react';
import { User, Shield, Key, History, Loader2, Users, Plus, Trash2, Edit2, Save, X, Lock } from 'lucide-react';
import { api } from '../services/api';

interface AuditLog {
    action: string;
    targetText?: string;
    target?: string;
    timestamp: string;
    admin: string;
    details?: string;
}

interface AdminAccount {
    username: string;
    role: string;
    createdAt?: string;
    lastLoginAt?: string;
}

const Settings: React.FC = () => {
    const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
    const isSuper = adminUser.role === 'super_admin';

    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    const [admins, setAdmins] = useState<AdminAccount[]>([]);
    const [loadingAdmins, setLoadingAdmins] = useState(false);

    const [showAdminModal, setShowAdminModal] = useState(false);
    const [editingAdmin, setEditingAdmin] = useState<AdminAccount | null>(null);
    const [adminForm, setAdminForm] = useState({ username: '', password: '', role: 'admin' });

    const [securityPolicies, setSecurityPolicies] = useState({
        passwordMinLength: 8,
        requireSpecialChar: true,
        accountLockoutThreshold: 5,
        sessionTimeoutMinutes: 60
    });

    useEffect(() => {
        fetchLogs();
        if (isSuper) {
            fetchAdmins();
        }
    }, [isSuper]);

    const fetchLogs = async () => {
        try {
            setLoadingLogs(true);
            const data = await api.logs.list();
            setLogs(data || []);
        } catch (err) {
            console.error('Failed to fetch logs:', err);
        } finally {
            setLoadingLogs(false);
        }
    };

    const fetchAdmins = async () => {
        try {
            setLoadingAdmins(true);
            const data = await api.admins.list();
            setAdmins(data || []);
        } catch (err) {
            console.error('Failed to fetch admins:', err);
        } finally {
            setLoadingAdmins(false);
        }
    };

    const handleAdminSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingAdmin) {
                await api.admins.update({
                    username: adminForm.username,
                    password: adminForm.password || undefined,
                    role: adminForm.role
                });
            } else {
                await api.admins.create(adminForm);
            }
            setShowAdminModal(false);
            setAdminForm({ username: '', password: '', role: 'admin' });
            setEditingAdmin(null);
            fetchAdmins();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleDeleteAdmin = async (username: string) => {
        if (username === adminUser.username) {
            alert('您不能刪除自己的帳號');
            return;
        }
        if (confirm(`確定要刪除管理員 ${username} 嗎？`)) {
            try {
                await api.admins.delete(username);
                fetchAdmins();
            } catch (err: any) {
                alert(err.message);
            }
        }
    };

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <header>
                <h1 className="text-2xl md:text-3xl font-bold text-white">系統設置與安全性</h1>
                <p className="text-slate-400 mt-2 text-sm md:text-base">管理管理員帳號、安全策略與系統日誌</p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
                {/* Left Column: Personal & Security Policy */}
                <div className="lg:col-span-1 space-y-8">
                    {/* Account Info */}
                    <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl shadow-xl">
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                            <User size={20} className="text-cyan-400" /> 個人帳戶資料
                        </h3>
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-16 h-16 rounded-2xl bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                                <User size={32} />
                            </div>
                            <div>
                                <h4 className="text-xl font-bold text-white">{adminUser.username || 'Admin'}</h4>
                                <p className="text-cyan-400 text-sm font-medium">{isSuper ? '超級管理員' : '普通管理員'}</p>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <button className="w-full bg-white/5 hover:bg-white/10 text-white p-3 rounded-xl transition-all border border-white/5 hover:border-cyan-500/30 flex items-center gap-3">
                                <Shield size={18} className="text-cyan-400" /> 安全驗證設定
                            </button>
                            <button className="w-full bg-white/5 hover:bg-white/10 text-white p-3 rounded-xl transition-all border border-white/5 hover:border-cyan-500/30 flex items-center gap-3">
                                <Key size={18} className="text-cyan-400" /> 修改登入密碼
                            </button>
                        </div>
                    </div>

                    {/* Security Policies */}
                    <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl shadow-xl">
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                            <Lock size={20} className="text-cyan-400" /> 安全政策 UI (僅預覽)
                        </h3>
                        <div className="space-y-5">
                            <div>
                                <label className="block text-sm text-slate-400 mb-2 font-medium">密碼最小長度</label>
                                <input
                                    type="number"
                                    value={securityPolicies.passwordMinLength}
                                    onChange={(e) => setSecurityPolicies({ ...securityPolicies, passwordMinLength: parseInt(e.target.value) })}
                                    className="w-full bg-slate-800 border border-white/5 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-400 font-medium">要求特殊字元</span>
                                <input
                                    type="checkbox"
                                    checked={securityPolicies.requireSpecialChar}
                                    onChange={(e) => setSecurityPolicies({ ...securityPolicies, requireSpecialChar: e.target.checked })}
                                    className="w-5 h-5 accent-cyan-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-slate-400 mb-2 font-medium">失敗登錄鎖定次數</label>
                                <input
                                    type="number"
                                    value={securityPolicies.accountLockoutThreshold}
                                    onChange={(e) => setSecurityPolicies({ ...securityPolicies, accountLockoutThreshold: parseInt(e.target.value) })}
                                    className="w-full bg-slate-800 border border-white/5 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                />
                            </div>
                            <button className="w-full bg-cyan-500/10 hover:bg-cyan-500 text-cyan-400 hover:text-slate-950 p-2.5 rounded-xl transition-all font-bold text-sm border border-cyan-500/30 flex items-center justify-center gap-2">
                                <Save size={16} /> 保存安全性策略
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Column: Admin Management & Logs */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Admin Management */}
                    {isSuper && (
                        <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl shadow-xl overflow-hidden">
                            <div className="p-6 border-b border-white/5 flex justify-between items-center">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Users size={20} className="text-cyan-400" /> 管理員帳號維護
                                </h3>
                                <button
                                    onClick={() => {
                                        setEditingAdmin(null);
                                        setAdminForm({ username: '', password: '', role: 'admin' });
                                        setShowAdminModal(true);
                                    }}
                                    className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                                >
                                    <Plus size={16} /> 新增管理員
                                </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left min-w-[500px]">
                                    <thead className="bg-white/5 text-slate-400 text-xs uppercase tracking-wider">
                                        <tr>
                                            <th className="px-6 py-4">用戶名</th>
                                            <th className="px-6 py-4">權限角色</th>
                                            <th className="px-6 py-4 text-right">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {loadingAdmins ? (
                                            <tr><td colSpan={3} className="px-6 py-12 text-center"><Loader2 className="animate-spin inline text-cyan-500" /></td></tr>
                                        ) : admins.length === 0 ? (
                                            <tr><td colSpan={3} className="px-6 py-12 text-center text-slate-500">暫無管理員資料</td></tr>
                                        ) : admins.map((admin) => (
                                            <tr key={admin.username} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4 font-medium text-white">{admin.username}</td>
                                                <td className="px-6 py-4 text-slate-400">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${admin.role === 'super_admin' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/20' : 'bg-slate-500/20 text-slate-400 border border-slate-500/20'}`}>
                                                        {admin.role === 'super_admin' ? '超級管理員' : '普通管理員'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            onClick={() => {
                                                                setEditingAdmin(admin);
                                                                setAdminForm({ username: admin.username, password: '', role: admin.role });
                                                                setShowAdminModal(true);
                                                            }}
                                                            className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors"
                                                        >
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteAdmin(admin.username)}
                                                            className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Audit Logs */}
                    <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl shadow-xl overflow-hidden">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center text-white font-bold">
                            <div className="flex items-center gap-2">
                                <History size={20} className="text-cyan-400" /> 系統操作日誌 (Audit Logs)
                            </div>
                        </div>
                        <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
                            {loadingLogs ? (
                                <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-cyan-500" /></div>
                            ) : logs.length === 0 ? (
                                <div className="p-12 text-center text-slate-500 text-sm">暫無操作記錄</div>
                            ) : logs.map((log, i) => {
                                // 安全轉換函數：處理所有可能為物件的值
                                const safeString = (value: unknown): string => {
                                    if (value === null || value === undefined) return '';
                                    if (typeof value === 'object') return JSON.stringify(value);
                                    return String(value);
                                };

                                const actionDisplay = safeString(log.action);
                                const targetDisplay = safeString(log.target || log.targetText);
                                const adminDisplay = safeString(log.admin);
                                const detailsDisplay = safeString(log.details);

                                // 處理 timestamp
                                let timestampDisplay = '';
                                try {
                                    const ts = typeof log.timestamp === 'object'
                                        ? JSON.stringify(log.timestamp)
                                        : log.timestamp;
                                    timestampDisplay = new Date(parseInt(String(ts)) * 1000).toLocaleString();
                                } catch {
                                    timestampDisplay = String(log.timestamp || '');
                                }

                                return (
                                    <div key={i} className="p-4 hover:bg-white/5 transition-colors group">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <span className="text-cyan-400 text-xs font-mono font-bold">[{actionDisplay}]</span>
                                                <span className="text-white ml-2 text-sm">{targetDisplay}</span>
                                            </div>
                                            <span className="text-slate-500 text-[10px]">
                                                {timestampDisplay}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <p className="text-slate-400 text-[11px]">執行者: <span className="text-slate-300">{adminDisplay}</span></p>
                                        </div>
                                        {detailsDisplay && (
                                            <pre className="mt-2 p-2 bg-black/40 rounded border border-white/5 text-slate-500 text-[10px] overflow-x-auto">
                                                {detailsDisplay}
                                            </pre>
                                        )}
                                    </div>
                                );
                            }).reverse()}
                        </div>
                    </div>
                </div>
            </div>

            {/* Admin Modal */}
            {showAdminModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-white/10 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-white">{editingAdmin ? '編輯管理員' : '新增管理員'}</h3>
                            <button onClick={() => setShowAdminModal(false)} className="text-slate-400 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleAdminSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">管理員帳號</label>
                                <input
                                    required
                                    disabled={!!editingAdmin}
                                    className="w-full bg-slate-800 border border-white/5 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors disabled:opacity-50"
                                    value={adminForm.username}
                                    onChange={e => setAdminForm({ ...adminForm, username: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">{editingAdmin ? '重設密碼 (留空則不變)' : '設定密碼'}</label>
                                <input
                                    type="password"
                                    required={!editingAdmin}
                                    className="w-full bg-slate-800 border border-white/5 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                    value={adminForm.password}
                                    onChange={e => setAdminForm({ ...adminForm, password: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">角色權限</label>
                                <select
                                    className="w-full bg-slate-800 border border-white/5 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors appearance-none"
                                    value={adminForm.role}
                                    onChange={e => setAdminForm({ ...adminForm, role: e.target.value })}
                                >
                                    <option value="admin">普通管理員</option>
                                    <option value="super_admin">超級管理員</option>
                                </select>
                            </div>
                            <div className="pt-4">
                                <button type="submit" className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)]">
                                    {editingAdmin ? '儲存變更' : '立即創建'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Settings;

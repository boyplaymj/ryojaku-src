import React, { useState, useEffect } from 'react';
import { ShieldAlert, Trash2, UserX, CheckCircle, AlertCircle, Loader2, MessageCircle, Gamepad2, User } from 'lucide-react';
import { api } from '../services/api';

interface Report {
    id: string;
    type: 'post' | 'comment' | 'user';
    targetId: string;
    reporterId: string;
    reason: string;
    status: 'pending' | 'resolved' | 'dismissed';
    createdAt: string;
    content: string;
}

const Moderation: React.FC = () => {
    const [reports, setReports] = useState<Report[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    useEffect(() => {
        fetchReports();
    }, []);

    const fetchReports = async () => {
        setLoading(true);
        try {
            const data = await api.moderation.listReports();
            setReports(data || []);
        } catch (err: any) {
            setError(err.message || '無法獲取檢舉列表');
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async (reportId: string, action: string, targetId: string, type: string) => {
        if (!confirm(`確定要執行 "${action}" 操作嗎？`)) return;

        setActionLoading(reportId);
        try {
            await api.moderation.takeAction({ reportId, action, targetId, type });
            setReports(prev => prev.filter(r => r.id !== reportId));
        } catch (err: any) {
            alert(err.message || '操作失敗');
        } finally {
            setActionLoading(null);
        }
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'post': return <MessageCircle size={16} className="text-cyan-400" />;
            case 'comment': return <MessageCircle size={16} className="text-blue-400" />;
            case 'user': return <User size={16} className="text-purple-400" />;
            default: return <AlertCircle size={16} />;
        }
    };

    if (loading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="animate-spin text-cyan-500" size={48} />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
                        <ShieldAlert className="text-red-500" size={32} />
                        內容審核與檢舉管理
                    </h1>
                    <p className="text-slate-400 mt-2 text-sm md:text-base">處理用戶提交的檢舉，維護社群環境和用戶安全。</p>
                </div>
                <div className="bg-slate-900/50 px-4 py-2 rounded-xl border border-white/5 w-full sm:w-auto text-center">
                    <span className="text-slate-500 text-sm font-mono tracking-widest uppercase">待處理檢舉: </span>
                    <span className="text-red-500 font-bold ml-2">{reports.filter(r => r.status === 'pending').length}</span>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-red-400">
                    <AlertCircle size={20} />
                    <span className="flex-1">{error}</span>
                    <button onClick={fetchReports} className="underline text-sm shrink-0">重試</button>
                </div>
            )}

            <div className="grid grid-cols-1 gap-6">
                {reports.length === 0 ? (
                    <div className="bg-slate-900/40 border border-white/5 p-8 md:p-12 rounded-2xl text-center">
                        <CheckCircle className="mx-auto text-emerald-500 mb-4" size={48} />
                        <h3 className="text-xl font-bold text-white">社群環境良好</h3>
                        <p className="text-slate-500 mt-2">目前沒有需要處理的檢舉項目。</p>
                    </div>
                ) : (
                    reports.map(report => (
                        <div key={report.id} className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-4 md:p-6 hover:border-white/10 transition-all group">
                            <div className="flex flex-col lg:flex-row gap-6 items-start">
                                {/* Type Badge & Basic Info */}
                                <div className="flex lg:flex-col items-center gap-4 w-full lg:w-auto">
                                    <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center border border-white/10 group-hover:border-cyan-500/30 transition-colors shrink-0">
                                        {getTypeIcon(report.type)}
                                    </div>
                                    <div className="flex flex-col lg:items-center flex-1 lg:flex-none">
                                        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">{report.type}</span>
                                        <div className="lg:hidden text-slate-500 text-xs mt-1">
                                            {new Date(report.createdAt).toLocaleDateString()}
                                        </div>
                                    </div>
                                </div>

                                {/* Content Info */}
                                <div className="flex-1 space-y-4 w-full">
                                    <div className="flex justify-between items-start gap-4">
                                        <div>
                                            <h4 className="text-slate-400 text-[10px] font-mono uppercase tracking-widest mb-1">檢舉原因</h4>
                                            <p className="text-white font-bold text-base md:text-lg">{report.reason}</p>
                                        </div>
                                        <div className="text-right hidden sm:block">
                                            <h4 className="text-slate-400 text-[10px] font-mono uppercase tracking-widest mb-1">檢舉時間</h4>
                                            <p className="text-slate-500 text-sm">{new Date(report.createdAt).toLocaleString()}</p>
                                        </div>
                                    </div>

                                    <div className="bg-slate-950/50 rounded-xl p-4 border border-white/5">
                                        <h4 className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">違規內容預覽</h4>
                                        <div className="text-slate-300 text-sm leading-relaxed italic whitespace-pre-wrap break-all md:break-normal">
                                            "{report.content || '文字內容不存在或已被刪除'}"
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3 text-[10px] md:text-xs font-mono">
                                        <div className="flex items-center gap-2 px-3 py-1 bg-slate-800/50 rounded-full border border-white/5">
                                            <span className="text-slate-500">目標 ID:</span>
                                            <span className="text-cyan-400 break-all">{report.targetId}</span>
                                        </div>
                                        <div className="flex items-center gap-2 px-3 py-1 bg-slate-800/50 rounded-full border border-white/5">
                                            <span className="text-slate-500">檢舉者:</span>
                                            <span className="text-slate-300 font-bold break-all">{report.reporterId}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex flex-col sm:flex-row lg:flex-col gap-2 w-full lg:w-auto lg:shrink-0 pt-4 lg:pt-0 border-t lg:border-t-0 border-white/5">
                                    <button
                                        disabled={actionLoading === report.id}
                                        onClick={() => handleAction(report.id, 'dismiss', report.targetId, report.type)}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-all text-sm font-bold border border-white/5"
                                    >
                                        {actionLoading === report.id ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />}
                                        忽視並結案
                                    </button>
                                    <button
                                        disabled={actionLoading === report.id}
                                        onClick={() => handleAction(report.id, 'delete_content', report.targetId, report.type)}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all text-sm font-bold border border-red-500/20"
                                    >
                                        <Trash2 size={16} /> 刪除內容
                                    </button>
                                    <button
                                        disabled={actionLoading === report.id}
                                        onClick={() => handleAction(report.id, 'ban_user', report.targetId, 'user')}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-950 text-red-500 hover:bg-red-600 hover:text-white transition-all text-sm font-black border border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                                    >
                                        <UserX size={16} /> 封鎖發佈者
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default Moderation;

import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
    LayoutDashboard, Users, Smartphone, Ticket, Cog, LogOut, ChevronRight,
    BarChart3, MessageSquare, Gamepad2, Megaphone, ShieldAlert, Keyboard, MessageCircle,
    Menu, X, Shield, BookOpen, Gift
} from 'lucide-react';

interface NavItemProps {
    to: string;
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon, label, onClick }) => {
    const location = useLocation();
    const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

    return (
        <Link
            to={to}
            onClick={onClick}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group ${isActive
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                : 'text-slate-400 hover:bg-white/10 hover:text-white'
                }`}
        >
            <div className={`${isActive ? 'text-slate-950' : 'text-cyan-400 group-hover:scale-110'} transition-transform duration-300`}>
                {icon}
            </div>
            <span className="flex-1 text-sm">{label}</span>
            {isActive && <ChevronRight size={16} />}
        </Link>
    );
};

const AdminLayout: React.FC = () => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
    const isSuper = adminUser.role === 'super_admin';
    const location = useLocation();

    // Close mobile menu when route changes
    useEffect(() => {
        setIsMobileMenuOpen(false);
    }, [location.pathname]);

    const handleLogout = () => {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        window.location.href = '/login';
    };

    const SidebarContent = () => (
        <div className="flex flex-col h-full">
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                <div className="flex items-center justify-between mb-8 px-2">
                    <div className="group px-2">
                        <h2 className="text-2xl font-black tracking-tighter italic leading-none flex items-center gap-1">
                            <span className="text-transparent bg-clip-text bg-gradient-to-tr from-white via-cyan-300 to-blue-500 drop-shadow-[0_0_10px_rgba(6,182,212,0.4)]">
                                両雀
                            </span>
                            <span className="text-cyan-400 group-hover:text-white transition-colors duration-300">HUB</span>
                        </h2>
                        <p className="text-[10px] text-slate-500 font-bold tracking-[0.3em] uppercase mt-2 opacity-70">Management System</p>
                    </div>
                    <button
                        className="lg:hidden p-2 text-slate-400 hover:text-white"
                        onClick={() => setIsMobileMenuOpen(false)}
                    >
                        <X size={24} />
                    </button>
                </div>

                <nav className="space-y-6">
                    <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-3 px-4 opacity-50">核心數據</p>
                        <NavItem to="/" icon={<LayoutDashboard size={18} />} label="數據總覽" />
                    </div>

                    <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-3 px-4 opacity-50">數據分析</p>
                        <div className="space-y-1">
                            <NavItem to="/analysis/users" icon={<BarChart3 size={18} />} label="用戶深度分析" />
                            <NavItem to="/analysis/games" icon={<Gamepad2 size={18} />} label="團局深度分析" />
                            <NavItem to="/analysis/social" icon={<MessageSquare size={18} />} label="社群互動分析" />
                            <NavItem to="/analysis/chat" icon={<MessageCircle size={18} />} label="聊天室深度分析" />
                            <NavItem to="/analysis/ledger" icon={<BookOpen size={18} />} label="計帳次數深度分析" />
                            <NavItem to="/analysis/traffic" icon={<BarChart3 size={18} />} label="流量深度分析" />
                            <NavItem to="/analysis/token" icon={<Shield size={18} />} label="Token 使用分析" />
                            <NavItem to="/analysis/invite" icon={<Gift size={18} />} label="邀請碼成效分析" />
                        </div>
                    </div>

                    {/* 營運管理 - Accessible to all (some items restricted) */}
                    <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-3 px-4 opacity-50">營運管理</p>
                        <div className="space-y-1">
                            {isSuper && <NavItem to="/users" icon={<Users size={18} />} label="用戶名單管理" />}
                            {isSuper && <NavItem to="/moderation" icon={<ShieldAlert size={18} />} label="內容檢舉審核" />}

                            <NavItem to="/push" icon={<Megaphone size={18} />} label="全體推送通知" />

                            {isSuper && <NavItem to="/vouchers" icon={<Ticket size={18} />} label="序號管理" />}
                            {isSuper && <NavItem to="/activities" icon={<Gift size={18} />} label="行銷活動設定" />}
                            {isSuper && <NavItem to="/event-commands" icon={<Keyboard size={18} />} label="活動指令" />}
                            {isSuper && <NavItem to="/versions" icon={<Smartphone size={18} />} label="版端更新控制" />}
                        </div>
                    </div>

                    {isSuper && (
                        <div>
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-3 px-4 opacity-50">系統與安全</p>
                            <div className="space-y-1">
                                <NavItem to="/settings" icon={<Cog size={18} />} label="帳號與系統設置" />
                            </div>
                        </div>
                    )}
                </nav>
            </div>

            <div className="p-6 border-t border-white/5 bg-slate-950/30">
                <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all duration-300 font-bold border border-red-500/20 group text-sm"
                >
                    <LogOut size={16} className="group-hover:-translate-x-1 transition-transform" />
                    退出控制台
                </button>
            </div>
        </div>
    );

    return (
        <div className="flex h-screen bg-[#05060f] text-slate-200 overflow-hidden font-sans">
            {/* Desktop Sidebar */}
            <aside className="hidden lg:flex w-72 bg-slate-900/50 backdrop-blur-xl border-r border-white/5 flex-col shadow-2xl z-20">
                <SidebarContent />
            </aside>

            {/* Mobile Sidebar (Drawer) */}
            <aside className={`fixed inset-y-0 left-0 w-72 bg-slate-900 backdrop-blur-xl border-r border-white/5 flex flex-col shadow-2xl z-50 transition-transform duration-300 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:hidden`}>
                <SidebarContent />
            </aside>

            {/* Mobile Overlay */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Mobile Top Header */}
                <header className="lg:hidden h-16 flex items-center justify-between px-4 bg-slate-900/50 border-b border-white/5 backdrop-blur-md z-30">
                    <div className="flex items-center gap-1">
                        <h2 className="text-xl font-black tracking-tighter italic leading-none flex items-center gap-1">
                            <span className="text-transparent bg-clip-text bg-gradient-to-tr from-white via-cyan-300 to-blue-500 drop-shadow-[0_0_10px_rgba(6,182,212,0.4)]">
                                両雀
                            </span>
                            <span className="text-cyan-400">HUB</span>
                        </h2>
                    </div>
                    <button
                        onClick={() => setIsMobileMenuOpen(true)}
                        className="p-2 text-slate-400 hover:text-white"
                    >
                        <Menu size={24} />
                    </button>
                </header>

                <main className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-slate-900/40 via-[#05060f] to-[#05060f] relative custom-scrollbar">
                    {/* Background Decor */}
                    <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-cyan-500/5 blur-[120px] -z-10 pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/5 blur-[100px] -z-10 pointer-events-none" />

                    <div className="p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <div className="max-w-7xl mx-auto">
                            <Outlet />
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
};

export default AdminLayout;

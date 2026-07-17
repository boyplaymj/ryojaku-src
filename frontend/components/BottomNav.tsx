import { Home, Search, Plus, User as UserIcon, MessageCircle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useChat } from '../contexts/ChatContext';
import { User } from '../types';

interface BottomNavProps {
  user?: User | null;
}

const BottomNav: React.FC<BottomNavProps> = ({ user }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { totalUnreadCount } = useChat();

  const navItems = [
    { path: '/', icon: Home, label: '首頁' },
    { path: '/search', icon: Search, label: '找團' },
    { path: '/create', icon: Plus, label: '開局', special: true },
    { path: '/messages', icon: MessageCircle, label: '訊息', badge: totalUnreadCount },
    { path: '/profile', icon: UserIcon, label: '個人' },
  ];

  return (
    <div className="fixed bottom-0 left-0 w-full z-50 bg-white/90 backdrop-blur-xl border-t border-black/[0.05] pb-safe shadow-[0_-0.3125rem_1.25rem_rgba(0,0,0,0.02)] transition-all duration-300">
      <div className="flex justify-between items-center px-2 h-[3.75rem] relative w-full max-w-lg mx-auto">

        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          if (item.special) {
            return (
              <div key={item.path} className="relative flex justify-center w-1/5">
                <button
                  onClick={() => navigate(item.path)}
                  className="flex items-center justify-center w-11 h-11 bg-neutral-900 rounded-lg shadow-md active:scale-95 transition-all"
                >
                  <Plus size="1.5rem" className="text-white" strokeWidth={2.5} />
                </button>
              </div>
            );
          }

          const isProfile = item.path === '/profile';

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex flex-col items-center justify-center h-full w-1/5 transition-all relative group"
            >
              <div className={`relative p-1 transition-all duration-300 ${isActive ? 'text-[#c5a059]' : 'text-neutral-400 group-hover:text-neutral-600'}`}>
                {isProfile && user?.pictureUrl ? (
                  <div className={`w-7 h-7 rounded-full overflow-hidden border-2 transition-all duration-300 ${isActive ? 'border-[#c5a059]' : 'border-transparent group-hover:border-neutral-200'}`}>
                    <img src={user.pictureUrl} alt="Profile" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <Icon size="1.5rem" strokeWidth={isActive ? 2.2 : 1.8} />
                )}

                {/* Badge */}
                {(item.badge || 0) > 0 && (
                  <div className="absolute -top-1 -right-1 min-w-[1rem] h-4 bg-[#c5a059] rounded-full flex items-center justify-center border-2 border-white px-1 shadow-sm">
                    <span className="text-[0.5rem] font-bold text-white leading-none">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  </div>
                )}
              </div>
              <span className={`text-[0.625rem] font-medium mt-0.5 tracking-tight transition-all duration-300 ${isActive ? 'text-[#c5a059]' : 'text-neutral-400'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default BottomNav;
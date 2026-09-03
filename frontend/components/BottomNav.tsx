import { Users, FileText, Plus, User as UserIcon, MessageCircle, type LucideIcon } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useChat } from '../contexts/ChatContext';
import { User } from '../types';
import { BOTTOM_NAV_ITEMS, type BottomNavPath } from '../utils/bottomNavItems';

interface BottomNavProps {
  user?: User | null;
}

// 名單在 utils/bottomNavItems.ts（[A2-b-1]），這裡只放圖示對照。
// key 型別是名單裡 path 的聯集：名單多一格而這裡沒補圖示，typecheck 就紅。
const NAV_ICONS: Record<BottomNavPath, LucideIcon> = {
  '/': Users,
  '/ledger': FileText,
  '/create': Plus,
  '/messages': MessageCircle,
  '/profile': UserIcon,
};

const BottomNav: React.FC<BottomNavProps> = ({ user }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { totalUnreadCount } = useChat();

  return (
    <div className="fixed bottom-0 left-0 w-full z-50 bg-white/90 backdrop-blur-xl border-t border-black/[0.05] pb-safe shadow-[0_-0.3125rem_1.25rem_rgba(0,0,0,0.02)] transition-all duration-300">
      {/* 每格 flex-1 等分，不再寫死 w-1/5：格數由名單決定（validateBottomNavItems 守著奇數格） */}
      <div className="flex justify-between items-center px-2 h-[3.75rem] relative w-full max-w-lg mx-auto">

        {BOTTOM_NAV_ITEMS.map((item) => {
          // pathname 精確相等；不含 query，所以 `/?tab=find` 時揪咖格照樣亮。
          const isActive = location.pathname === item.path;
          const Icon = NAV_ICONS[item.path];
          const badge = 'unreadBadge' in item && item.unreadBadge ? totalUnreadCount : 0;

          if ('primary' in item && item.primary) {
            return (
              <div key={item.path} className="relative flex justify-center flex-1">
                <button
                  onClick={() => navigate(item.path)}
                  className="flex items-center justify-center w-11 h-11 bg-neutral-900 rounded-lg shadow-md active:scale-95 transition-all"
                >
                  <Icon size="1.5rem" className="text-white" strokeWidth={2.5} />
                </button>
              </div>
            );
          }

          const isProfile = item.path === '/profile';

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex flex-col items-center justify-center h-full flex-1 transition-all relative group"
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
                {badge > 0 && (
                  <div className="absolute -top-1 -right-1 min-w-[1rem] h-4 bg-[#c5a059] rounded-full flex items-center justify-center border-2 border-white px-1 shadow-sm">
                    <span className="text-[0.5rem] font-bold text-white leading-none">
                      {badge > 99 ? '99+' : badge}
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

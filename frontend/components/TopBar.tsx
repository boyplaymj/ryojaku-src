import React from 'react';
import { Bell, Sparkles, Menu, Battery, Wifi, Share2 } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import AppShareModal from './AppShareModal';

const TopBar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isShareModalOpen, setIsShareModalOpen] = React.useState(false);

  const getPageTitle = (path: string) => {
    if (path.startsWith('/event/')) return '戰術詳情';
    if (path.startsWith('/rate-game/')) return '戰績結算';

    switch (path) {
      case '/': return '社群動態';
      case '/search': return '尋找團局';
      case '/my-events': return '我的團局';
      case '/profile': return '個人檔案';
      case '/create': return '建立團局';
      case '/messages': return '聊天訊息';
      case '/notifications': return '通知中心';
      default: return '両雀';
    }
  };

  const title = getPageTitle(location.pathname);

  return (
    <>
      {/* Status Bar Placeholder for PWA - blends with TopBar */}
      <div className="sticky top-0 z-50 w-full bg-white/70 backdrop-blur-xl border-b border-black/[0.03] pt-safe transition-all duration-300">
        <div className="px-4 h-16 flex items-center justify-between relative overflow-hidden w-full">

          {/* Left: Title & Icon */}
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-9 h-9 flex items-center justify-center">
              <img src="/icon.png" alt="Icon" className="w-full h-full object-contain" />
            </div>

            <h1 className="text-lg font-semibold text-neutral-900 tracking-tight leading-none">
              {title}
            </h1>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1.5 relative z-10">
            <button
              onClick={() => setIsShareModalOpen(true)}
              className="w-10 h-10 rounded-lg bg-neutral-900 flex items-center justify-center text-[#c5a059] hover:bg-black shadow-sm border border-white/5 transition-all active:scale-90"
            >
              <Share2 size="1.125rem" strokeWidth={2.5} />
            </button>

            <button
              onClick={() => navigate('/notifications')}
              className="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-neutral-400 hover:text-neutral-900 shadow-sm border border-black/[0.03] transition-all relative active:scale-90"
            >
              <Bell size="1.125rem" strokeWidth={2.5} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-[#c5a059] rounded-full border-2 border-white shadow-sm"></span>
            </button>
          </div>
        </div>
      </div>

      <AppShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
      />
    </>
  );
};

export default TopBar;
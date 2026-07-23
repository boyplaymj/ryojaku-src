import React, { useState, useEffect, useCallback } from 'react';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import BottomNav from './components/BottomNav';
import TopBar from './components/TopBar';
import PullToRefresh from './components/PullToRefresh';
import Home from './pages/Home';
import SearchPage from './pages/Search';
import CreateGroup from './pages/CreateGroup';
import EventDetail from './pages/EventDetail';
import PostDetail from './pages/PostDetail';
import Profile from './pages/Profile';
import Messages from './pages/ChatList';
import ChatRoom from './pages/ChatRoom';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import Notifications from './pages/Notifications';
import RateGame from './pages/RateGame';

import RateUser from './pages/RateUser';
import Ledger from './pages/Ledger';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import { GroupEvent, User } from './types';
import DailyBonusModal from './components/DailyBonusModal';
import { useDailyBonus } from './hooks/useDailyBonus';
import VersionGuard from './components/VersionGuard';
import { api } from './services/dataService';
import { authService } from './services/authService';
import { Loader2 } from 'lucide-react';
import { RefreshProvider, useRefresh, usePullToRefresh } from './contexts/RefreshContext';
import { ChatProvider } from './contexts/ChatContext';
import { ToastProvider } from './contexts/ToastContext';
import { chatService } from './services/chatService';
import { notificationService } from './services/notificationService';

const Layout: React.FC<{ children: React.ReactNode; user: User | null }> = ({ children, user }) => {
  const location = useLocation();
  const { onRefresh } = useRefresh();

  // Routes that should have the main navigation shell (TopBar + BottomNav)
  const mainNavRoutes = ['/', '/search', '/messages', '/profile', '/create', '/notifications', '/ledger'];
  const showNav = mainNavRoutes.includes(location.pathname) ||
    location.pathname.startsWith('/rate-game/') ||
    location.pathname.startsWith('/reviews/') ||
    location.pathname.startsWith('/event/') ||
    location.pathname.startsWith('/ledger');

  return (
    <div className="relative min-h-screen w-full bg-[#f9f9f7]">

      {/* Global Ambient Effects - Minimal Lux style */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#f9f9f7]">
      </div>

      {/* Fixed Top Bar (Only on main routes) */}
      {showNav && <TopBar />}

      {/* Content Container - Adjust padding based on Nav presence */}
      {/* pb-16 (4rem) matches bottom nav height (3.75rem) + minimal safe space */}
      <div className={`relative z-10 flex flex-col ${showNav ? 'pb-16' : ''}`}>
        <PullToRefresh onRefresh={onRefresh}>
          {children}
        </PullToRefresh>
      </div>

      {/* Fixed Bottom Nav */}
      {showNav && <BottomNav user={user} />}
    </div>
  );
};

// Wrapper for Home to handle refresh registration
const HomeRoute: React.FC<{ events: GroupEvent[]; user: User | null; onUserUpdate: (user: User) => void }> = ({ events, user, onUserUpdate }) => {
  return <Home events={events} user={user} onUserUpdate={onUserUpdate} />;
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [minRequiredVersion, setMinRequiredVersion] = useState('1.0.0');
  const [invitePoints, setInvitePoints] = useState({ inviter: '100', invitee: '50' });

  // Daily Bonus Hook
  const { showModal: showBonusModal, setShowModal: setShowBonusModal, bonusData, checkAndClaimBonus } = useDailyBonus(user);

  const checkVersion = useCallback(async () => {
    try {
      const response = await api.getVersionConfig();
      if (response.success && response.minRequiredVersion) {
        setMinRequiredVersion(response.minRequiredVersion);
        if (response.inviterPoints && response.inviteePoints) {
          setInvitePoints({
            inviter: response.inviterPoints,
            invitee: response.inviteePoints
          });
        }
      }
    } catch (err) {
      console.error("Failed to check version", err);
    }
  }, []);

  useEffect(() => {
    const currentUser = authService.getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
      chatService.connect(currentUser.userId);
    }
    // Check version and daily bonus on initial load
    checkVersion();
    if (currentUser) checkAndClaimBonus();

    setIsAuthChecking(false);

    // Add visibility change listener to check version when app comes to foreground
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('App: Coming to foreground, checking status...');
        checkVersion();
        checkAndClaimBonus();
      }
    };

    // Add focus listener as a fallback
    const handleFocus = () => {
      console.log('App: Window focused, checking status...');
      checkVersion();
      checkAndClaimBonus();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      chatService.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkVersion, checkAndClaimBonus]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    console.log('App: fetchData called');
    try {
      // Refresh user profile using getUserInfo to get latest real-time stats
      const userIdentifier = user.userId;
      const profileResponse = await api.getUserInfo(userIdentifier);
      if (profileResponse.success && profileResponse.data) {
        // Use functional update to avoid closure issues and loop
        setUser(prevUser => {
          if (!prevUser) return profileResponse.data;
          const updatedUser = { ...prevUser, ...profileResponse.data };
          localStorage.setItem('mahjongclub_user_session', JSON.stringify(updatedUser));
          return updatedUser;
        });
        console.log('App: User profile refreshed with real-time stats');
      }

      // Fetch events
      const data = await api.getEvents();
      console.log('App: Events fetched', data.length);
      setEvents(data);
    } catch (err) {
      console.error("Failed to fetch data", err);
    } finally {
      setIsDataLoading(false);
    }
  }, [user?.userId]);

  useEffect(() => {
    fetchData();

    // 🚀 靜默恢復推播訂閱 (Silent Resubscribe)
    const resubscribePush = async () => {
      if (user && user.hasClaimedPushBonus && notificationService.isPushSupported()) {
        const permission = notificationService.getPermissionState();
        if (permission === 'granted') {
          console.log('[Push] Silent resubscribing for user:', user.userId);
          try {
            await notificationService.subscribe();
            console.log('[Push] Silent resubscribe successful');
          } catch (err) {
            console.warn('[Push] Silent resubscribe failed:', err);
          }
        }
      }
    };

    if (user) {
      resubscribePush();
    }
  }, [fetchData, user?.userId]);

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    chatService.connect(loggedInUser.userId);
  };

  const handleLogout = async () => {
    await authService.logout();
    setUser(null);
    setEvents([]);
  };

  const handleUserUpdate = (updatedUser: User) => {
    setUser(updatedUser);
  };

  const handleCreateGame = async (payload: any) => {
    try {
      const userIdentifier = user?.userId || '';
      const response = await api.createGame(userIdentifier, payload);

      if (response.success) {
        console.log('Game created successfully:', response.data);
        // Refresh events
        await fetchData();
      } else {
        console.error('Failed to create game:', response.error);
      }

      return response;
    } catch (error) {
      console.error('Error creating game:', error);
      return { success: false, error: '網路連線錯誤，請稍後再試' };
    }
  };

  const handleJoinEvent = async (id: string) => {
    try {
      await api.joinEvent(id);
      // Refresh events list after joining
      await fetchData();
    } catch (e) {
      console.error("Join failed", e);
      throw e; // Re-throw to let EventDetail handle the error
    }
  };

  const renderContent = () => {
    if (isAuthChecking) return null;

    if (!user) {
      // pre-auth 頁（從信裡的連結進入，免登入）：#/reset?token / #/verify?token / #/forgot
      const hash = window.location.hash || '';
      const preAuth = hash.startsWith('#/reset') ? <ResetPassword />
        : hash.startsWith('#/verify') ? <VerifyEmail />
        : hash.startsWith('#/forgot') ? <ForgotPassword />
        : null;
      return (
        <div className="mx-auto w-full bg-transparent min-h-screen shadow-2xl relative overflow-hidden">
          {preAuth || <Login onLoginSuccess={handleLoginSuccess} inviteePoints={invitePoints.invitee} />}
        </div>
      );
    }

    if (isDataLoading) {
      return (
        <div className="flex h-screen w-full items-center justify-center bg-transparent mx-auto shadow-2xl">
          <Loader2 className="animate-spin text-cyber-cyan" size={40} />
        </div>
      )
    }

    return (
      <Router>
        <RefreshProvider>
          <ChatProvider>
            <Layout user={user}>
              <Routes>
                <Route path="/" element={<HomeRoute events={events} user={user} onUserUpdate={handleUserUpdate} />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/chat/:roomId" element={<ChatRoom />} />
                <Route path="/create" element={<CreateGroup onCreate={handleCreateGame} user={user} />} />
                <Route path="/event/:id" element={<EventDetail events={events} onJoin={handleJoinEvent} user={user} />} />
                <Route path="/post/:id" element={<PostDetail user={user} />} />
                <Route path="/profile" element={<Profile user={user} onLogout={handleLogout} onUserUpdate={handleUserUpdate} inviterPoints={invitePoints.inviter} />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/rate-game/:id" element={<RateGame />} />

                <Route path="/rate-user" element={<RateUser />} />
                <Route path="/ledger" element={<Ledger />} />
              </Routes>
              {/* Daily Bonus Modal Overlay */}
              <DailyBonusModal
                isOpen={showBonusModal}
                onClose={() => {
                  setShowBonusModal(false);
                  fetchData(); // Refresh user points
                }}
                bonusData={bonusData}
              />
            </Layout>
          </ChatProvider>
        </RefreshProvider>
      </Router>
    );
  };

  return (
    <PWAInstallPrompt>
      <VersionGuard minVersion={minRequiredVersion} />
      <ToastProvider>
        {renderContent()}
      </ToastProvider>
    </PWAInstallPrompt>
  );
}

export default App;
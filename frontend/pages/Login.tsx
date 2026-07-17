import React, { useState } from 'react';
import { authService } from '../services/authService';
import { User } from '../types';
import { Loader2, ArrowRight, Sparkles, Mail, Lock, UserPlus, User as UserIcon, QrCode } from 'lucide-react';
import { AppInput, AppButton } from '../components/ui/CommonUI';
import { useToast } from '../contexts/ToastContext';

interface LoginProps {
  onLoginSuccess: (user: User) => void;
  inviteePoints?: string;
}

type LoginMode = 'email' | 'register';

const Login: React.FC<LoginProps> = ({ onLoginSuccess, inviteePoints = '50' }) => {
  const [mode, setMode] = useState<LoginMode>('email');

  // Email/Password login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register
  const [registerData, setRegisterData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    displayName: '',
    inviteCode: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
    if (params.get('expired') === 'true') {
      showToast('連線已過期或在其他裝置登入，請重新登入以繼續使用', 'warning');
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash.split('?')[0]);
    }
  }, []);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const user = await authService.loginWithEmail(email, password);
      onLoginSuccess(user);
    } catch (error) {
      console.error('Login failed', error);
      showToast(error instanceof Error ? error.message : '登入失敗，請檢查 Email 和密碼', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (registerData.password !== registerData.confirmPassword) {
      showToast('密碼不一致', 'warning');
      setIsLoading(false);
      return;
    }

    try {
      const user = await authService.register({
        email: registerData.email,
        password: registerData.password,
        displayName: registerData.displayName,
        inviteCode: registerData.inviteCode,
      });
      onLoginSuccess(user);
    } catch (error) {
      console.error('Register failed', error);
      showToast(error instanceof Error ? error.message : '註冊失敗', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-[#f0f0eb] flex flex-col relative overflow-y-auto overflow-x-hidden">
      {/* Option B: Mahjong Table Background */}
      <div className="absolute inset-0 z-0 pointer-events-none mahjong-table"></div>

      <div className="relative z-10 flex-1 flex flex-col pt-safe px-6 pb-12 mt-10">
        {/* Header Section */}
        <div className="flex-none flex flex-col items-center justify-center pb-8">
          {/* Icon - Floating & Borderless */}
          <div className="relative mb-6 animate-icon-entrance">
            <div className="absolute inset-0 bg-white/40 rounded-full blur-2xl animate-pulse scale-150"></div>
            <div className="relative w-20 h-20 animate-float-gentle">
              <img src="/icon.png" alt="両雀 Logo" className="w-full h-full object-contain drop-shadow-2xl" />
            </div>
          </div>

          <div className="text-center animate-reveal-title" style={{ animationDelay: '0.2s' }}>
            <h1 className="flex items-center justify-center gap-3 mb-2">
              <span className="text-5xl font-black tracking-tighter text-neutral-900">両雀</span>
            </h1>
            <div className="flex items-center justify-center gap-2">
              <span className="h-[0.0625rem] w-4 bg-[#c5a059]/30"></span>
              <p className="text-neutral-400 font-black tracking-[0.6em] text-[0.5625rem] uppercase">
                Elite Community
              </p>
              <span className="h-[0.0625rem] w-4 bg-[#c5a059]/30"></span>
            </div>
          </div>
        </div>

        {/* Flipping Tile Container */}
        <div className="flex-none w-full max-w-[23.75rem] mx-auto tile-flip-container">
          <div className={`tile-flip-inner ${mode === 'register' ? 'tile-flip-active' : ''}`}>

            {/* Front Side: Login Tile */}
            <div className={`tile-front transition-all duration-300 ease-in-out ${mode === 'email' ? 'relative opacity-100 z-10' : 'absolute top-0 left-0 w-full opacity-0 z-0 pointer-events-none'}`}>
              <div className="tactile-tile rounded-lg bg-white p-7 h-fit flex flex-col">


                {/* Prominent Mode Toggle */}
                <div className="flex p-1 bg-neutral-100 rounded-lg mb-8 relative border border-black/[0.03]">
                  <div
                    className={`absolute inset-1 w-[calc(50%-0.25rem)] bg-neutral-900 rounded-md transition-all duration-500 shadow-xl shadow-black/20 ${mode === 'register' ? 'translate-x-[calc(100%)]' : 'translate-x-0'}`}
                  ></div>
                  <button
                    type="button"
                    onClick={() => setMode('email')}
                    className={`flex-1 py-3 relative z-10 text-[0.6875rem] font-black tracking-widest transition-colors duration-500 ${mode === 'email' ? 'text-[#c5a059]' : 'text-neutral-400'}`}
                  >
                    登入系統
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('register')}
                    className={`flex-1 py-3 relative z-10 text-[0.6875rem] font-black tracking-widest transition-colors duration-500 ${mode === 'register' ? 'text-[#c5a059]' : 'text-neutral-400'}`}
                  >
                    前往註冊
                  </button>
                </div>


                <form onSubmit={handleEmailLogin} className="space-y-6">
                  <div className="space-y-1.5">
                    <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">Email</label>
                    <AppInput
                      type="email"
                      placeholder="your@email.com"
                      icon={Mail}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="bg-neutral-50/50"
                    />
                  </div>

                  <div className="space-y-1.5 relative">
                    <div className="flex items-center justify-between ml-1 pr-1">
                      <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest">Password</label>
                    </div>
                    <AppInput
                      type="password"
                      placeholder="••••••••"
                      icon={Lock}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="bg-neutral-50/50"
                    />
                  </div>

                  <div className="pt-4">
                    <AppButton
                      type="submit"
                      isLoading={isLoading}
                      disabled={!email || !password}
                      icon={ArrowRight}
                      className="w-full h-14 bg-neutral-900 text-[#c5a059] hover:bg-black rounded-lg shadow-xl"
                    >
                      通行證核准
                    </AppButton>
                  </div>
                </form>
              </div>
            </div>

            {/* Back Side: Register Tile */}
            <div className={`tile-back transition-all duration-300 ease-in-out ${mode === 'register' ? 'relative opacity-100 z-10' : 'absolute top-0 left-0 w-full opacity-0 z-0 pointer-events-none'}`}>
              <div className="tactile-tile rounded-lg bg-white p-7 h-fit flex flex-col">


                {/* Prominent Mode Toggle */}
                <div className="flex p-1 bg-neutral-100 rounded-lg mb-8 relative border border-black/[0.03]">
                  <div
                    className={`absolute inset-1 w-[calc(50%-0.25rem)] bg-neutral-900 rounded-md transition-all duration-500 shadow-xl shadow-black/20 ${mode === 'register' ? 'translate-x-[calc(100%)]' : 'translate-x-0'}`}
                  ></div>
                  <button
                    type="button"
                    onClick={() => setMode('email')}
                    className={`flex-1 py-3 relative z-10 text-[0.6875rem] font-black tracking-widest transition-colors duration-500 ${mode === 'email' ? 'text-[#c5a059]' : 'text-neutral-400'}`}
                  >
                    登入系統
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('register')}
                    className={`flex-1 py-3 relative z-10 text-[0.6875rem] font-black tracking-widest transition-colors duration-500 ${mode === 'register' ? 'text-[#c5a059]' : 'text-neutral-400'}`}
                  >
                    前往註冊
                  </button>
                </div>


                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">Nickname</label>
                    <AppInput
                      placeholder="顯示名稱"
                      icon={UserIcon}
                      value={registerData.displayName}
                      onChange={(e) => setRegisterData({ ...registerData, displayName: e.target.value })}
                      required
                      className="bg-neutral-50/50"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">Email</label>
                    <AppInput
                      type="email"
                      placeholder="contact@lux.com"
                      icon={Mail}
                      value={registerData.email}
                      onChange={(e) => setRegisterData({ ...registerData, email: e.target.value })}
                      required
                      className="bg-neutral-50/50"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">Password</label>
                    <AppInput
                      type="password"
                      placeholder="密碼"
                      icon={Lock}
                      value={registerData.password}
                      onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                      required
                      className="bg-neutral-50/50"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">Confirm Password</label>
                    <AppInput
                      type="password"
                      placeholder="再次確認密碼"
                      icon={Lock}
                      value={registerData.confirmPassword}
                      onChange={(e) => setRegisterData({ ...registerData, confirmPassword: e.target.value })}
                      required
                      className="bg-neutral-50/50"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">Invite Code</label>
                    <AppInput
                      placeholder="邀請碼 (選填)"
                      icon={QrCode}
                      value={registerData.inviteCode}
                      onChange={(e) => setRegisterData({ ...registerData, inviteCode: e.target.value })}
                      className="bg-neutral-50/50"
                    />
                  </div>

                  <div className="pt-2">
                    <AppButton
                      type="submit"
                      variant="primary"
                      isLoading={isLoading}
                      disabled={!registerData.email || !registerData.password || !registerData.displayName}
                      icon={Sparkles}
                      className="w-full h-14 bg-neutral-900 text-[#c5a059] hover:bg-black rounded-lg"
                    >
                      完成註冊
                    </AppButton>
                  </div>
                </form>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};

export default Login;
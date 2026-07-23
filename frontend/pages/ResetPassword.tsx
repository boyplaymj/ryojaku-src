import React, { useState } from 'react';
import { authService } from '../services/authService';
import { Lock, KeyRound, CheckCircle2, ArrowLeft, AlertTriangle } from 'lucide-react';
import { AppInput, AppButton } from '../components/ui/CommonUI';
import { useToast } from '../contexts/ToastContext';

const ResetPassword: React.FC = () => {
  const [token] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
    return params.get('token');
  });

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { showToast } = useToast();

  const goToLogin = () => {
    window.location.hash = '#/';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (newPassword.length < 8) {
      showToast('新密碼長度至少需 8 碼', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('兩次輸入的密碼不一致', 'warning');
      return;
    }

    setIsLoading(true);
    try {
      await authService.resetPassword(token, newPassword);
      setDone(true);
    } catch (error) {
      console.error('Reset password failed', error);
      showToast(error instanceof Error ? error.message : '密碼重設失敗，請稍後再試', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-[#f0f0eb] flex flex-col relative overflow-y-auto overflow-x-hidden">
      <div className="absolute inset-0 z-0 pointer-events-none mahjong-table"></div>

      <div className="relative z-10 flex-1 flex flex-col pt-safe px-6 pb-12 mt-10">
        {/* Header Section */}
        <div className="flex-none flex flex-col items-center justify-center pb-8">
          <div className="relative mb-6 animate-icon-entrance">
            <div className="absolute inset-0 bg-white/40 rounded-full blur-2xl animate-pulse scale-150"></div>
            <div className="relative w-20 h-20 animate-float-gentle">
              <img src="/icon.png" alt="両雀 Logo" className="w-full h-full object-contain drop-shadow-2xl" />
            </div>
          </div>

          <div className="text-center animate-reveal-title" style={{ animationDelay: '0.2s' }}>
            <h1 className="flex items-center justify-center gap-3 mb-2">
              <span className="text-3xl font-black tracking-tighter text-neutral-900">重設密碼</span>
            </h1>
            <div className="flex items-center justify-center gap-2">
              <span className="h-[0.0625rem] w-4 bg-[#c5a059]/30"></span>
              <p className="text-neutral-400 font-black tracking-[0.6em] text-[0.5625rem] uppercase">
                Reset Password
              </p>
              <span className="h-[0.0625rem] w-4 bg-[#c5a059]/30"></span>
            </div>
          </div>
        </div>

        <div className="flex-none w-full max-w-[23.75rem] mx-auto">
          <div className="tactile-tile rounded-lg bg-white p-7 h-fit flex flex-col">
            {!token ? (
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-red-500 mb-5">
                  <AlertTriangle size="1.5rem" strokeWidth={2.5} />
                </div>
                <h2 className="text-[0.9375rem] font-black text-neutral-900 mb-2 tracking-tight">連結無效</h2>
                <p className="text-[0.75rem] font-bold text-neutral-400 leading-relaxed mb-6">
                  此重設連結無效或不完整，請重新申請密碼重設。
                </p>
                <AppButton
                  type="button"
                  onClick={goToLogin}
                  icon={ArrowLeft}
                  className="w-full h-14 bg-neutral-900 text-[#c5a059] hover:bg-black rounded-lg shadow-xl"
                >
                  返回登入
                </AppButton>
              </div>
            ) : done ? (
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-full bg-[#c5a059]/10 flex items-center justify-center text-[#c5a059] mb-5">
                  <CheckCircle2 size="1.5rem" strokeWidth={2.5} />
                </div>
                <h2 className="text-[0.9375rem] font-black text-neutral-900 mb-2 tracking-tight">密碼已重設</h2>
                <p className="text-[0.75rem] font-bold text-neutral-400 leading-relaxed mb-6">
                  密碼已重設，請用新密碼登入。
                </p>
                <AppButton
                  type="button"
                  onClick={goToLogin}
                  icon={ArrowLeft}
                  className="w-full h-14 bg-neutral-900 text-[#c5a059] hover:bg-black rounded-lg shadow-xl"
                >
                  返回登入
                </AppButton>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <p className="text-[0.75rem] font-bold text-neutral-400 leading-relaxed">
                  請設定新密碼（長度至少 8 碼）。
                </p>

                <div className="space-y-1.5">
                  <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">New Password</label>
                  <AppInput
                    type="password"
                    placeholder="新密碼（至少 8 碼）"
                    icon={Lock}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="bg-neutral-50/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">Confirm New Password</label>
                  <AppInput
                    type="password"
                    placeholder="再次輸入新密碼"
                    icon={Lock}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="bg-neutral-50/50"
                  />
                </div>

                <div className="pt-2">
                  <AppButton
                    type="submit"
                    isLoading={isLoading}
                    disabled={!newPassword || !confirmPassword}
                    icon={KeyRound}
                    className="w-full h-14 bg-neutral-900 text-[#c5a059] hover:bg-black rounded-lg shadow-xl"
                  >
                    重設密碼
                  </AppButton>
                </div>

                <button
                  type="button"
                  onClick={goToLogin}
                  className="w-full flex items-center justify-center gap-1.5 text-[0.6875rem] font-black text-neutral-400 hover:text-neutral-900 uppercase tracking-widest transition-colors py-1"
                >
                  <ArrowLeft size="0.875rem" strokeWidth={2.5} />
                  返回登入
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;

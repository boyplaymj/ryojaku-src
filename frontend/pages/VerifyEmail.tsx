import React, { useState, useEffect } from 'react';
import { authService } from '../services/authService';
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { AppButton } from '../components/ui/CommonUI';

type VerifyState = 'verifying' | 'success' | 'error';

const VerifyEmail: React.FC = () => {
  const [state, setState] = useState<VerifyState>('verifying');

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
    const token = params.get('token');

    if (!token) {
      setState('error');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await authService.verifyEmail(token);
        if (!cancelled) setState('success');
      } catch (error) {
        console.error('Email verification failed', error);
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const goToLogin = () => {
    window.location.hash = '#/';
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
              <span className="text-3xl font-black tracking-tighter text-neutral-900">信箱驗證</span>
            </h1>
            <div className="flex items-center justify-center gap-2">
              <span className="h-[0.0625rem] w-4 bg-[#c5a059]/30"></span>
              <p className="text-neutral-400 font-black tracking-[0.6em] text-[0.5625rem] uppercase">
                Email Verification
              </p>
              <span className="h-[0.0625rem] w-4 bg-[#c5a059]/30"></span>
            </div>
          </div>
        </div>

        <div className="flex-none w-full max-w-[23.75rem] mx-auto">
          <div className="tactile-tile rounded-lg bg-white p-7 h-fit flex flex-col">
            {state === 'verifying' && (
              <div className="flex flex-col items-center text-center py-8">
                <Loader2 size="2rem" strokeWidth={2.5} className="animate-spin text-[#c5a059] mb-5" />
                <h2 className="text-[0.9375rem] font-black text-neutral-900 mb-2 tracking-tight">驗證中</h2>
                <p className="text-[0.75rem] font-bold text-neutral-400 leading-relaxed">
                  正在驗證你的信箱，請稍候…
                </p>
              </div>
            )}

            {state === 'success' && (
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-full bg-[#c5a059]/10 flex items-center justify-center text-[#c5a059] mb-5">
                  <CheckCircle2 size="1.5rem" strokeWidth={2.5} />
                </div>
                <h2 className="text-[0.9375rem] font-black text-neutral-900 mb-2 tracking-tight">信箱驗證成功！</h2>
                <p className="text-[0.75rem] font-bold text-neutral-400 leading-relaxed mb-6">
                  你的信箱已完成驗證，現在可以登入使用完整功能。
                </p>
                <AppButton
                  type="button"
                  onClick={goToLogin}
                  icon={ArrowRight}
                  className="w-full h-14 bg-neutral-900 text-[#c5a059] hover:bg-black rounded-lg shadow-xl"
                >
                  前往登入
                </AppButton>
              </div>
            )}

            {state === 'error' && (
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-red-500 mb-5">
                  <AlertTriangle size="1.5rem" strokeWidth={2.5} />
                </div>
                <h2 className="text-[0.9375rem] font-black text-neutral-900 mb-2 tracking-tight">驗證失敗</h2>
                <p className="text-[0.75rem] font-bold text-neutral-400 leading-relaxed mb-6">
                  驗證失敗，連結可能已過期或已使用。
                </p>
                <AppButton
                  type="button"
                  onClick={goToLogin}
                  icon={ArrowRight}
                  className="w-full h-14 bg-neutral-900 text-[#c5a059] hover:bg-black rounded-lg shadow-xl"
                >
                  前往登入
                </AppButton>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;

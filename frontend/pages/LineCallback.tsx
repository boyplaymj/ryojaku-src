import React, { useState, useEffect, useRef } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { AppButton } from '../components/ui/CommonUI';
import { authService } from '../services/authService';
import { consumeLineCallback, startLineLogin } from '../services/lineLogin';
import { User } from '../types';

type CbState = 'working' | 'success' | 'error';

interface Props {
  onLoggedIn: (user: User) => void;
}

// LINE 授權後的落點頁（<origin>/auth/line/callback?code=…&state=…）。
//
// ⚠️ 這一頁是**整頁跳轉**回來的，不是 SPA 內部導航 —— 整個 JS 環境是重新啟動的，
//    所以流程狀態只能從 sessionStorage 撈（見 services/lineLogin.ts）。
const LineCallback: React.FC<Props> = ({ onLoggedIn }) => {
  const [state, setState] = useState<CbState>('working');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'login' | 'bind'>('login');
  // 🔴 React 18 StrictMode 在開發模式會把 effect 跑兩次。這裡若跑兩次，
  //    第二次會拿已經被後端燒掉的 nonce 去換 → 固定 401，看起來像後端壞了。
  //    用 ref 擋住（不能用 state：state 更新是非同步的，擋不住同一輪的第二次呼叫）。
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    (async () => {
      try {
        const cb = consumeLineCallback();
        if (!cancelled) setMode(cb.mode);

        if (cb.mode === 'bind') {
          await authService.bindLine(cb.code, cb.redirectUri, cb.nonce);
          if (cancelled) return;
          setState('success');
          setMessage('已把 LINE 綁定到你的帳號。');
        } else {
          const user = await authService.loginWithLine(cb.code, cb.redirectUri, cb.nonce);
          if (cancelled) return;
          onLoggedIn(user);
          setState('success');
          setMessage('LINE 登入成功。');
        }
      } catch (e) {
        if (cancelled) return;
        setState('error');
        setMessage(e instanceof Error ? e.message : 'LINE 登入失敗，請重新試一次。');
      }
    })();

    return () => { cancelled = true; };
  }, [onLoggedIn]);

  // 回到 app。用 replace 把帶著 code 的網址從歷史紀錄裡換掉 ——
  // 否則使用者按上一頁會重送同一個 code，而那顆 nonce 早就燒掉了，固定 401。
  const goHome = () => { window.location.replace(`${window.location.origin}/#/`); };

  // 重試一律從頭：重新取 nonce、重跑授權。不可以重送舊的 code/nonce。
  const retry = async () => {
    try {
      setState('working');
      await startLineLogin(mode);
    } catch (e) {
      setState('error');
      setMessage(e instanceof Error ? e.message : '無法重新開始 LINE 登入');
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-[#f0f0eb] flex flex-col relative overflow-y-auto overflow-x-hidden">
      <div className="absolute inset-0 z-0 pointer-events-none mahjong-table"></div>

      <div className="relative z-10 flex-1 flex flex-col pt-safe px-6 pb-12 mt-10">
        <div className="flex-none flex flex-col items-center justify-center pb-8">
          <div className="relative mb-6 animate-icon-entrance">
            <div className="absolute inset-0 bg-white/40 rounded-full blur-2xl animate-pulse scale-150"></div>
            <div className="relative w-20 h-20 animate-float-gentle">
              <img src="/icon.png" alt="両雀 Logo" className="w-full h-full object-contain drop-shadow-2xl" />
            </div>
          </div>

          <div className="text-center animate-reveal-title" style={{ animationDelay: '0.2s' }}>
            <h1 className="flex items-center justify-center gap-3 mb-2">
              <span className="text-3xl font-black tracking-tighter text-neutral-900">
                {mode === 'bind' ? 'LINE 綁定' : 'LINE 登入'}
              </span>
            </h1>
            <div className="flex items-center justify-center gap-2">
              <span className="h-[0.0625rem] w-4 bg-[#c5a059]/30"></span>
              <p className="text-neutral-400 font-black tracking-[0.6em] text-[0.5625rem] uppercase">
                LINE Login
              </p>
              <span className="h-[0.0625rem] w-4 bg-[#c5a059]/30"></span>
            </div>
          </div>
        </div>

        <div className="flex-none w-full max-w-[23.75rem] mx-auto">
          <div className="tactile-tile rounded-lg bg-white p-7 h-fit flex flex-col">
            {state === 'working' && (
              <div className="flex flex-col items-center text-center py-8">
                <Loader2 size="2rem" strokeWidth={2.5} className="animate-spin text-[#c5a059] mb-5" />
                <h2 className="text-[0.9375rem] font-black text-neutral-900 mb-2 tracking-tight">處理中</h2>
                <p className="text-[0.75rem] font-bold text-neutral-400 leading-relaxed">
                  正在完成 LINE 驗證，請稍候…
                </p>
              </div>
            )}

            {state === 'success' && (
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-full bg-[#c5a059]/10 flex items-center justify-center text-[#c5a059] mb-5">
                  <CheckCircle2 size="1.5rem" strokeWidth={2.5} />
                </div>
                <h2 className="text-[0.9375rem] font-black text-neutral-900 mb-2 tracking-tight">完成</h2>
                <p className="text-[0.75rem] font-bold text-neutral-400 leading-relaxed mb-6">{message}</p>
                <AppButton
                  type="button"
                  onClick={goHome}
                  icon={ArrowRight}
                  className="w-full h-14 bg-neutral-900 text-[#c5a059] hover:bg-black rounded-lg shadow-xl"
                >
                  進入両雀
                </AppButton>
              </div>
            )}

            {state === 'error' && (
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-red-500 mb-5">
                  <AlertTriangle size="1.5rem" strokeWidth={2.5} />
                </div>
                <h2 className="text-[0.9375rem] font-black text-neutral-900 mb-2 tracking-tight">
                  {mode === 'bind' ? '綁定失敗' : '登入失敗'}
                </h2>
                <p className="text-[0.75rem] font-bold text-neutral-400 leading-relaxed mb-6">{message}</p>
                <div className="w-full space-y-3">
                  <AppButton
                    type="button"
                    onClick={retry}
                    className="w-full h-14 bg-neutral-900 text-[#c5a059] hover:bg-black rounded-lg shadow-xl"
                  >
                    重新用 LINE 登入
                  </AppButton>
                  <button
                    type="button"
                    onClick={goHome}
                    className="w-full h-12 text-[0.75rem] font-black text-neutral-400 hover:text-neutral-600 tracking-tight"
                  >
                    改用其他方式
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LineCallback;

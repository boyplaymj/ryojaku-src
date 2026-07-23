import React, { useState, useRef, useEffect } from 'react';
import { authService } from '../services/authService';
import { useToast } from '../contexts/ToastContext';
import { AppButton } from './ui/CommonUI';
import { isGoogleConfigured, renderGoogleButton } from '../services/googleSignIn';
import { Link2 } from 'lucide-react';

// 帳號系統 P5 — 綁定/解綁 Google 登入方式（登入後設定用）。
// 綁定走 GIS 官方按鈕 → bindGoogle；解綁 → unbindProvider('google')。
// 未設 VITE_GOOGLE_CLIENT_ID 時整張卡不顯示。
const GoogleLinkCard: React.FC = () => {
  const { showToast } = useToast();
  const btnRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const configured = isGoogleConfigured();

  useEffect(() => {
    if (!configured || !btnRef.current) return;
    renderGoogleButton(
      btnRef.current,
      async (idToken) => {
        try {
          setBusy(true);
          await authService.bindGoogle(idToken);
          showToast('已綁定 Google 帳號', 'success');
        } catch (err) {
          showToast(err instanceof Error ? err.message : '綁定失敗', 'error');
        } finally {
          setBusy(false);
        }
      },
      (e) => showToast(e.message, 'error'),
    );
  }, [configured]);

  const handleUnbind = async () => {
    try {
      setBusy(true);
      await authService.unbindProvider('google');
      showToast('已解綁 Google 帳號', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '解綁失敗', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!configured) return null;

  return (
    <div className="bg-white p-5 rounded-lg border border-black/[0.04] shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-4 bg-[#c5a059] rounded-full" />
        <h3 className="text-sm font-black text-neutral-800 tracking-wide">第三方登入</h3>
      </div>
      <p className="text-xs text-neutral-500 mb-4 leading-relaxed flex items-center gap-1.5">
        <Link2 size={14} /> 綁定 Google 後，可用 Google 一鍵登入這個帳號。
      </p>
      <div ref={btnRef} className="flex justify-center mb-3" />
      <AppButton variant="ghost" onClick={handleUnbind} isLoading={busy} className="w-full text-xs">
        解綁 Google
      </AppButton>
    </div>
  );
};

export default GoogleLinkCard;

import React, { useState } from 'react';
import { authService } from '../services/authService';
import { Lock, KeyRound, LogOut, Trash2 } from 'lucide-react';
import { AppInput, AppButton } from './ui/CommonUI';
import { useToast } from '../contexts/ToastContext';
import CyberpunkConfirmModal from './CyberpunkConfirmModal';
import { ACCOUNT_DELETION_GRACE_DAYS } from '../utils/accountDeletion';

interface AccountSecurityProps {
  /** 刪除提出成功之後呼叫。後端已經把這台裝置的 JWT 作廢，這裡要接上本機登出。 */
  onAccountDeletionRequested?: () => void;
}

const AccountSecurity: React.FC<AccountSecurityProps> = ({ onAccountDeletionRequested }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChanging, setIsChanging] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { showToast } = useToast();

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      showToast('新密碼長度至少需 8 碼', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('兩次輸入的新密碼不一致', 'warning');
      return;
    }

    setIsChanging(true);
    try {
      await authService.changePassword(currentPassword, newPassword);
      showToast('密碼已更新', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('Change password failed', error);
      showToast(error instanceof Error ? error.message : '密碼更新失敗', 'error');
    } finally {
      setIsChanging(false);
    }
  };

  const handleLogoutAllDevices = async () => {
    setIsLoggingOut(true);
    try {
      await authService.logoutAllDevices();
      showToast('已登出其他裝置', 'success');
    } catch (error) {
      console.error('Logout all devices failed', error);
      showToast(error instanceof Error ? error.message : '登出其他裝置失敗', 'error');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleRequestDeletion = async () => {
    setIsDeleting(true);
    try {
      await authService.requestAccountDeletion();
      setShowDeleteConfirm(false);
      showToast(`帳號已停用，${ACCOUNT_DELETION_GRACE_DAYS} 天內重新登入可以取消刪除`, 'success');
      onAccountDeletionRequested?.();
    } catch (error) {
      console.error('Request account deletion failed', error);
      showToast(error instanceof Error ? error.message : '刪除帳號失敗', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Change Password Card */}
      <div className="bg-white p-5 rounded-lg border border-black/[0.04] shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
          <h3 className="text-[0.625rem] font-black text-neutral-900 uppercase tracking-widest">變更密碼</h3>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">Current Password</label>
            <AppInput
              type="password"
              placeholder="目前密碼"
              icon={Lock}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="bg-neutral-50/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">New Password</label>
            <AppInput
              type="password"
              placeholder="新密碼（至少 8 碼）"
              icon={KeyRound}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="bg-neutral-50/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">Confirm New Password</label>
            <AppInput
              type="password"
              placeholder="再次輸入新密碼"
              icon={KeyRound}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="bg-neutral-50/50"
            />
          </div>

          <div className="pt-1">
            <AppButton
              type="submit"
              isLoading={isChanging}
              disabled={!currentPassword || !newPassword || !confirmPassword}
              className="w-full"
            >
              更新密碼
            </AppButton>
          </div>
        </form>
      </div>

      {/* Logout Other Devices Card */}
      <div className="bg-white p-5 rounded-lg border border-black/[0.04] shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
          <h3 className="text-[0.625rem] font-black text-neutral-900 uppercase tracking-widest">裝置安全</h3>
        </div>

        <p className="text-[0.6875rem] font-bold text-neutral-400 leading-relaxed mb-4">
          若懷疑帳號在其他裝置被使用，可登出所有其他裝置，僅保留目前這台。
        </p>

        <AppButton
          type="button"
          variant="danger"
          isLoading={isLoggingOut}
          onClick={handleLogoutAllDevices}
          icon={LogOut}
          className="w-full"
        >
          登出其他裝置
        </AppButton>
      </div>

      {/* Delete Account Card —— 內容與公開的刪除頁（legal/delete-account.txt）是同一份承諾 */}
      <div className="bg-white p-5 rounded-lg border border-black/[0.04] shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-3 bg-red-400 rounded-full"></div>
          <h3 className="text-[0.625rem] font-black text-neutral-900 uppercase tracking-widest">刪除帳號</h3>
        </div>

        <p className="text-[0.6875rem] font-bold text-neutral-400 leading-relaxed mb-4">
          提出後帳號會立即停用並登出所有裝置。{ACCOUNT_DELETION_GRACE_DAYS} 天內重新登入可以取消；期滿後個人資料會被清除，無法復原。
        </p>

        <AppButton
          type="button"
          variant="danger"
          onClick={() => setShowDeleteConfirm(true)}
          icon={Trash2}
          className="w-full"
        >
          刪除帳號
        </AppButton>
      </div>

      <CyberpunkConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleRequestDeletion}
        title="刪除帳號"
        message={`確定要刪除帳號嗎？帳號會立即停用，${ACCOUNT_DELETION_GRACE_DAYS} 天後清除個人資料、點數與記帳紀錄，清除後無法復原。`}
        confirmText="確定刪除"
        cancelText="先不要"
        loading={isDeleting}
      />
    </div>
  );
};

export default AccountSecurity;

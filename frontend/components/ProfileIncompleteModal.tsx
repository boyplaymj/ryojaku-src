/**
 * 個人資料不完整提示 Modal
 * 在使用者嘗試創建團局或報名時，若個人資料不完整，顯示友善的提示並引導使用者前往填寫
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertTriangle, User, ChevronRight, X } from 'lucide-react';
import { AppButton } from './ui/CommonUI';

interface ProfileIncompleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    missingFields: string[];
    onSaveDraft?: () => void;  // 儲存草稿的回調
}

const ProfileIncompleteModal: React.FC<ProfileIncompleteModalProps> = ({
    isOpen,
    onClose,
    missingFields,
    onSaveDraft,
}) => {
    const navigate = useNavigate();
    const location = useLocation();

    if (!isOpen) return null;

    // 處理前往個人資料頁
    const handleGoToProfile = () => {
        // 先儲存草稿（如果有提供回調）
        onSaveDraft?.();

        // 跳轉到個人資料頁，帶上 returnUrl 參數
        const returnPath = location.pathname;
        navigate(`/profile?returnUrl=${encodeURIComponent(returnPath)}&edit=true`);
        onClose();
    };

    // 處理稍後再說
    const handleLater = () => {
        onClose();
    };

    const modalContent = (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            {/* 背景遮罩 - 高端磨砂效果 */}
            <div
                className="absolute inset-0 bg-neutral-900/10 backdrop-blur-[0.375rem] animate-fade-in"
                onClick={handleLater}
            />

            {/* Modal 內容 - 緊湊 Lux 設計 */}
            <div className="relative bg-white/95 backdrop-blur-2xl border border-white rounded-2xl p-6 max-w-sm w-full shadow-[0_1.25rem_3.125rem_rgba(0,0,0,0.1)] animate-in zoom-in-95 duration-300">
                {/* 右上角關閉按鈕 */}
                <button
                    onClick={handleLater}
                    className="absolute top-5 right-5 w-8 h-8 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-300 hover:text-neutral-900 transition-all active:scale-90"
                >
                    <X size={16} strokeWidth={2.5} />
                </button>

                {/* 圖示帶裝飾 - 縮小間距 */}
                <div className="flex justify-center mb-4">
                    <div className="relative">
                        <div className="absolute inset-0 bg-[#c5a059]/10 blur-xl rounded-full scale-125"></div>
                        <div className="relative w-14 h-14 rounded-xl bg-[#c5a059]/5 border border-[#c5a059]/10 flex items-center justify-center shadow-inner">
                            <AlertTriangle size={28} className="text-[#c5a059]" strokeWidth={2.5} />
                        </div>
                    </div>
                </div>

                {/* 標題與說明 - 緊湊排列 */}
                <div className="text-center mb-5">
                    <div className="flex items-center justify-center gap-2 mb-1.5">
                        <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                        <span className="text-[0.5625rem] font-black text-[#c5a059] uppercase tracking-[0.4em]">Profile Status</span>
                    </div>
                    <h3 className="text-lg font-black text-neutral-900 mb-1">
                        完善個人資料
                    </h3>
                    <p className="text-[0.75rem] text-neutral-400 font-medium">
                        為了維護社群品質，請先完成必填資訊
                    </p>
                </div>

                {/* 缺少欄位列表 - 更加緊湊 */}
                <div className="bg-neutral-50 rounded-xl p-4 mb-6 border border-black/[0.02]">
                    <div className="flex items-center gap-2 text-neutral-400 text-[0.5625rem] font-black uppercase tracking-widest mb-3">
                        <User size={12} strokeWidth={3} />
                        <span>缺少的資料</span>
                    </div>
                    <ul className="grid grid-cols-2 gap-2">
                        {missingFields.map((field, index) => (
                            <li
                                key={index}
                                className="flex items-center gap-2 text-neutral-600 text-[0.75rem] font-bold"
                            >
                                <div className="w-1 h-1 rounded-full bg-[#c5a059]" />
                                {field}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* 按鈕區 */}
                <div className="space-y-2">
                    <AppButton
                        onClick={handleGoToProfile}
                        className="w-full h-[2.75rem]"
                        icon={ChevronRight}
                    >
                        前往填寫
                    </AppButton>

                    <button
                        onClick={handleLater}
                        className="w-full py-2 text-[0.6875rem] font-black text-neutral-300 uppercase tracking-widest hover:text-neutral-900 transition-colors"
                    >
                        稍後再說
                    </button>
                </div>

                {/* 底部裝飾線 */}
                <div className="mt-4 pt-3 border-t border-black/[0.01] text-center">
                    <p className="text-[0.5rem] font-black text-neutral-200 uppercase tracking-[0.5em]">
                        REI IDENTITY VERIFICATION
                    </p>
                </div>
            </div>
        </div>
    );

    // 使用 Portal 渲染到 body，確保 z-index 正確
    return createPortal(modalContent, document.body);
};

export default ProfileIncompleteModal;

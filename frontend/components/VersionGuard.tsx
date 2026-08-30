import React, { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from '../constants';
import { evaluateVersionGate } from '../utils/versionGate';

interface VersionGuardProps {
    minVersion: string;
    /** 後台設定的更新出口（商店連結）。原生 App 沒有它就沒有出路，理由見 utils/versionGate.ts。 */
    updateUrl?: string | null;
}

const VersionGuard: React.FC<VersionGuardProps> = ({ minVersion, updateUrl }) => {
    const isNative = Capacitor.isNativePlatform();
    const gate = evaluateVersionGate({
        currentVersion: APP_VERSION,
        minVersion,
        isNative,
        updateUrl,
    });

    useEffect(() => {
        if (gate.suppressedReason === 'no-exit') {
            // 版本確實過舊，但這台裝置拿不到可用的更新出口。硬擋下去就是一塊按不掉的磚，
            // 所以刻意放行 —— 要修的是後台的 updateUrl 設定，不是這個元件。
            console.error(
                `[VersionGuard] ${APP_VERSION} < ${minVersion}，但 updateUrl 不可用（${String(updateUrl)}），`
                + '為避免使用者被鎖死而放行。請到後台「版本與系統管理」設定商店連結。'
            );
        }
    }, [gate.suppressedReason, minVersion, updateUrl]);

    if (!gate.blocked) {
        return null;
    }

    const handleUpdate = () => {
        if (gate.action.kind === 'store') {
            // 原生 App：站外連結由 Capacitor 交給系統瀏覽器／商店 App。
            // 這裡**不可以**退回 reload —— APK/IPA 內的 bundle 重載幾次 APP_VERSION 都不會變。
            const opened = window.open(gate.action.url, '_blank');
            if (!opened) {
                window.location.href = gate.action.url;
            }
            return;
        }

        // 網頁／PWA：重新載入才會真的換到新 bundle，順便催 service worker 更新。
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                for (let registration of registrations) {
                    registration.update();
                }
            });
        }
        window.location.reload();
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            color: '#00f2ff',
            textAlign: 'center',
            padding: '1.25rem',
            fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
        }}>
            <div style={{
                backgroundColor: '#0a0a0c',
                padding: '1.875rem',
                borderRadius: '1rem',
                border: '0.0625rem solid #00f2ff',
                boxShadow: '0 0 1.25rem rgba(0, 242, 255, 0.3)',
                maxWidth: '25rem'
            }}>
                <h2 style={{ marginBottom: '1.25rem', fontSize: '1.5rem', textTransform: 'uppercase', letterSpacing: '0.125rem' }}>
                    發現新版本
                </h2>
                <p style={{ marginBottom: '1.875rem', color: '#fff', fontSize: '1rem', lineHeight: '1.6' }}>
                    系統已有重大更新，請點擊下方按鈕更新以繼續使用「両雀」。
                    <br />
                    <span style={{ fontSize: '0.75rem', color: '#888' }}>
                        目前版本: {APP_VERSION} ➔ 需求版本: {minVersion}
                    </span>
                </p>
                <button
                    onClick={handleUpdate}
                    style={{
                        backgroundColor: '#00f2ff',
                        color: '#000',
                        border: 'none',
                        padding: '0.75rem 1.875rem',
                        borderRadius: '0.5rem',
                        fontSize: '1.125rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        transition: 'transform 0.2s',
                        boxShadow: '0 0 0.625rem rgba(0, 242, 255, 0.5)'
                    }}
                    onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                    onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    {gate.action.kind === 'store' ? '前往商店更新' : '立即更新'}
                </button>
            </div>
        </div>
    );
};

export default VersionGuard;

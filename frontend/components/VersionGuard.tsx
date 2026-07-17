import React from 'react';
import { APP_VERSION } from '../constants';

interface VersionGuardProps {
    minVersion: string;
}

const VersionGuard: React.FC<VersionGuardProps> = ({ minVersion }) => {
    const isOutdated = (current: string, required: string) => {
        const currParts = current.split('.').map(Number);
        const reqParts = required.split('.').map(Number);

        for (let i = 0; i < Math.max(currParts.length, reqParts.length); i++) {
            const curr = currParts[i] || 0;
            const req = reqParts[i] || 0;
            if (curr < req) return true;
            if (curr > req) return false;
        }
        return false;
    };

    if (!isOutdated(APP_VERSION, minVersion)) {
        return null;
    }

    const handleUpdate = () => {
        // Refresh the page and force clear cache
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
                    立即更新
                </button>
            </div>
        </div>
    );
};

export default VersionGuard;

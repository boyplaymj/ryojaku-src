import React, { useState, useEffect, useCallback } from 'react';
import { Smartphone, Monitor, Share, PlusSquare, Menu, Download, ArrowDown, X, Compass, Chrome } from 'lucide-react';

interface PWAInstallPromptProps {
    children: React.ReactNode;
}

const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({ children }) => {
    const [isMobile, setIsMobile] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [isAndroid, setIsAndroid] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);
    const [isSafari, setIsSafari] = useState(false);
    const [isChrome, setIsChrome] = useState(false);
    const [isInApp, setIsInApp] = useState(false);
    const [showGuide, setShowGuide] = useState<'ios' | 'android' | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);

        // Check User Agent
        const userAgent = window.navigator.userAgent.toLowerCase();
        const isIpad = /macintosh/.test(userAgent) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1;

        const mobile = /iphone|ipad|ipod|android|blackberry|windows phone/g.test(userAgent) || isIpad;
        const ios = /iphone|ipad|ipod/.test(userAgent) || isIpad;
        const android = /android/.test(userAgent);

        // Specific Browser Detection
        const isLine = /line/i.test(userAgent);
        const isFb = /fbav|fb_iab/i.test(userAgent);
        const isMessenger = /messenger/i.test(userAgent);
        const inApp = isLine || isFb || isMessenger;

        const safari = ios && /safari/i.test(userAgent) && !/crios/i.test(userAgent) && !/fxios/i.test(userAgent) && !inApp;
        const chrome = android && /chrome/i.test(userAgent) && !/samsungbrowser/i.test(userAgent) && !inApp;

        setIsMobile(mobile);
        setIsIOS(ios);
        setIsAndroid(android);
        setIsSafari(safari);
        setIsChrome(chrome);
        setIsInApp(inApp);

        // Check Standalone Mode
        const checkStandalone = () => {
            const isStandaloneMode =
                window.matchMedia('(display-mode: standalone)').matches ||
                (window.navigator as any).standalone === true ||
                document.referrer.includes('android-app://');

            setIsStandalone(isStandaloneMode);
        };

        checkStandalone();
        window.addEventListener('resize', checkStandalone); // Sometimes orientation change triggers it? Unlikely but safe.

        return () => window.removeEventListener('resize', checkStandalone);
    }, []);

    // Developer Bypass
    const [devBypass, setDevBypass] = useState(false);

    if (!mounted) return null;

    // If installed or bypassed, show app
    if (isStandalone || devBypass) {
        return <>{children}</>;
    }

    // PC View
    if (!isMobile) {
        return (
            <div className="min-h-screen bg-[#050b14] flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
                {/* Cyberpunk Background */}
                <div className="absolute inset-0 cyber-grid opacity-20"></div>
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyber-cyan to-transparent"></div>

                <div className="relative z-10 max-w-md w-full bg-[#0f172a]/80 backdrop-blur-xl border border-cyber-cyan/30 rounded-lg p-8 shadow-[0_0_3.125rem_rgba(6,182,212,0.15)]">
                    <div className="w-20 h-20 mx-auto bg-slate-900 rounded-full flex items-center justify-center border border-cyber-cyan/50 mb-6 shadow-[0_0_1.25rem_rgba(6,182,212,0.3)]">
                        <Smartphone size="2.5rem" className="text-cyber-cyan animate-pulse" />
                    </div>

                    <h1 className="text-2xl font-bold text-white mb-2 tracking-wider">MOBILE ACCESS ONLY</h1>
                    <p className="text-slate-400 mb-8 font-mono text-sm">
                        此應用程式專為行動裝置設計。<br />請使用手機開啟以獲得最佳體驗。
                    </p>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <button
                            onClick={() => setShowGuide('ios')}
                            className={`p-4 rounded-lg border transition-all duration-300 flex flex-col items-center gap-2 ${showGuide === 'ios'
                                ? 'bg-cyber-cyan/20 border-cyber-cyan text-white shadow-[0_0_0.9375rem_rgba(6,182,212,0.3)]'
                                : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-cyber-cyan/50 hover:text-cyber-cyan'
                                }`}
                        >
                            <div className="font-bold">iOS</div>
                            <div className="text-[0.625rem] opacity-70">INSTALL GUIDE</div>
                        </button>
                        <button
                            onClick={() => setShowGuide('android')}
                            className={`p-4 rounded-lg border transition-all duration-300 flex flex-col items-center gap-2 ${showGuide === 'android'
                                ? 'bg-cyber-pink/20 border-cyber-pink text-white shadow-[0_0_0.9375rem_rgba(236,72,153,0.3)]'
                                : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-cyber-pink/50 hover:text-cyber-pink'
                                }`}
                        >
                            <div className="font-bold">Android</div>
                            <div className="text-[0.625rem] opacity-70">INSTALL GUIDE</div>
                        </button>
                    </div>

                    {showGuide === 'ios' && (
                        <div className="bg-slate-900/80 rounded-lg p-4 text-left border-l-2 border-cyber-cyan animate-in fade-in slide-in-from-top-2">
                            <h3 className="text-cyber-cyan font-bold mb-2 flex items-center gap-2">
                                <Compass size="1rem" /> iOS 安裝教學 (推薦使用 Safari)
                            </h3>
                            <ol className="text-sm text-slate-300 space-y-2 list-decimal list-inside font-mono">
                                <li>使用 Safari 開啟此網頁</li>
                                <li>點擊底部的「分享」按鈕</li>
                                <li>選擇「加入主畫面」</li>
                                <li>點擊右上角的「新增」</li>
                            </ol>
                        </div>
                    )}

                    {showGuide === 'android' && (
                        <div className="bg-slate-900/80 rounded-lg p-4 text-left border-l-2 border-cyber-pink animate-in fade-in slide-in-from-top-2">
                            <h3 className="text-cyber-pink font-bold mb-2 flex items-center gap-2">
                                <Chrome size="1rem" /> Android 安裝教學 (推薦使用 Chrome)
                            </h3>
                            <ol className="text-sm text-slate-300 space-y-2 list-decimal list-inside font-mono">
                                <li>使用 Chrome 開啟此網頁</li>
                                <li>點擊右上角的選單圖示</li>
                                <li>選擇「安裝應用程式」或「加到主畫面」</li>
                                <li>點擊「安裝」確認</li>
                            </ol>
                        </div>
                    )}

                    {import.meta.env.DEV && (
                        <button
                            onClick={() => setDevBypass(true)}
                            className="mt-8 text-[0.625rem] text-slate-600 hover:text-slate-400 font-mono border-b border-transparent hover:border-slate-400 transition-colors"
                        >
                            [DEV MODE] BYPASS CHECK
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // Mobile Install Prompt (iOS)
    if (isIOS) {
        return (
            <div className="fixed inset-0 bg-[#050b14] z-50 flex flex-col">
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                    <div className="w-24 h-24 bg-slate-900 rounded-lg flex items-center justify-center border border-cyber-cyan/30 mb-8 shadow-[0_0_1.875rem_rgba(6,182,212,0.2)]">
                        {!isSafari ? (
                            <Compass size="3rem" className="text-cyber-cyan animate-pulse" />
                        ) : (
                            <Download size="3rem" className="text-cyber-cyan animate-bounce" />
                        )}
                    </div>

                    <h1 className="text-2xl font-bold text-white mb-4">
                        {!isSafari ? '請使用 Safari 開啟' : '需安裝 APP'}
                    </h1>

                    <p className="text-slate-400 mb-8 leading-relaxed">
                        {!isSafari ? (
                            <>
                                偵測到您目前使用的瀏覽器可能不支援安裝。<br />
                                請點擊右上角或分享按鈕，選擇<span className="text-cyber-cyan font-bold">「在 Safari 中開啟」</span>。
                            </>
                        ) : (
                            <>
                                為了提供最佳體驗，請先將此網頁加入主畫面。<br />
                                <span className="text-cyber-cyan font-mono text-sm mt-2 block">RECOMMENDED: SAFARI BROWSER</span>
                            </>
                        )}
                    </p>

                    {isSafari && (
                        <div className="w-full max-w-xs bg-slate-900/50 rounded-lg p-4 border border-white/10 backdrop-blur-sm">
                            <div className="flex items-center gap-3 mb-3 text-left">
                                <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center text-blue-400">
                                    <Share size="1.125rem" />
                                </div>
                                <span className="text-sm text-slate-300">1. 點擊下方工具列的<span className="text-white font-bold">「分享」</span>按鈕</span>
                            </div>
                            <div className="w-full h-[0.0625rem] bg-white/5 mb-3"></div>
                            <div className="flex items-center gap-3 text-left">
                                <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center text-white">
                                    <PlusSquare size="1.125rem" />
                                </div>
                                <span className="text-sm text-slate-300">2. 選擇<span className="text-white font-bold">「加入主畫面」</span></span>
                            </div>
                        </div>
                    )}
                </div>

                {isSafari && (
                    <div className="pb-8 pt-4 flex justify-center animate-bounce">
                        <ArrowDown size="2rem" className="text-cyber-cyan" />
                    </div>
                )}

                {import.meta.env.DEV && (
                    <button
                        onClick={() => setDevBypass(true)}
                        className="absolute top-4 right-4 text-[0.625rem] text-slate-600 p-2"
                    >
                        DEV BYPASS
                    </button>
                )}
            </div>
        );
    }

    // Mobile Install Prompt (Android)
    if (isAndroid) {
        return (
            <div className="fixed inset-0 bg-[#050b14] z-50 flex flex-col">
                <div className="absolute top-4 right-4 animate-bounce">
                    <ArrowDown size="2rem" className="text-cyber-pink rotate-180" />
                </div>

                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                    <div className="w-24 h-24 bg-slate-900 rounded-lg flex items-center justify-center border border-cyber-pink/30 mb-8 shadow-[0_0_1.875rem_rgba(236,72,153,0.2)]">
                        {!isChrome ? (
                            <Chrome size="3rem" className="text-cyber-pink animate-pulse" />
                        ) : (
                            <Download size="3rem" className="text-cyber-pink animate-bounce" />
                        )}
                    </div>

                    <h1 className="text-2xl font-bold text-white mb-4">
                        {!isChrome ? '請使用 Chrome 開啟' : '需安裝 APP'}
                    </h1>

                    <p className="text-slate-400 mb-8 leading-relaxed">
                        {!isChrome ? (
                            <>
                                偵測到您目前使用的瀏覽器可能不支援安裝。<br />
                                請點擊右上角選單，選擇<span className="text-cyber-pink font-bold">「在 Chrome 中開啟」</span>。
                            </>
                        ) : (
                            <>
                                為了提供最佳體驗，請先將此網頁加入主畫面。<br />
                                <span className="text-cyber-pink font-mono text-sm mt-2 block">RECOMMENDED: CHROME BROWSER</span>
                            </>
                        )}
                    </p>

                    {isChrome && (
                        <div className="w-full max-w-xs bg-slate-900/50 rounded-lg p-4 border border-white/10 backdrop-blur-sm">
                            <div className="flex items-center gap-3 mb-3 text-left">
                                <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center text-slate-300">
                                    <Menu size="1.125rem" />
                                </div>
                                <span className="text-sm text-slate-300">1. 點擊瀏覽器右上角的<span className="text-white font-bold">「選單」</span></span>
                            </div>
                            <div className="w-full h-[0.0625rem] bg-white/5 mb-3"></div>
                            <div className="flex items-center gap-3 text-left">
                                <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center text-cyber-pink">
                                    <Download size="1.125rem" />
                                </div>
                                <span className="text-sm text-slate-300">2. 選擇<span className="text-white font-bold">「安裝應用程式」</span>或「加到主畫面」</span>
                            </div>
                        </div>
                    )}
                </div>

                {import.meta.env.DEV && (
                    <button
                        onClick={() => setDevBypass(true)}
                        className="absolute bottom-4 left-4 text-[0.625rem] text-slate-600 p-2"
                    >
                        DEV BYPASS
                    </button>
                )}
            </div>
        );
    }

    // Fallback for other mobile devices (treat as generic mobile)
    return (
        <div className="fixed inset-0 bg-[#050b14] z-50 flex flex-col items-center justify-center p-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-4">INSTALLATION REQUIRED</h1>
            <p className="text-slate-400">Please add this app to your home screen to continue.</p>
            {import.meta.env.DEV && (
                <button onClick={() => setDevBypass(true)} className="mt-8 text-xs text-slate-600">DEV BYPASS</button>
            )}
        </div>
    );
};

export default PWAInstallPrompt;

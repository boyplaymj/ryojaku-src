// 帳號系統 P5 — Google Identity Services (GIS) 封裝。
// 用官方「Sign in with Google」credential 流程：renderButton → callback 收到 ID token(credential)。
// ID token 交後端 shared.VerifyGoogleIDToken 驗證。client_id 由 VITE_GOOGLE_CLIENT_ID 提供。

const GIS_SRC = 'https://accounts.google.com/gsi/client';

export const GOOGLE_CLIENT_ID: string = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';

let scriptPromise: Promise<void> | null = null;

// 動態載入 GIS script（只載一次）。
export function loadGoogleScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if ((window as any).google?.accounts?.id) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('無法載入 Google 登入元件'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

// 是否已設定 client_id（未設時前端不顯示 Google 鈕）。
export function isGoogleConfigured(): boolean {
  return !!GOOGLE_CLIENT_ID;
}

// 在指定容器渲染官方 Google 按鈕；使用者完成後 callback 收到 ID token。
// theme/大小走預設；容器寬度由父層控制（GIS 會自適應）。
export async function renderGoogleButton(
  container: HTMLElement,
  onCredential: (idToken: string) => void,
  onError?: (e: Error) => void,
): Promise<void> {
  if (!GOOGLE_CLIENT_ID) {
    onError?.(new Error('尚未設定 Google 登入（缺 VITE_GOOGLE_CLIENT_ID）'));
    return;
  }
  try {
    await loadGoogleScript();
    const google = (window as any).google;
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (resp: any) => {
        if (resp?.credential) onCredential(resp.credential);
        else onError?.(new Error('Google 登入未取得憑證'));
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    container.innerHTML = '';
    google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      logo_alignment: 'left',
      width: container.clientWidth || 320,
    });
  } catch (e: any) {
    onError?.(e instanceof Error ? e : new Error(String(e)));
  }
}

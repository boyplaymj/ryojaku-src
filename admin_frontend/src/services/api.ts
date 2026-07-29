// P3（設計冊 D2、§5.3）：原本這裡有三個位址 —— 主 API、序號 API(另一座 API Gateway)、
// event-commands(Lambda URL, AuthType=NONE)。後兩者走的 requestExternal() **完全不送
// Authorization**，等於序號產生與活動指令是無驗證的公開端點。
// 現已把 /redeem-codes/* 與 /event-commands/* 一併併入我方主 REST API 並掛上 admin authorizer，
// 故三個位址收斂為一個、requestExternal() 整個移除。
// P4（決策 D1）：位址改由 build 時的環境變數注入，同一份原始碼可切 staging／prod。
//
// **刻意不給預設值**。原本寫死的是工程師的 prod（`yg7y0xkb50`）—— 若在這裡留成 fallback，
// 一次漏設 mode 的 build 就會產生「看起來正常、實際打到別人正式環境」的 bundle，
// 而且從畫面上完全看不出來。寧可 build 完一開啟就整頁報錯，也不要靜默打錯環境。
const rawBaseUrl = import.meta.env.VITE_API_BASE_URL;
if (!rawBaseUrl) {
    throw new Error(
        'VITE_API_BASE_URL 未設定 —— build 請走 deploy.sh（它會注入位址），本機開發請見 .env.example。'
    );
}
// 結尾斜線會讓 BASE_URL + '/admin/...' 串出 '//admin/...'，API Gateway 視為不同路徑而 403。
export const BASE_URL = rawBaseUrl.replace(/\/+$/, '');

const handleUnauthorized = () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    window.location.href = '/login';
};

const request = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('adminToken');
    if (!token && !url.includes('/admin/login')) {
        handleUnauthorized();
        throw new Error('No token found');
    }

    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers,
    };

    const res = await fetch(`${url.startsWith('http') ? url : BASE_URL + url}`, { ...options, headers });

    if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Session expired');
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
};

// 下載序號 CSV 專用：後端直接把 CSV 當 body 回傳，不是 JSON，故不能走 request()。
// 也不能用 window.open() —— 新分頁沒辦法帶 Authorization header，端點補上驗證後會 401。
// 改為帶 token fetch 成 blob，再用暫時性的 <a download> 觸發下載。
const requestBlob = async (url: string, filename: string) => {
    const token = localStorage.getItem('adminToken');
    if (!token) {
        handleUnauthorized();
        throw new Error('No token found');
    }

    const res = await fetch(BASE_URL + url, { headers: { 'Authorization': `Bearer ${token}` } });

    if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Session expired');
    }
    if (!res.ok) throw new Error('Download failed');

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
};

export const api = {
    auth: {
        login: async (username: string, password: string) => {
            return request('/admin/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
        }
    },
    dashboard: {
        getStats: async () => {
            const res = await request('/admin/stats');
            return res.data;
        }
    },
    users: {
        list: async (params?: { userId?: string, displayName?: string, lastKey?: string }) => {
            let url = '/admin/users';
            if (params) {
                const query = new URLSearchParams();
                if (params.userId) query.append('userId', params.userId);
                if (params.displayName) query.append('displayName', params.displayName);
                if (params.lastKey) query.append('lastKey', params.lastKey);
                const queryString = query.toString();
                if (queryString) url += `?${queryString}`;
            }
            const res = await request(url);
            return res; // Returns { success: true, data: [...], lastKey: "..." }
        },
        getPointHistory: async (userId: string) => {
            const res = await request(`/admin/users/points/history?userId=${userId}`);
            return res.data;
        }
    },
    config: {
        getVersion: async () => {
            const res = await request('/admin/config/version');
            return res.data;
        },
        updateVersion: async (updates: Record<string, string | number | boolean>) => {
            return request('/admin/config/version', {
                method: 'POST',
                body: JSON.stringify(updates)
            });
        }
    },
    vouchers: {
        getStats: async () => {
            const res = await request('/redeem-codes/stats');
            return res.data;
        },
        getUsageTrend: async (days = 30) => {
            const res = await request(`/redeem-codes/usage-trend?days=${days}`);
            return res.data;
        },
        getBatches: async (limit = 20) => {
            const res = await request(`/redeem-codes/batches?limit=${limit}`);
            return res.data;
        },
        generate: async (data: { quantity: number; points: number; createdBy: string }) => {
            const res = await request('/redeem-codes/generate', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            return res.data;
        },
        // Kept for backward compatibility if needed, but likely replaced by the new implementation
        list: async () => {
            const res = await request('/admin/vouchers');
            return res.data;
        },
        create: async (voucher: Record<string, string | number>) => {
            return request('/admin/vouchers', {
                method: 'POST',
                body: JSON.stringify(voucher)
            });
        },
        update: async (voucher: Record<string, string | number>) => {
            return request('/admin/vouchers/update', {
                method: 'POST',
                body: JSON.stringify(voucher)
            });
        },
        delete: async (code: string) => {
            return request('/admin/vouchers/delete', {
                method: 'POST',
                body: JSON.stringify({ code })
            });
        },
        // 下載該批次序號 CSV。原本是回傳裸 URL 給 window.open()，端點補驗證後那條路必 401。
        downloadBatch: (batchId: string) =>
            requestBlob(`/redeem-codes/batch/${batchId}/download`, `codes_${batchId}.csv`)
    },
    eventCommands: {
        getStats: async () => {
            const res = await request('/event-commands/stats');
            return res.data;
        },
        list: async () => {
            const res = await request('/event-commands');
            return res.data; // The reference returns { success: true, data: [...] }
        },
        create: async (data: any) => {
            const res = await request('/event-commands', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            return res;
        },
        updateStatus: async (commandId: string, isActive: boolean) => {
            const res = await request('/event-commands/update', {
                method: 'POST',
                body: JSON.stringify({ commandId, isActive })
            });
            return res;
        },
        delete: async (commandId: string) => {
            const res = await request('/event-commands/delete', {
                method: 'POST',
                body: JSON.stringify({ commandId })
            });
            return res;
        },
        getRedemptions: async (commandId: string) => {
            const res = await request(`/event-commands/redemptions?commandId=${commandId}`);
            return res.data;
        }
    },
    admins: {
        list: async () => {
            const res = await request('/admin/admins');
            return res.data;
        },
        create: async (admin: any) => {
            return request('/admin/admins', {
                method: 'POST',
                body: JSON.stringify(admin)
            });
        },
        update: async (admin: any) => {
            return request('/admin/admins', {
                method: 'PATCH',
                body: JSON.stringify(admin)
            });
        },
        delete: async (username: string) => {
            return request('/admin/admins', {
                method: 'DELETE',
                body: JSON.stringify({ username })
            });
        }
    },
    moderation: {
        listReports: async () => {
            const res = await request('/admin/moderation/reports');
            return res.data;
        },
        takeAction: async (actionData: any) => {
            return request('/admin/moderation/action', {
                method: 'POST',
                body: JSON.stringify(actionData)
            });
        }
    },
    push: {
        sendAll: async (data: { title: string, body: string, url?: string }) => {
            return request('/admin/push-all', {
                method: 'POST',
                body: JSON.stringify({
                    title: data.title,
                    message: data.body,
                    data: { url: data.url }
                })
            });
        }
    },
    logs: {
        list: async () => {
            const res = await request('/admin/logs');
            return res.data;
        }
    },
    analysis: {
        getUsers: async () => {
            const res = await request('/admin/analysis/users');
            return res.data;
        },
        getGames: async () => {
            const res = await request('/admin/analysis/games');
            return res.data;
        },
        getSocial: async () => {
            const res = await request('/admin/analysis/social');
            return res.data;
        },
        getChat: async () => {
            const res = await request('/admin/analysis/chat');
            return res.data;
        },
        getTraffic: async () => {
            const res = await request('/admin/analysis/traffic');
            return res.data;
        },
        getToken: async () => {
            const res = await request('/admin/analysis/token');
            return res.data;
        },
        getLedger: async () => {
            const res = await request('/admin/analysis/ledger');
            return res.data;
        },
        getInvite: async () => {
            return request('/admin/analysis/invite');
        },
        getMessages: async (roomId: string, limit?: number) => {
            let url = `/chat/history?roomId=${encodeURIComponent(roomId)}`;
            if (limit) url += `&limit=${limit}`;
            const res = await request(url);
            return res.data;
        }
    },
    activities: {
        list: async () => {
            const res = await request('/admin/activities');
            return res.data;
        },
        update: async (configs: Record<string, string>) => {
            return request('/admin/activities', {
                method: 'POST',
                body: JSON.stringify(configs)
            });
        }
    }
};

export const BASE_URL = 'https://yg7y0xkb50.execute-api.ap-southeast-1.amazonaws.com';
export const VOUCHER_BASE_URL = 'https://00pox0hvv4.execute-api.ap-southeast-1.amazonaws.com/prod';
export const EVENT_COMMAND_BASE_URL = 'https://5yas775i27gfb2al7s7seq64da0wdgmj.lambda-url.ap-southeast-1.on.aws';

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

const requestExternal = async (baseUrl: string, endpoint: string, options: RequestInit = {}) => {
    // Some external APIs might not need the admin token or might need a different one. 
    // For now we assume they are public or use the same auth if needed, 
    // but the reference Implementation didn't seem to use Auth headers in the JS files provided.
    // However, we should check if we need to pass headers. 
    // The reference `api.js` didn't send Authorization headers.

    const url = new URL(baseUrl + endpoint);
    if (options.body && typeof options.body === 'string') {
        // If body is present, ensure Content-Type is set
        options.headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
    }

    const res = await fetch(url.toString(), options);
    const data = await res.json();
    if (!res.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
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
            const res = await requestExternal(VOUCHER_BASE_URL, '/redeem-codes/stats');
            return res.data;
        },
        getUsageTrend: async (days = 30) => {
            const res = await requestExternal(VOUCHER_BASE_URL, `/redeem-codes/usage-trend?days=${days}`);
            return res.data;
        },
        getBatches: async (limit = 20) => {
            const res = await requestExternal(VOUCHER_BASE_URL, `/redeem-codes/batches?limit=${limit}`);
            return res.data;
        },
        generate: async (data: { quantity: number; points: number; createdBy: string }) => {
            const res = await requestExternal(VOUCHER_BASE_URL, '/redeem-codes/generate', {
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
        // Helper for download URL
        getDownloadUrl: (batchId: string) => `${VOUCHER_BASE_URL}/redeem-codes/batch/${batchId}/download`
    },
    eventCommands: {
        getStats: async () => {
            const res = await requestExternal(EVENT_COMMAND_BASE_URL, '/event-commands/stats');
            return res.data;
        },
        list: async () => {
            const res = await requestExternal(EVENT_COMMAND_BASE_URL, '/event-commands');
            return res.data; // The reference returns { success: true, data: [...] }
        },
        create: async (data: any) => {
            const res = await requestExternal(EVENT_COMMAND_BASE_URL, '/event-commands', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            return res;
        },
        updateStatus: async (commandId: string, isActive: boolean) => {
            const res = await requestExternal(EVENT_COMMAND_BASE_URL, '/event-commands/update', {
                method: 'POST',
                body: JSON.stringify({ commandId, isActive })
            });
            return res;
        },
        delete: async (commandId: string) => {
            const res = await requestExternal(EVENT_COMMAND_BASE_URL, '/event-commands/delete', {
                method: 'POST',
                body: JSON.stringify({ commandId })
            });
            return res;
        },
        getRedemptions: async (commandId: string) => {
            const res = await requestExternal(EVENT_COMMAND_BASE_URL, `/event-commands/redemptions?commandId=${commandId}`);
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

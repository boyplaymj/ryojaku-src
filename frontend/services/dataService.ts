import { Game, GroupEvent, CreateGroupPayload, CreateMahjongGamePayload, Category, UserStats } from '../types';
import {
    searchGames,
    getMyGames,
    registerGame,
    createGame as apiCreateGame,
    getGameDetail,
    acceptRegistration,
    rejectRegistration,
    cancelGame,
    cancelRegistration as apiCancelRegistration,
    getRatings,
    getUserProfile,
    getUserInfo,
    getChatRooms,
    getChatHistory,
    markAsRead,
    SearchGamesParams,
    getVersionConfig,
    claimDailyBonus
} from './apiService';
import { authService } from './authService';

// Helper to mask Taiwan address to district level
export function maskAddress(address: string): string {
    if (!address) return "";
    // Match City/County + District/Town/Ship/City
    // Example: 台北市信義區, 屏東縣恆春鎮, 嘉義市西區
    const match = address.match(/^.*?[縣|市].*?[區|鎮|鄉|市]/);
    if (match) {
        return match[0] + "***";
    }
    // Fallback: if it doesn't match the standard format, show first 6 characters
    return address.length > 6 ? address.substring(0, 6) + "***" : address;
}

// Helper function to convert Game to GroupEvent for backward compatibility
export function gameToGroupEvent(game: Game, currentUserId?: string): GroupEvent {
    const isOwner = currentUserId ? game.hostUserId === currentUserId : false;
    const joined = currentUserId ? game.joinedPlayers.some(p => p.userId === currentUserId) : false;

    // Mask address if not owner or joined player
    const displayAddress = (isOwner || joined) ? game.location.address : maskAddress(game.location.address);

    return {
        id: game.gameId,
        hostId: game.hostUserId,
        hostName: game.hostDisplayName,
        title: game.location.placeName,
        location: game.location.placeName,
        address: displayAddress,
        latitude: game.location.latitude,
        longitude: game.location.longitude,
        date: game.gameInfo.startTime || game.gameInfo.timeText,
        category: Category.GAME,
        maxMembers: game.playersNeeded + 1,
        currentMembers: game.currentPlayers,
        stakes: game.gameInfo.stakes,
        rules: game.gameInfo.gameType,
        gameType: game.type, // 'one-time' or 'long-term'
        restrictions: game.restrictions?.join(', '),
        features: game.venueFeatures?.join(', '),
        contactMethod: 'LINE ID',
        lineId: game.contactInfo?.lineId || '',
        joined: joined,
        isOwner: isOwner,
        status: game.status,
        distance: game.distance,
        hostPictureUrl: game.hostPictureUrl,
        images: game.images,
    };
}

export const api = {
    // Search/Get all games
    getEvents: async (params?: SearchGamesParams): Promise<GroupEvent[]> => {
        try {
            const user = authService.getCurrentUser();
            const response = await searchGames(params || {});

            // 根據修正後的 API 回應格式，檢查 response.data.games
            if (!response.success || !response.data?.games) {
                console.error('Failed to fetch games:', response.error);
                return [];
            }

            const games: Game[] = response.data.games;
            // Filter out invalid games if necessary
            return games.map(game => gameToGroupEvent(game, user?.userId));
        } catch (error) {
            console.error('Error fetching events:', error);
            return [];
        }
    },

    // Get my games (created and joined)
    getMyGames: async (): Promise<GroupEvent[]> => {
        try {
            const user = authService.getCurrentUser();
            if (!user) throw new Error('Not logged in');

            // Use userId or lineId
            const userIdentifier = user.userId;

            const response = await getMyGames(userIdentifier);

            if (!response.success) {
                console.error('Failed to fetch my games:', response.error);
                return [];
            }

            // API returns hostedGames (correct field name) or createdGames (legacy)
            const hostedGames: Game[] = response.data?.hostedGames || response.data?.createdGames || [];
            const joinedGames: Game[] = response.data?.joinedGames || [];

            console.log('[DataService] Hosted games:', hostedGames.length, 'Joined games:', joinedGames.length);

            const allGames = [...hostedGames, ...joinedGames];
            // Remove duplicates if any
            const uniqueGames = Array.from(new Map(allGames.map(item => [item.gameId, item])).values());

            return uniqueGames.map(game => gameToGroupEvent(game, user.userId));
        } catch (error) {
            console.error('Error fetching my games:', error);
            return [];
        }
    },

    // Get raw hosted and joined games
    getRawMyGames: async (): Promise<Game[]> => {
        try {
            const user = authService.getCurrentUser();
            if (!user) throw new Error('Not logged in');

            const response = await getMyGames(user.userId);
            if (!response.success) return [];

            const hosted = response.data?.hostedGames || response.data?.createdGames || [];
            const joined = response.data?.joinedGames || [];

            const all = [...hosted, ...joined];
            // Remove duplicates
            return Array.from(new Map(all.map(g => [g.gameId, g])).values());
        } catch (error) {
            console.error('Error fetching raw my games:', error);
            return [];
        }
    },

    // Create a new mahjong game (Legacy/Payload wrapper)
    createEvent: async (payload: CreateGroupPayload): Promise<GroupEvent> => {
        try {
            const user = authService.getCurrentUser();
            if (!user) throw new Error('Not logged in');

            const userIdentifier = user.userId;

            // Convert CreateGroupPayload to CreateMahjongGamePayload
            const gameData: CreateMahjongGamePayload = {
                type: 'one-time',
                gameType: '基本三將',
                placeName: payload.location,
                location: payload.address,
                latitude: payload.latitude || 0,
                longitude: payload.longitude || 0,
                needPlayers: payload.maxMembers,
                stakes: payload.stakes,
                startTime: new Date(payload.date).toISOString(),
                rules: payload.rules ? [payload.rules] : [],
                features: payload.features ? payload.features.split(',').map(s => s.trim()) : [],
                restrictions: payload.restrictions ? payload.restrictions.split(',').map(s => s.trim()) : [],
            };

            const response = await apiCreateGame(userIdentifier, gameData);

            if (!response.success) {
                throw new Error(response.error || 'Failed to create game');
            }

            // Fetch the created game to return as GroupEvent
            const createdGameData = await api.getGameDetail(response.data.gameID);
            if (!createdGameData || !createdGameData.game) {
                throw new Error('Failed to fetch created game');
            }

            return gameToGroupEvent(createdGameData.game, user.userId);
        } catch (error) {
            console.error('Error creating event:', error);
            throw error;
        }
    },

    // Create a new mahjong game (Direct API)
    createGame: async (userIdentifier: string, payload: CreateMahjongGamePayload) => {
        try {
            const response = await apiCreateGame(userIdentifier, payload);
            return response;
        } catch (error) {
            console.error('Error creating game:', error);
            return { success: false, error: 'Failed to create game' };
        }
    },

    // Join/Register for a game
    joinEvent: async (eventId: string, message?: string): Promise<void> => {
        try {
            const user = authService.getCurrentUser();
            if (!user) throw new Error('Not logged in');

            const response = await registerGame(user.userId, {
                gameID: eventId,
                message: message
            });

            if (!response.success) {
                throw new Error(response.error || 'Failed to register for game');
            }
        } catch (error) {
            console.error('Error joining event:', error);
            throw error;
        }
    },

    // Get game detail
    getGameDetail: async (gameId: string): Promise<{
        game: Game,
        registrations: any[],
        hostStats?: UserStats,
        hostGender?: string,
        hostAgeRange?: string
    } | null> => {
        try {
            const currentUser = authService.getCurrentUser();
            const lineId = authService.getLineId();
            const userIdentifier = currentUser?.userId || lineId;
            const response = await getGameDetail(gameId, userIdentifier);

            if (!response.success || !response.data) {
                console.error('Failed to fetch game detail:', response.error);
                return null;
            }

            return {
                game: response.data.game,
                registrations: response.data.registrations || [],
                hostStats: response.data.hostStats,
                hostGender: response.data.hostGender,
                hostAgeRange: response.data.hostAgeRange
            };
        } catch (error) {
            console.error('Error fetching game detail:', error);
            return null;
        }
    },

    // Host actions
    acceptRegistration: async (gameId: string, registrationId: string): Promise<void> => {
        const user = authService.getCurrentUser();
        if (!user) throw new Error('Not logged in');

        const response = await acceptRegistration(user.userId, { registrationId });
        if (!response.success) throw new Error(response.error || 'Operation failed');
    },

    rejectRegistration: async (gameId: string, registrationId: string, reason?: string): Promise<void> => {
        const user = authService.getCurrentUser();
        if (!user) throw new Error('Not logged in');

        const response = await rejectRegistration(user.userId, {
            registrationId,
            reason
        });
        if (!response.success) throw new Error(response.error || 'Operation failed');
    },

    cancelEvent: async (gameId: string, reason?: string): Promise<void> => {
        const user = authService.getCurrentUser();
        if (!user) throw new Error('Not logged in');

        const response = await cancelGame(user.userId, {
            gameId,
            reason
        });
        if (!response.success) throw new Error(response.error || 'Operation failed');
    },

    cancelRegistration: async (gameId: string, registrationId: string): Promise<void> => {
        const user = authService.getCurrentUser();
        if (!user) throw new Error('Not logged in');

        const response = await apiCancelRegistration(user.userId, {
            gameID: gameId,
            registrationID: registrationId
        });
        if (!response.success) throw new Error(response.error || 'Operation failed');
    },

    getRatings: async (userId: string, gameId?: string) => {
        const user = authService.getCurrentUser();
        if (!user) throw new Error('Not logged in');
        return getRatings(userId, gameId);
    },

    getUserProfile: async (userId: string) => {
        return getUserProfile(userId);
    },

    getUserInfo: async (userId: string) => {
        return getUserInfo(userId);
    },

    getChatRooms: async () => {
        const user = authService.getCurrentUser();
        if (!user) return { success: false, error: 'Not logged in' };
        return getChatRooms(user.userId);
    },

    getChatHistory: async (roomId: string) => {
        return getChatHistory(roomId);
    },

    markAsRead: async (roomId: string) => {
        const user = authService.getCurrentUser();
        if (!user) return { success: false, error: 'Not logged in' };
        return markAsRead(user.userId, roomId);
    },

    getVersionConfig: async () => {
        return getVersionConfig();
    },

    // Ledger methods
    getLedger: async () => {
        const user = authService.getCurrentUser();
        if (!user) return { success: false, error: 'Not logged in' };
        return (await import('./apiService')).getLedger(user.userId);
    },

    createLedger: async (ledgerData: any) => {
        const user = authService.getCurrentUser();
        if (!user) return { success: false, error: 'Not logged in' };
        return (await import('./apiService')).createLedgerAccount(user.userId, ledgerData);
    },

    getLedgerSummary: async () => {
        const user = authService.getCurrentUser();
        if (!user) return { success: false, error: 'Not logged in' };
        return (await import('./apiService')).getLedgerSummary(user.userId);
    },

    updateLedger: async (ledgerData: any) => {
        const user = authService.getCurrentUser();
        if (!user) return { success: false, error: 'Not logged in' };
        return (await import('./apiService')).updateLedger(user.userId, ledgerData);
    },

    deleteLedger: async (ledgerId: string, createdAt: number) => {
        const user = authService.getCurrentUser();
        if (!user) return { success: false, error: 'Not logged in' };
        return (await import('./apiService')).deleteLedger(user.userId, ledgerId, createdAt);
    },


    claimDailyBonus: async () => {
        const user = authService.getCurrentUser();
        if (!user) return { success: false, error: 'Not logged in' };
        return claimDailyBonus(user.userId);
    }
};
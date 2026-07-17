import { Game, Category, Post, Comment } from '../types';

export const MOCK_GAMES: Game[] = [
    {
        gameId: 'mock-game-1',
        hostUserId: 'host-1',
        hostDisplayName: 'Cyber_Host',
        type: 'one-time',
        status: 'recruiting',
        location: {
            latitude: 25.0330,
            longitude: 121.5654,
            address: '台北市信義區信義路五段7號',
            placeName: '台北 101 觀景台'
        },
        geohash: 'wsqqq',
        playersNeeded: 3,
        currentPlayers: 1,
        joinedPlayers: [
            {
                userId: 'host-1',
                displayName: 'Cyber_Host',
                pictureUrl: '',
                joinedAt: new Date().toISOString()
            }
        ],
        gameInfo: {
            stakes: '300/100',
            timeText: '今晚 20:00',
            startTime: new Date(Date.now() + 3600000 * 4).toISOString(),
            gameType: '台灣麻將',
            rules: ['見花', 'MIG'],
            features: ['電動麻將桌', '提供飲料'],
            restrictions: ['禁菸']
        },
        venueFeatures: ['電動麻將桌', '提供飲料'],
        restrictions: ['禁菸'],
        contactInfo: {
            lineId: 'cyber_host_line'
        },
        notificationQuota: 10,
        createdAt: Date.now() / 1000,
        updatedAt: new Date().toISOString(),
        expiresAt: Date.now() / 1000 + 86400,
        distance: 0.5
    },
    {
        gameId: 'mock-game-2',
        hostUserId: 'host-2',
        hostDisplayName: 'Neon_Player',
        type: 'one-time',
        status: 'recruiting',
        location: {
            latitude: 25.0478,
            longitude: 121.5170,
            address: '台北市中正區忠孝西路一段49號',
            placeName: '台北車站地下街'
        },
        geohash: 'wsqqq',
        playersNeeded: 1,
        currentPlayers: 3,
        joinedPlayers: [],
        gameInfo: {
            stakes: '100/20',
            timeText: '明天 14:00',
            startTime: new Date(Date.now() + 86400000).toISOString(),
            gameType: '台灣麻將',
            rules: ['無花', '快手'],
            features: ['冷氣強'],
            restrictions: []
        },
        venueFeatures: ['冷氣強'],
        restrictions: [],
        contactInfo: {
            lineId: 'neon_player_line'
        },
        notificationQuota: 10,
        createdAt: Date.now() / 1000,
        updatedAt: new Date().toISOString(),
        expiresAt: Date.now() / 1000 + 86400 * 2,
        distance: 2.3
    },
    {
        gameId: 'mock-game-3',
        hostUserId: 'host-3',
        hostDisplayName: 'Night_Owl',
        type: 'one-time',
        status: 'recruiting',
        location: {
            latitude: 25.0422,
            longitude: 121.5456,
            address: '台北市大安區忠孝東路四段',
            placeName: '東區地下街'
        },
        geohash: 'wsqqq',
        playersNeeded: 2,
        currentPlayers: 2,
        joinedPlayers: [],
        gameInfo: {
            stakes: '50/10',
            timeText: '後天 19:00',
            startTime: new Date(Date.now() + 86400000 * 2).toISOString(),
            gameType: '台灣麻將',
            rules: ['歡樂場'],
            features: ['可帶外食'],
            restrictions: ['禁酒']
        },
        venueFeatures: ['可帶外食'],
        restrictions: ['禁酒'],
        contactInfo: {
            lineId: 'night_owl_line'
        },
        notificationQuota: 10,
        createdAt: Date.now() / 1000,
        updatedAt: new Date().toISOString(),
        expiresAt: Date.now() / 1000 + 86400 * 3,
        distance: 1.2
    }
];

export const MOCK_MY_GAMES = {
    createdGames: [MOCK_GAMES[0]],
    joinedGames: [MOCK_GAMES[1]]
};

export const MOCK_NOTIFICATIONS = [
    {
        notificationId: 'mock-notif-1',
        userId: 'user-1',
        type: 'registration',
        title: '新的入局申請 (LOCALHOST)',
        message: '玩家 "Cyber_Ronin" 申請加入您的 "夜之城德州撲克" 牌局。',
        gameId: 'mock-game-1',
        gameName: '夜之城德州撲克',
        fromUserId: 'user-2',
        fromUserName: 'Cyber_Ronin',
        isRead: false,
        createdAt: Date.now() / 1000 - 300
    },
    {
        notificationId: 'mock-notif-2',
        userId: 'user-1',
        type: 'system',
        title: '系統維護通知 (LOCALHOST)',
        message: '系統將於今晚 03:00 進行例行維護，預計耗時 30 分鐘。',
        isRead: false,
        createdAt: Date.now() / 1000 - 3600
    },
    {
        notificationId: 'mock-notif-3',
        userId: 'user-1',
        type: 'approval',
        title: '入局申請已核准 (LOCALHOST)',
        message: '恭喜！您已成功加入 "霓虹麻將大賽"。',
        gameId: 'mock-game-2',
        gameName: '霓虹麻將大賽',
        isRead: true,
        createdAt: Date.now() / 1000 - 86400
    }
];

export const MOCK_POSTS: Post[] = [
    {
        postId: 'post-mock-1',
        authorId: 'user-mock-1',
        authorName: 'Mock User',
        authorAvatar: '',
        content: '# Hello World\nThis is a *mock* post from localhost.',
        contentType: 'markdown',
        images: ['https://placehold.co/600x400/1e293b/06b6d4?text=Mock+Image'],
        tags: ['Mock', 'Dev'],
        likeCount: 42,
        commentCount: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isLikedByMe: false
    },
    {
        postId: 'post-mock-2',
        authorId: 'user-mock-2',
        authorName: 'Another User',
        authorAvatar: '',
        content: 'Testing the infinite scroll with another mock post.',
        contentType: 'text',
        tags: ['Testing'],
        likeCount: 10,
        commentCount: 0,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
        isLikedByMe: true
    }
];

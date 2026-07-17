import { GroupEvent, Category, User } from './types';

export const APP_VERSION = '2.0.4';

export const STORAGE_KEYS = {
  USER: 'mahjongclub_user_session',
  LINE_ID: 'mahjongclub_line_id',
  AUTH_TYPE: 'mahjongclub_auth_type',
  JWT: 'mahjongclub_jwt_token'
};

export const MOCK_USER: User = {
  userId: 'u_jj',
  displayName: 'JJ',
  pictureUrl: '',
  contactInfo: { note: '準備開始打麻將了嗎？' },
  gender: '男',
  ageRange: '28-32歲',
  mahjongExperience: '專家',
  lineId: 'p51495149',
  isVerified: false,
  points: 35740,
  rating: 0,
  stats: {
    gamesHosted: 7,
    gamesJoined: 0,
    totalRatings: 0,
    positiveRatings: 0,
    positiveRatingRate: 0
  }
};

export const MOCK_EVENTS: GroupEvent[] = [
  {
    id: 'e1',
    hostId: 'u_jj',
    hostName: 'JJ',
    title: '打完吃夜市',
    location: '打完吃夜市',
    address: '106台灣臺北市大安區泰順街40巷21號五樓號',
    latitude: 25.0232,
    longitude: 121.5317,
    date: '2025-10-25T00:00:00',
    category: Category.GAME,
    maxMembers: 4,
    currentMembers: 2,
    stakes: '100/20',
    rules: '基本三將',
    contactMethod: 'LINE ID',
    lineId: 'p51495149',
    joined: true,
    isOwner: true,
    status: 'recruiting'
  },
  {
    id: 'e2',
    hostId: 'u_jj',
    hostName: 'JJ',
    title: '公園阿伯來一局',
    location: '公園阿伯來一局',
    address: '100台灣臺北市中正區泉州街147號',
    latitude: 25.0264,
    longitude: 121.5160,
    date: '2025-10-22T23:38:00',
    category: Category.GAME,
    maxMembers: 4,
    currentMembers: 1,
    stakes: '100/20',
    rules: '基本三將',
    contactMethod: 'LINE ID',
    lineId: 'p99999',
    joined: true,
    isOwner: true,
    status: 'recruiting'
  },
  {
    id: 'e3',
    hostId: 'u_other',
    hostName: '小賈',
    title: '日月潭打麻將',
    location: '日月潭',
    address: '南投縣魚池鄉',
    date: '2025-10-23T00:41:00',
    category: Category.GAME,
    maxMembers: 4,
    currentMembers: 3,
    stakes: '300/50',
    rules: '見花',
    contactMethod: 'LINE ID',
    joined: true,
    isOwner: false,
    latitude: 23.8523,
    longitude: 120.9157,
    status: 'recruiting'
  }
];
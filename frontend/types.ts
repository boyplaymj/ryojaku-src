export enum Category {
  FOOD = 'Food',
  SPORTS = 'Sports',
  TRAVEL = 'Travel',
  GAME = 'Game',
  OTHER = 'Other'
}

// Backend API Types - matching Go structs

export interface Location {
  latitude: number;
  longitude: number;
  address: string;
  placeName: string;
}

export interface Player {
  userId: string;
  displayName: string;
  pictureUrl: string;
  lineId?: string;
  joinedAt: string;
}

export interface GameInfo {
  stakes: string;
  timeText: string;
  startTime?: string;
  gameType: string;
  rules: string[];
  features?: string[];
  restrictions?: string[];
}

export interface ContactInfo {
  phone?: string;
  lineId?: string;
  note?: string;
}

export interface UserStats {
  gamesHosted: number;
  gamesJoined: number;
  ratingCount?: number;
  averageRating?: number;
  totalRatings?: number;
  positiveRatings?: number;
  positiveRatingRate?: number;
  totalPosts?: number;
  totalLikesReceived?: number;
}

export interface User {
  userId: string;
  displayName: string;
  gender?: string;
  ageRange?: string;
  mahjongExperience?: string;
  lineId?: string;
  contactInfo?: ContactInfo;
  points: number;
  rating: number;
  isVerified: boolean;
  stats?: UserStats;
  pictureUrl?: string;
  invitedBy?: string;
  inviteCount?: number;
  inviteLimit?: number;
  hasClaimedPushBonus?: boolean;
  createdAt?: number;
  updatedAt?: string;
}

export interface Game {
  gameId: string;
  hostUserId: string;
  hostDisplayName: string;
  hostPictureUrl?: string;
  type: string; // "long-term" or "one-time"
  status: string; // "recruiting", "full", "closed", "cancelled"
  location: Location;
  geohash: string;
  playersNeeded: number;
  currentPlayers: number;
  joinedPlayers: Player[];
  gameInfo: GameInfo;
  venueFeatures?: string[];
  restrictions?: string[];
  contactInfo: ContactInfo;
  notificationQuota: number;
  createdAt: number;
  updatedAt: string;
  expiresAt: number;
  distance?: number; // For nearby search
  images?: string[];
}

export interface Registration {
  registrationId: string;
  gameId: string;
  userId: string;
  displayName: string;
  pictureUrl?: string;
  status: string; // "pending", "accepted", "rejected", "cancelled"
  message?: string;
  notificationSent: boolean;
  createdAt: number;
  updatedAt: string;
}

// Legacy types for backward compatibility (will be migrated)
export interface GroupEvent {
  id: string;
  hostId: string;
  hostName: string;
  title: string;
  location: string;
  address: string;
  latitude?: number;
  longitude?: number;
  date: string; // ISO string
  category: Category;
  maxMembers: number;
  currentMembers: number;
  stakes: string; // e.g., '100/20'
  rules: string; // e.g., '基本三將'
  gameType?: string; // 'one-time' or 'long-term'
  restrictions?: string;
  features?: string;
  contactMethod: string;
  lineId?: string;
  joined: boolean;
  isOwner: boolean;
  status: string; // "recruiting", "full", "closed", "cancelled"
  distance?: number; // Distance in km
  hostPictureUrl?: string;
  images?: string[];
}

export interface CreateGroupPayload {
  title: string;
  location: string;
  address: string;
  date: string;
  stakes: string;
  rules: string;
  maxMembers: number;
  description?: string;
  category: Category;
  latitude?: number;
  longitude?: number;
  features?: string;
  restrictions?: string;
}

// Mahjong game creation payload (matches API requirements)
export interface CreateMahjongGamePayload {
  type: string;           // "one-time" or "long-term"
  gameType: string;       // 麻將規則類型: '基本三將', '台麻', '港式', '日麻', '見花', '其他'
  placeName: string;      // 場地名稱
  location: string;       // 完整地址
  latitude: number;       // GPS 緯度
  longitude: number;      // GPS 經度
  needPlayers: number;    // 缺幾人 (1-3)
  stakes: string;         // 籌碼 (例如: '100/20')
  startTime: string;      // 開始時間 (ISO 8601 格式)
  rules: string[];        // 額外規則說明 (陣列)
  features: string[];     // 場地特色 (陣列)
  restrictions: string[]; // 玩家限制 (陣列)
  images?: string[];      // 團局照片 (陣列)
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'alert' | 'news';
  timestamp: string;
  isRead: boolean;
  data?: any;
}

// Community System Types
export interface Post {
  postId: string;
  authorId: string;
  authorName?: string;
  authorAvatar?: string;
  content: string;
  contentType: 'markdown' | 'json' | 'text';
  images?: string[];
  tags?: string[];
  likeCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  isLikedByMe?: boolean;
}

export interface Comment {
  postId: string;
  sortKey: string; // COMMENT#<Timestamp>#<UUID>
  authorId: string;
  authorName?: string;
  authorAvatar?: string;
  content: string;
  likeCount: number;
  createdAt: string;
  isAuthor: boolean;
  isLikedByMe?: boolean;
}

export interface CreatePostPayload {
  userId: string;
  content: string;
  contentType: 'markdown' | 'json' | 'text';
  images?: string[];
  tags?: string[];
}
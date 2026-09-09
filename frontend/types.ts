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
  /** @deprecated 舊版後端的頂層欄位，新資料請讀 stats.gamesHosted */
  gamesHosted?: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// Venue（場地）—— [B1-j1]。正典：tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §5
//
// 🔴 這裡刻意分成**兩個**型別，對應後端**兩條不同的路徑**，不要合併：
//   - `PublicVenueCard`  ← GET  /venue-list  （公開，無 authorizer）
//   - `VenueDetail`      ← POST /venue-detail（要登入，地址授權在這裡）
//
// 後端 `shared.PublicVenueCard` 是**白名單型別**（獨立宣告、不嵌入 Venue），
// 結構上不含 exactAddress／ownerId／phone／status。前端若把兩者合成一個型別，
// 「列表沒有 status」這件事就變成 optional 欄位，而 `status === undefined`
// 與「這筆真的是 pending」在畫面上會長得一樣。⇒ 分開宣告，少一種要分辨的形狀。
// ─────────────────────────────────────────────────────────────────────────────

/** §5.1 三分類。🔴 **沒有 dojo** —— 道館是 hall 的一種狀態（§5.2），不是第四種 type。 */
export type VenueType = 'hall' | 'home' | 'event';

/** §5.3。`rejected`（審核不通過）與 `suspended`（上線後停權）刻意分開。 */
export type VenueStatus = 'pending' | 'active' | 'rejected' | 'suspended';

export interface VenueLocation {
  latitude: number;
  longitude: number;
  /** 可公開的稱呼（店名／「大安區」），**不是**門牌。 */
  placeName?: string;
  geohash?: string;
}

/** GET /venue-list 的一張卡片。欄位一對一對應後端 `shared.PublicVenueCard`。 */
export interface PublicVenueCard {
  venueId: string;
  /** 後端回的是字串；不宣告成 VenueType 是因為它可能是我們還不認得的值。 */
  type: string;
  name: string;
  approxLocation: VenueLocation;
  features?: string[];
  isDojo: boolean;
  ratingPositive: number;
  ratingCount: number;
}

/** GET /venue-list 的一頁。`nextToken` 為空才是「掃完了」（見 utils/venueView.ts）。 */
export interface VenueListPage {
  venues: PublicVenueCard[];
  nextToken?: string;
}

/**
 * POST /venue-detail 的 data。對應後端 `shared.VenueView`（Venue ＋ 外層 exactAddress）。
 *
 * 🔴 `exactAddress` 是 optional **而且那個 optional 本身就是授權訊號**：
 * 後端在沒授權時讓整個鍵不存在、放行時鍵一定存在（即使值是空字串）。
 * ⇒ 不要用 `if (!v.exactAddress)` 判斷 —— 那會把「被擋」與「主揪還沒填」
 * 合成同一格。判讀一律走 `utils/venueView.ts` 的 `readAddressState()`。
 */
export interface VenueDetail {
  venueId: string;
  type: string;
  name: string;
  /** 🔴 後端**只對 `hall`／`event` 回這兩個**（`shared.VenueContactIsPublic`）。自建場的電話是屋主私人號碼。 */
  phone?: string;
  businessHours?: string;
  approxLocation: VenueLocation;
  features?: string[];
  /**
   * 🔴 這是**伺服器算的布林，取代了 `ownerId`**（[B5-b]，`ryojaku-src eaf2ba7`）。
   * 前端需要知道「這是不是我的場地」，但不需要知道是誰的 —— `ownerId` 洩出去
   * 等於把「誰家開放給人打牌」變成可枚舉的（§5.3 講 `PublicVenueCard` 時就寫過）。
   */
  isOwner: boolean;
  isDojo: boolean;
  ratingPositive: number;
  ratingCount: number;
  status: string;
  exactAddress?: string;
}

/** POST /create-venue 的請求。對應後端窄 DTO `shared.CreateVenueRequest`。 */
export interface CreateVenuePayload {
  type: VenueType;
  name: string;
  phone?: string;
  businessHours?: string;
  approxLocation: VenueLocation;
  exactAddress?: string;
  features?: string[];
}

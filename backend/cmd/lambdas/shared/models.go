package shared

import (
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Game represents a mahjong game session (matching LINE Bot structure)
type Game struct {
	GameID            string       `dynamodbav:"gameId" json:"gameId"`
	HostUserID        string       `dynamodbav:"hostUserId" json:"hostUserId"`
	HostDisplayName   string       `dynamodbav:"hostDisplayName" json:"hostDisplayName"`
	HostPictureURL    string       `dynamodbav:"-" json:"hostPictureUrl,omitempty"`
	Type              string       `dynamodbav:"type" json:"type"`     // "long-term" or "one-time"
	Status            string       `dynamodbav:"status" json:"status"` // "recruiting", "full", "closed", "cancelled"
	Location          Location     `dynamodbav:"location" json:"location"`
	Geohash           string       `dynamodbav:"geohash" json:"geohash"` // For location queries
	PlayersNeeded     int          `dynamodbav:"playersNeeded" json:"playersNeeded"`
	CurrentPlayers    int          `dynamodbav:"currentPlayers" json:"currentPlayers"`
	JoinedPlayers     []Player     `dynamodbav:"joinedPlayers" json:"joinedPlayers"`
	GameInfo          GameInfo     `dynamodbav:"gameInfo" json:"gameInfo"`
	VenueFeatures     []string     `dynamodbav:"venueFeatures,omitempty" json:"venueFeatures,omitempty"`
	Images            []string     `dynamodbav:"images,omitempty" json:"images,omitempty"` // S3 URLs
	Restrictions      []string     `dynamodbav:"restrictions,omitempty" json:"restrictions,omitempty"`
	ContactInfo       ContactInfo  `dynamodbav:"contactInfo" json:"contactInfo"`
	NotificationQuota int          `dynamodbav:"notificationQuota" json:"notificationQuota"` // 主揪推送配額 (初始值: 3)
	CreatedAt         int64        `dynamodbav:"createdAt" json:"createdAt"`                 // Unix timestamp for GSI
	UpdatedAt         FlexibleTime `dynamodbav:"updatedAt" json:"updatedAt"`
	ExpiresAt         int64        `dynamodbav:"expiresAt" json:"expiresAt"` // TTL
}

// Location represents a geographic location
type Location struct {
	Latitude  float64 `dynamodbav:"latitude" json:"latitude"`
	Longitude float64 `dynamodbav:"longitude" json:"longitude"`
	Address   string  `dynamodbav:"address" json:"address"`
	PlaceName string  `dynamodbav:"placeName" json:"placeName"`
}

// Player represents a player in a game
type Player struct {
	UserID      string       `dynamodbav:"userId" json:"userId"`
	DisplayName string       `dynamodbav:"displayName" json:"displayName"`
	PictureURL  string       `dynamodbav:"pictureUrl" json:"pictureUrl"`
	LineID      string       `dynamodbav:"lineId,omitempty" json:"lineId,omitempty"`
	JoinedAt    FlexibleTime `dynamodbav:"joinedAt" json:"joinedAt"`
}

// FlexibleTime is a custom type that can unmarshal from both string and time.Time
type FlexibleTime struct {
	time.Time
}

// UnmarshalDynamoDBAttributeValue implements custom unmarshaling for DynamoDB
func (ft *FlexibleTime) UnmarshalDynamoDBAttributeValue(av types.AttributeValue) error {
	switch v := av.(type) {
	case *types.AttributeValueMemberS:
		// Parse string as time
		t, err := time.Parse(time.RFC3339, v.Value)
		if err != nil {
			return err
		}
		ft.Time = t
		return nil
	default:
		// Try default unmarshal for time.Time
		return attributevalue.Unmarshal(av, &ft.Time)
	}
}

// MarshalDynamoDBAttributeValue implements custom marshaling for DynamoDB
func (ft FlexibleTime) MarshalDynamoDBAttributeValue() (types.AttributeValue, error) {
	// Always marshal as time.Time (not string)
	return attributevalue.Marshal(ft.Time)
}

// MarshalJSON implements custom JSON marshaling
func (ft FlexibleTime) MarshalJSON() ([]byte, error) {
	if ft.Time.IsZero() {
		return []byte("null"), nil
	}
	return []byte(`"` + ft.Time.Format(time.RFC3339) + `"`), nil
}

// UnmarshalJSON implements custom JSON unmarshaling
func (ft *FlexibleTime) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return nil
	}
	str := string(data)
	if len(str) > 2 {
		str = str[1 : len(str)-1] // Remove quotes
	}
	t, err := time.Parse(time.RFC3339, str)
	if err != nil {
		return err
	}
	ft.Time = t
	return nil
}

// GameInfo contains game-specific information
type GameInfo struct {
	Stakes       string       `dynamodbav:"stakes" json:"stakes"`
	TimeText     string       `dynamodbav:"timeText" json:"timeText"`
	StartTime    FlexibleTime `dynamodbav:"startTime,omitempty" json:"startTime,omitempty"`
	GameType     string       `dynamodbav:"gameType" json:"gameType"`
	Rules        []string     `dynamodbav:"rules" json:"rules"`
	Features     []string     `dynamodbav:"features,omitempty" json:"features,omitempty"`
	Restrictions []string     `dynamodbav:"restrictions,omitempty" json:"restrictions,omitempty"`
}

// ContactInfo contains contact information
type ContactInfo struct {
	Phone  string `dynamodbav:"phone,omitempty" json:"phone,omitempty"`
	LineID string `dynamodbav:"lineId,omitempty" json:"lineId,omitempty"`
	Note   string `dynamodbav:"note,omitempty" json:"note,omitempty"`
}

// UserStats represents user statistics
type UserStats struct {
	GamesHosted int `dynamodbav:"gamesHosted" json:"gamesHosted"`
	GamesJoined int `dynamodbav:"gamesJoined" json:"gamesJoined"`
	// 評論相關
	TotalRatings       int     `dynamodbav:"totalRatings" json:"totalRatings"`             // 總評論數
	PositiveRatings    int     `dynamodbav:"positiveRatings" json:"positiveRatings"`       // 好評數
	PositiveRatingRate float64 `dynamodbav:"positiveRatingRate" json:"positiveRatingRate"` // 好評率 (0-100)

	// 貼文相關 (Community)
	TotalPosts         int `dynamodbav:"totalPosts" json:"totalPosts"`                 // 總貼文數
	TotalLikesReceived int `dynamodbav:"totalLikesReceived" json:"totalLikesReceived"` // 總獲讚數
}

// User represents a user in the system
type User struct {
	UserID            string          `dynamodbav:"userId" json:"userId"`
	DisplayName       string          `dynamodbav:"displayName" json:"displayName"`
	Gender            string          `dynamodbav:"gender,omitempty" json:"gender,omitempty"`                       // "male", "female", "other"
	AgeRange          string          `dynamodbav:"ageRange,omitempty" json:"ageRange,omitempty"`                   // "18-22", "23-27", etc.
	MahjongExperience string          `dynamodbav:"mahjongExperience,omitempty" json:"mahjongExperience,omitempty"` // "beginner", "intermediate", "advanced", "expert"
	LineID            string          `dynamodbav:"lineId,omitempty" json:"lineId,omitempty"`                       // LINE ID for contact
	Points            int             `dynamodbav:"points" json:"points"`
	Rating            float64         `dynamodbav:"rating" json:"rating"`
	IsVerified        bool            `dynamodbav:"isVerified" json:"isVerified"`
	Stats             *UserStats      `dynamodbav:"stats,omitempty" json:"stats,omitempty"`
	GamesHosted       int             `dynamodbav:"gamesHosted" json:"gamesHosted"` // Deprecated, use Stats.GamesHosted
	GamesJoined       int             `dynamodbav:"gamesJoined" json:"gamesJoined"` // Deprecated, use Stats.GamesJoined
	Preferences       UserPreferences `dynamodbav:"preferences" json:"preferences"`
	// APP-specific fields
	AppVersion          string     `dynamodbav:"appVersion,omitempty" json:"appVersion,omitempty"`           // For analytics
	Platform            string     `dynamodbav:"platform,omitempty" json:"platform,omitempty"`               // For analytics
	Email               string     `dynamodbav:"email,omitempty" json:"email,omitempty"`                     // For APP login
	PasswordHash        string     `dynamodbav:"passwordHash,omitempty" json:"passwordHash,omitempty"`       // Hashed password for APP login
	AccountType         string     `dynamodbav:"accountType,omitempty" json:"accountType,omitempty"`         // "linebot" or "app"
	EncryptedLineID     string     `dynamodbav:"encryptedLineId,omitempty" json:"encryptedLineId,omitempty"` // For APP users who link LINE account
	EmailVerified       bool       `dynamodbav:"emailVerified" json:"emailVerified"`                         // Email verification status
	LastLoginAt         *time.Time `dynamodbav:"lastLoginAt,omitempty" json:"lastLoginAt,omitempty"`         // Last login timestamp
	PictureURL          string     `dynamodbav:"pictureUrl,omitempty" json:"pictureUrl,omitempty"`           // User avatar URL
	InvitedBy           string     `dynamodbav:"invitedBy,omitempty" json:"invitedBy,omitempty"`             // UserID of the inviter
	InviteRewarded      bool       `dynamodbav:"inviteRewarded,omitempty" json:"inviteRewarded,omitempty"`   // Whether invite points were rewarded
	HasClaimedPushBonus bool       `dynamodbav:"hasClaimedPushBonus" json:"hasClaimedPushBonus"`             // Whether push bonus was claimed
	InviteCount         int        `dynamodbav:"-" json:"inviteCount"`                                       // Calculated at runtime: total users invited
	InviteLimit         int        `dynamodbav:"-" json:"inviteLimit"`                                       // System configuration: max invites allowed
	CreatedAt           time.Time  `dynamodbav:"createdAt" json:"createdAt"`
	UpdatedAt           time.Time  `dynamodbav:"updatedAt" json:"updatedAt"`
}

// UserPreferences represents user notification preferences
type UserPreferences struct {
	NotifyNewGames    bool `dynamodbav:"notifyNewGames" json:"notifyNewGames"`
	NotifyGameUpdates bool `dynamodbav:"notifyGameUpdates" json:"notifyGameUpdates"`
}

// Registration represents a registration for a game
type Registration struct {
	RegistrationID   string       `dynamodbav:"registrationId" json:"registrationId"`
	GameID           string       `dynamodbav:"gameId" json:"gameId"`
	UserID           string       `dynamodbav:"userId" json:"userId"`
	DisplayName      string       `dynamodbav:"displayName" json:"displayName"`
	PictureURL       string       `dynamodbav:"-" json:"pictureUrl,omitempty"`
	Status           string       `dynamodbav:"status" json:"status"` // "pending", "accepted", "rejected", "cancelled"
	Message          string       `dynamodbav:"message,omitempty" json:"message,omitempty"`
	NotificationSent bool         `dynamodbav:"notificationSent" json:"notificationSent"` // 是否已推送通知
	CreatedAt        int64        `dynamodbav:"createdAt" json:"createdAt"`               // Unix timestamp for GSI
	UpdatedAt        FlexibleTime `dynamodbav:"updatedAt" json:"updatedAt"`
}

// --- Community System Models ---

// Post represents a community post
type Post struct {
	PostID       string   `dynamodbav:"postId" json:"postId"`                     // PK: POST#<UUID>
	SortKey      string   `dynamodbav:"sortKey" json:"sortKey"`                   // SK: METADATA
	AuthorID     string   `dynamodbav:"authorId" json:"authorId"`                 // USER#<UserID>
	AuthorName   string   `dynamodbav:"-" json:"authorName,omitempty"`            // From Users table
	AuthorAvatar string   `dynamodbav:"-" json:"authorAvatar,omitempty"`          // From Users table
	Content      string   `dynamodbav:"content" json:"content"`                   // JSON or Markdown string
	ContentType  string   `dynamodbav:"contentType" json:"contentType"`           // "markdown" or "json"
	Images       []string `dynamodbav:"images,omitempty" json:"images,omitempty"` // S3 URLs
	Tags         []string `dynamodbav:"tags,omitempty" json:"tags,omitempty"`
	LikeCount    int      `dynamodbav:"likeCount" json:"likeCount"`
	CommentCount int      `dynamodbav:"commentCount" json:"commentCount"`
	CreatedAt    string   `dynamodbav:"createdAt" json:"createdAt"` // ISO8601 for sorting
	UpdatedAt    string   `dynamodbav:"updatedAt" json:"updatedAt"` // ISO8601
	IsLikedByMe  bool     `dynamodbav:"-" json:"isLikedByMe"`       // Contextual per-user
}

// Comment represents a comment on a post
type Comment struct {
	PostID       string `dynamodbav:"postId" json:"postId"`            // PK: POST#<PostID>
	SortKey      string `dynamodbav:"sortKey" json:"sortKey"`          // SK: COMMENT#<Timestamp>#<UUID>
	AuthorID     string `dynamodbav:"authorId" json:"authorId"`        // USER#<UserID>
	AuthorName   string `dynamodbav:"-" json:"authorName,omitempty"`   // From Users table
	AuthorAvatar string `dynamodbav:"-" json:"authorAvatar,omitempty"` // From Users table
	Content      string `dynamodbav:"content" json:"content"`
	LikeCount    int    `dynamodbav:"likeCount" json:"likeCount"`
	CreatedAt    string `dynamodbav:"createdAt" json:"createdAt"` // ISO8601
	IsAuthor     bool   `dynamodbav:"-" json:"isAuthor"`          // authorId == post.authorId
	IsLikedByMe  bool   `dynamodbav:"-" json:"isLikedByMe"`       // Contextual per-user
}

// Like represents a like record
type Like struct {
	TargetID  string `dynamodbav:"targetId" json:"targetId"` // PK: POST#<PostID> or COMMENT#<CommentID>
	UserID    string `dynamodbav:"userId" json:"userId"`     // SK: USER#<UserID>
	CreatedAt string `dynamodbav:"createdAt" json:"createdAt"`
}

// Notification represents a notification
type Notification struct {
	NotificationID string `dynamodbav:"notificationId" json:"notificationId"`
	UserID         string `dynamodbav:"userId" json:"userId"`
	Type           string `dynamodbav:"type" json:"type"` // registration, approval, rejection, cancellation, community_comment, community_like
	Title          string `dynamodbav:"title" json:"title"`
	Message        string `dynamodbav:"message" json:"message"`
	GameID         string `dynamodbav:"gameId,omitempty" json:"gameId,omitempty"`
	GameName       string `dynamodbav:"gameName,omitempty" json:"gameName,omitempty"`
	PostID         string `dynamodbav:"postId,omitempty" json:"postId,omitempty"`
	FromUserID     string `dynamodbav:"fromUserId,omitempty" json:"fromUserId,omitempty"`
	FromUserName   string `dynamodbav:"fromUserName,omitempty" json:"fromUserName,omitempty"`
	IsRead         bool   `dynamodbav:"isRead" json:"isRead"`
	CreatedAt      int64  `dynamodbav:"createdAt" json:"createdAt"`
	ExpiresAt      int64  `dynamodbav:"expiresAt,omitempty" json:"expiresAt,omitempty"`
}

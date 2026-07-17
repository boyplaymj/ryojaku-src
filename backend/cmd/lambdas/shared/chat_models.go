package shared

import (
	"time"
)

type ChatMembership struct {
	UserID               string `dynamodbav:"UserID" json:"userId"`
	MessageTimeAndRoom   string `dynamodbav:"LastMessageTime#RoomID" json:"lastMessageTime#roomId"`
	RoomID               string `dynamodbav:"RoomID" json:"roomId"`
	Title                string `dynamodbav:"Title" json:"title"`
	LastMessage          string `dynamodbav:"LastMessage" json:"lastMessage"`
	UnreadCount          int    `dynamodbav:"UnreadCount" json:"unreadCount"`
	ExpiryTime           int64  `dynamodbav:"ExpiryTime" json:"expiryTime"`
	StartTime            string `dynamodbav:"StartTime" json:"startTime"`
	Address              string `dynamodbav:"Address" json:"address"`
	LastMessageTimestamp int64  `dynamodbav:"LastMessageTimestamp" json:"lastMessageTimestamp"`
}

type ChatRoomMetadata struct {
	RoomID     string    `dynamodbav:"RoomID" json:"roomId"`
	GameID     string    `dynamodbav:"GameID" json:"gameId"`
	Title      string    `dynamodbav:"Title" json:"title"`
	StartTime  string    `dynamodbav:"StartTime" json:"startTime"`
	Address    string    `dynamodbav:"Address" json:"address"`
	MemberIDs  []string  `dynamodbav:"MemberIDs,stringset" json:"memberIds"`
	ExpiryTime int64     `dynamodbav:"ExpiryTime" json:"expiryTime"`
	CreatedAt  time.Time `dynamodbav:"CreatedAt" json:"createdAt"`
}

type ChatMessageRecord struct {
	RoomID      string `dynamodbav:"RoomID" json:"roomId"`
	TimestampID string `dynamodbav:"Timestamp#MessageID" json:"timestampId"`
	SenderID    string `dynamodbav:"SenderID" json:"senderId"`
	SenderName  string `dynamodbav:"SenderName" json:"senderName"`
	Content     string `dynamodbav:"Content" json:"content"`
	Type        string `dynamodbav:"Type" json:"type"` // "text", "system", "game_link"
	TTL         int64  `dynamodbav:"TTL" json:"ttl"`
}

type ChatConnectionRecord struct {
	ConnectionID string `dynamodbav:"ConnectionID" json:"connectionId"`
	UserID       string `dynamodbav:"UserID" json:"userId"`
	ConnectedAt  int64  `dynamodbav:"ConnectedAt" json:"connectedAt"`
}

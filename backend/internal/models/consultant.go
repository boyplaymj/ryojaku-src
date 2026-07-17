package models

import "time"

// Consultant represents a relationship consultant
type Consultant struct {
	ID          string    `json:"id" dynamodbav:"id"`
	Name        string    `json:"name" dynamodbav:"name"`
	Nickname    string    `json:"nickname" dynamodbav:"nickname"`
	Personality string    `json:"personality" dynamodbav:"personality"`
	SpeakingStyle string  `json:"speaking_style" dynamodbav:"speaking_style"`
	Specialties []string  `json:"specialties" dynamodbav:"specialties"`
	Description string    `json:"description" dynamodbav:"description"`
	IsActive    bool      `json:"is_active" dynamodbav:"is_active"`
	CreatedAt   time.Time `json:"created_at" dynamodbav:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" dynamodbav:"updated_at"`
}

// ConsultationSession represents an active consultation session
type ConsultationSession struct {
	ID           string    `json:"id" dynamodbav:"id"`
	UserID       string    `json:"user_id" dynamodbav:"user_id"`
	ConsultantID string    `json:"consultant_id" dynamodbav:"consultant_id"`
	Status       string    `json:"status" dynamodbav:"status"` // "active", "waiting", "completed", "cancelled"
	StartTime    time.Time `json:"start_time" dynamodbav:"start_time"`
	EndTime      *time.Time `json:"end_time,omitempty" dynamodbav:"end_time"`
	Duration     int       `json:"duration" dynamodbav:"duration"` // in minutes
	CreatedAt    time.Time `json:"created_at" dynamodbav:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" dynamodbav:"updated_at"`
}

// ConversationRecord represents a conversation record between user and consultant
type ConversationRecord struct {
	ID           string    `json:"id" dynamodbav:"id"`
	SessionID    string    `json:"session_id" dynamodbav:"session_id"`
	UserID       string    `json:"user_id" dynamodbav:"user_id"`
	ConsultantID string    `json:"consultant_id" dynamodbav:"consultant_id"`
	MessageType  string    `json:"message_type" dynamodbav:"message_type"` // "user", "consultant"
	Message      string    `json:"message" dynamodbav:"message"`
	Timestamp    time.Time `json:"timestamp" dynamodbav:"timestamp"`
}

// SessionStatus constants
const (
	SessionStatusActive    = "active"
	SessionStatusWaiting   = "waiting"
	SessionStatusCompleted = "completed"
	SessionStatusCancelled = "cancelled"
)

// MessageType constants
const (
	MessageTypeUser       = "user"
	MessageTypeConsultant = "consultant"
)

package services

import (
	"fmt"
	"log"
	"strings"
	"time"

	"mahjongclub-backend/internal/models"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/dynamodb"
	"github.com/aws/aws-sdk-go/service/dynamodb/dynamodbattribute"
)

// ConversationService provides conversation record operations
type ConversationService struct {
	db *DatabaseService
}

// NewConversationService creates a new conversation service instance
func NewConversationService(db *DatabaseService) *ConversationService {
	return &ConversationService{
		db: db,
	}
}

// SaveMessage saves a conversation message
func (s *ConversationService) SaveMessage(sessionID, userID, consultantID, messageType, message string) error {
	record := &models.ConversationRecord{
		ID:           generateMessageID(),
		SessionID:    sessionID,
		UserID:       userID,
		ConsultantID: consultantID,
		MessageType:  messageType,
		Message:      message,
		Timestamp:    time.Now(),
	}

	av, err := dynamodbattribute.MarshalMap(record)
	if err != nil {
		log.Printf("Failed to marshal conversation record: %v", err)
		return err
	}

	input := &dynamodb.PutItemInput{
		TableName: aws.String(lineBotTable("Conversation-Records")),
		Item:      av,
	}

	_, err = s.db.client.PutItem(input)
	if err != nil {
		log.Printf("Failed to save conversation record: %v", err)
		return err
	}

	log.Printf("Successfully saved conversation record for session: %s", sessionID)
	return nil
}

// GetSessionHistory retrieves conversation history for a session
func (s *ConversationService) GetSessionHistory(sessionID string) ([]models.ConversationRecord, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(lineBotTable("Conversation-Records")),
		IndexName:              aws.String("SessionTimestampIndex"),
		KeyConditionExpression: aws.String("session_id = :session_id"),
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":session_id": {
				S: aws.String(sessionID),
			},
		},
		ScanIndexForward: aws.Bool(true), // Sort by timestamp ascending
	}

	result, err := s.db.client.Query(input)
	if err != nil {
		log.Printf("Failed to get session history: %v", err)
		return nil, err
	}

	var records []models.ConversationRecord
	err = dynamodbattribute.UnmarshalListOfMaps(result.Items, &records)
	if err != nil {
		log.Printf("Failed to unmarshal conversation records: %v", err)
		return nil, err
	}

	return records, nil
}

// GetUserConsultantHistory retrieves conversation history between a user and consultant
func (s *ConversationService) GetUserConsultantHistory(userID, consultantID string, limit int) ([]models.ConversationRecord, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(lineBotTable("Conversation-Records")),
		IndexName:              aws.String("UserConsultantIndex"),
		KeyConditionExpression: aws.String("user_id = :user_id AND consultant_id = :consultant_id"),
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":user_id": {
				S: aws.String(userID),
			},
			":consultant_id": {
				S: aws.String(consultantID),
			},
		},
		ScanIndexForward: aws.Bool(false), // Sort by timestamp descending (newest first)
		Limit:            aws.Int64(int64(limit)),
	}

	result, err := s.db.client.Query(input)
	if err != nil {
		log.Printf("Failed to get user-consultant history: %v", err)
		return nil, err
	}

	var records []models.ConversationRecord
	err = dynamodbattribute.UnmarshalListOfMaps(result.Items, &records)
	if err != nil {
		log.Printf("Failed to unmarshal conversation records: %v", err)
		return nil, err
	}

	// Reverse to get chronological order (oldest first)
	for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
		records[i], records[j] = records[j], records[i]
	}

	return records, nil
}

// GetUserConsultantHistoryByDays retrieves conversation history between a user and consultant within specified days
func (s *ConversationService) GetUserConsultantHistoryByDays(userID, consultantID string, days int) ([]models.ConversationRecord, error) {
	// Calculate the timestamp for N days ago (RFC3339 format for string comparison)
	cutoffTime := time.Now().AddDate(0, 0, -days)
	cutoffTimeStr := cutoffTime.Format(time.RFC3339)

	input := &dynamodb.QueryInput{
		TableName:              aws.String(lineBotTable("Conversation-Records")),
		IndexName:              aws.String("UserConsultantIndex"),
		KeyConditionExpression: aws.String("user_id = :user_id AND consultant_id = :consultant_id"),
		FilterExpression:       aws.String("#ts >= :cutoff_time"),
		ExpressionAttributeNames: map[string]*string{
			"#ts": aws.String("timestamp"),
		},
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":user_id": {
				S: aws.String(userID),
			},
			":consultant_id": {
				S: aws.String(consultantID),
			},
			":cutoff_time": {
				S: aws.String(cutoffTimeStr),
			},
		},
		ScanIndexForward: aws.Bool(false), // Sort by timestamp descending (newest first)
	}

	result, err := s.db.client.Query(input)
	if err != nil {
		log.Printf("Failed to get user-consultant history by days: %v", err)
		return nil, err
	}

	var records []models.ConversationRecord
	err = dynamodbattribute.UnmarshalListOfMaps(result.Items, &records)
	if err != nil {
		log.Printf("Failed to unmarshal conversation records: %v", err)
		return nil, err
	}

	// Reverse to get chronological order (oldest first)
	for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
		records[i], records[j] = records[j], records[i]
	}

	log.Printf("Retrieved %d conversation records from last %d days for user %s and consultant %s", len(records), days, userID, consultantID)
	return records, nil
}

// FormatConversationHistory formats conversation records into a readable string
func (s *ConversationService) FormatConversationHistory(records []models.ConversationRecord) string {
	if len(records) == 0 {
		return "第一次聊天"
	}

	var history strings.Builder
	history.WriteString("之前聊過：\n")

	// Only show last few messages to keep context short
	start := 0
	if len(records) > 6 {
		start = len(records) - 6
	}

	for i := start; i < len(records); i++ {
		record := records[i]
		if record.MessageType == models.MessageTypeUser {
			history.WriteString(fmt.Sprintf("用戶：%s\n", record.Message))
		} else {
			history.WriteString(fmt.Sprintf("你：%s\n", record.Message))
		}
	}

	return history.String()
}

// GetRecentConversationContext gets recent conversation context for AI
func (s *ConversationService) GetRecentConversationContext(userID, consultantID string) (string, error) {
	records, err := s.GetUserConsultantHistory(userID, consultantID, 6) // Get last 6 messages only
	if err != nil {
		return "", err
	}

	return s.FormatConversationHistory(records), nil
}

// DeleteSessionHistory deletes all conversation records for a session
func (s *ConversationService) DeleteSessionHistory(sessionID string) error {
	// First, get all records for the session
	records, err := s.GetSessionHistory(sessionID)
	if err != nil {
		return err
	}

	// Delete each record
	for _, record := range records {
		input := &dynamodb.DeleteItemInput{
			TableName: aws.String(lineBotTable("Conversation-Records")),
			Key: map[string]*dynamodb.AttributeValue{
				"id": {
					S: aws.String(record.ID),
				},
			},
		}

		_, err := s.db.client.DeleteItem(input)
		if err != nil {
			log.Printf("Failed to delete conversation record %s: %v", record.ID, err)
			return err
		}
	}

	log.Printf("Successfully deleted %d conversation records for session: %s", len(records), sessionID)
	return nil
}

// GetConversationStats gets conversation statistics for a user-consultant pair
func (s *ConversationService) GetConversationStats(userID, consultantID string) (map[string]interface{}, error) {
	records, err := s.GetUserConsultantHistory(userID, consultantID, 1000) // Get all records
	if err != nil {
		return nil, err
	}

	stats := map[string]interface{}{
		"total_messages":      len(records),
		"user_messages":       0,
		"consultant_messages": 0,
		"first_conversation":  "",
		"last_conversation":   "",
	}

	if len(records) == 0 {
		return stats, nil
	}

	// Count messages by type
	for _, record := range records {
		if record.MessageType == models.MessageTypeUser {
			stats["user_messages"] = stats["user_messages"].(int) + 1
		} else {
			stats["consultant_messages"] = stats["consultant_messages"].(int) + 1
		}
	}

	// Set first and last conversation dates
	stats["first_conversation"] = records[0].Timestamp.Format("2006-01-02 15:04:05")
	stats["last_conversation"] = records[len(records)-1].Timestamp.Format("2006-01-02 15:04:05")

	return stats, nil
}

// SearchConversationHistory searches for messages containing specific keywords
func (s *ConversationService) SearchConversationHistory(userID, consultantID, keyword string) ([]models.ConversationRecord, error) {
	records, err := s.GetUserConsultantHistory(userID, consultantID, 100)
	if err != nil {
		return nil, err
	}

	var matchingRecords []models.ConversationRecord
	keyword = strings.ToLower(keyword)

	for _, record := range records {
		if strings.Contains(strings.ToLower(record.Message), keyword) {
			matchingRecords = append(matchingRecords, record)
		}
	}

	return matchingRecords, nil
}

// GetConversationSummary creates a summary of recent conversations for AI context
func (s *ConversationService) GetConversationSummary(userID, consultantID string, maxMessages int) (string, error) {
	records, err := s.GetUserConsultantHistory(userID, consultantID, maxMessages)
	if err != nil {
		return "", err
	}

	if len(records) == 0 {
		return "這是你們的第一次對話。", nil
	}

	var summary strings.Builder
	summary.WriteString(fmt.Sprintf("最近 %d 條對話記錄摘要：\n", len(records)))

	for _, record := range records {
		role := "用戶"
		if record.MessageType == models.MessageTypeConsultant {
			role = "諮詢師"
		}

		// Truncate long messages for summary
		message := record.Message
		if len(message) > 50 {
			message = message[:50] + "..."
		}

		summary.WriteString(fmt.Sprintf("- %s: %s\n", role, message))
	}

	return summary.String(), nil
}

// generateMessageID generates a unique message ID
func generateMessageID() string {
	return fmt.Sprintf("msg_%d", time.Now().UnixNano())
}

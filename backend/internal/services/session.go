package services

import (
	"fmt"
	"log"
	"time"

	"mahjongclub-backend/internal/models"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/dynamodb"
	"github.com/aws/aws-sdk-go/service/dynamodb/dynamodbattribute"
)

// SessionService provides session management operations
type SessionService struct {
	db *DatabaseService
}

// NewSessionService creates a new session service instance
func NewSessionService(db *DatabaseService) *SessionService {
	return &SessionService{
		db: db,
	}
}

// CreateSession creates a new consultation session
func (s *SessionService) CreateSession(userID, consultantID string, duration int) (*models.ConsultationSession, error) {
	session := &models.ConsultationSession{
		ID:           generateSessionID(),
		UserID:       userID,
		ConsultantID: consultantID,
		Status:       models.SessionStatusWaiting,
		StartTime:    time.Now(),
		Duration:     duration,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	av, err := dynamodbattribute.MarshalMap(session)
	if err != nil {
		log.Printf("Failed to marshal session: %v", err)
		return nil, err
	}

	input := &dynamodb.PutItemInput{
		TableName: aws.String("LineBot-Consultation-Sessions"),
		Item:      av,
	}

	_, err = s.db.client.PutItem(input)
	if err != nil {
		log.Printf("Failed to create session: %v", err)
		return nil, err
	}

	log.Printf("Successfully created session: %s", session.ID)
	return session, nil
}

// GetActiveSession retrieves the active session for a user
func (s *SessionService) GetActiveSession(userID string) (*models.ConsultationSession, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String("LineBot-Consultation-Sessions"),
		IndexName:              aws.String("UserStatusIndex"),
		KeyConditionExpression: aws.String("user_id = :user_id AND #status = :status"),
		ExpressionAttributeNames: map[string]*string{
			"#status": aws.String("status"),
		},
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":user_id": {
				S: aws.String(userID),
			},
			":status": {
				S: aws.String(models.SessionStatusActive),
			},
		},
		Limit: aws.Int64(1),
	}

	result, err := s.db.client.Query(input)
	if err != nil {
		log.Printf("Failed to get active session: %v", err)
		return nil, err
	}

	if len(result.Items) == 0 {
		return nil, nil // No active session
	}

	var session models.ConsultationSession
	err = dynamodbattribute.UnmarshalMap(result.Items[0], &session)
	if err != nil {
		log.Printf("Failed to unmarshal session: %v", err)
		return nil, err
	}

	return &session, nil
}

// StartSession activates a waiting session
func (s *SessionService) StartSession(sessionID string) error {
	now := time.Now()

	input := &dynamodb.UpdateItemInput{
		TableName: aws.String("LineBot-Consultation-Sessions"),
		Key: map[string]*dynamodb.AttributeValue{
			"id": {
				S: aws.String(sessionID),
			},
		},
		UpdateExpression: aws.String("SET #status = :status, start_time = :start_time, updated_at = :updated_at"),
		ExpressionAttributeNames: map[string]*string{
			"#status": aws.String("status"),
		},
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":status": {
				S: aws.String(models.SessionStatusActive),
			},
			":start_time": {
				S: aws.String(now.Format(time.RFC3339)),
			},
			":updated_at": {
				S: aws.String(now.Format(time.RFC3339)),
			},
		},
	}

	_, err := s.db.client.UpdateItem(input)
	if err != nil {
		log.Printf("Failed to start session: %v", err)
		return err
	}

	log.Printf("Successfully started session: %s", sessionID)
	return nil
}

// EndSession completes a session
func (s *SessionService) EndSession(sessionID string) error {
	now := time.Now()

	input := &dynamodb.UpdateItemInput{
		TableName: aws.String("LineBot-Consultation-Sessions"),
		Key: map[string]*dynamodb.AttributeValue{
			"id": {
				S: aws.String(sessionID),
			},
		},
		UpdateExpression: aws.String("SET #status = :status, end_time = :end_time, updated_at = :updated_at"),
		ExpressionAttributeNames: map[string]*string{
			"#status": aws.String("status"),
		},
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":status": {
				S: aws.String(models.SessionStatusCompleted),
			},
			":end_time": {
				S: aws.String(now.Format(time.RFC3339)),
			},
			":updated_at": {
				S: aws.String(now.Format(time.RFC3339)),
			},
		},
	}

	_, err := s.db.client.UpdateItem(input)
	if err != nil {
		log.Printf("Failed to end session: %v", err)
		return err
	}

	log.Printf("Successfully ended session: %s", sessionID)
	return nil
}

// GetWaitingQueue retrieves waiting sessions for a consultant
func (s *SessionService) GetWaitingQueue(consultantID string) ([]models.ConsultationSession, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String("LineBot-Consultation-Sessions"),
		IndexName:              aws.String("ConsultantStatusIndex"),
		KeyConditionExpression: aws.String("consultant_id = :consultant_id AND #status = :status"),
		ExpressionAttributeNames: map[string]*string{
			"#status": aws.String("status"),
		},
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":consultant_id": {
				S: aws.String(consultantID),
			},
			":status": {
				S: aws.String(models.SessionStatusWaiting),
			},
		},
		ScanIndexForward: aws.Bool(true), // Sort by creation time
	}

	result, err := s.db.client.Query(input)
	if err != nil {
		log.Printf("Failed to get waiting queue: %v", err)
		return nil, err
	}

	var sessions []models.ConsultationSession
	err = dynamodbattribute.UnmarshalListOfMaps(result.Items, &sessions)
	if err != nil {
		log.Printf("Failed to unmarshal sessions: %v", err)
		return nil, err
	}

	return sessions, nil
}

// GetSessionByID retrieves a session by ID
func (s *SessionService) GetSessionByID(sessionID string) (*models.ConsultationSession, error) {
	result, err := s.db.client.GetItem(&dynamodb.GetItemInput{
		TableName: aws.String("LineBot-Consultation-Sessions"),
		Key: map[string]*dynamodb.AttributeValue{
			"id": {
				S: aws.String(sessionID),
			},
		},
	})

	if err != nil {
		log.Printf("Failed to get session: %v", err)
		return nil, err
	}

	if result.Item == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	var session models.ConsultationSession
	err = dynamodbattribute.UnmarshalMap(result.Item, &session)
	if err != nil {
		log.Printf("Failed to unmarshal session: %v", err)
		return nil, err
	}

	return &session, nil
}

// CheckSessionTimeout checks if a session has exceeded its duration
func (s *SessionService) CheckSessionTimeout(sessionID string) (bool, error) {
	session, err := s.GetSessionByID(sessionID)
	if err != nil {
		return false, err
	}

	if session.Status != models.SessionStatusActive {
		return false, nil
	}

	// Calculate if session has exceeded its duration
	elapsed := time.Since(session.StartTime)
	maxDuration := time.Duration(session.Duration) * time.Minute

	return elapsed > maxDuration, nil
}

// GetUserPosition gets user's position in the waiting queue
func (s *SessionService) GetUserPosition(userID, consultantID string) (int, error) {
	waitingQueue, err := s.GetWaitingQueue(consultantID)
	if err != nil {
		return -1, err
	}

	for i, session := range waitingQueue {
		if session.UserID == userID {
			return i + 1, nil // Position starts from 1
		}
	}

	return -1, fmt.Errorf("user not found in waiting queue")
}

// ProcessNextInQueue processes the next session in the waiting queue
func (s *SessionService) ProcessNextInQueue(consultantID string) (*models.ConsultationSession, error) {
	waitingQueue, err := s.GetWaitingQueue(consultantID)
	if err != nil {
		return nil, err
	}

	if len(waitingQueue) == 0 {
		return nil, nil // No one waiting
	}

	// Get the first session in queue (oldest)
	nextSession := waitingQueue[0]

	// Start the session
	err = s.StartSession(nextSession.ID)
	if err != nil {
		return nil, err
	}

	return &nextSession, nil
}

// CancelSession cancels a session
func (s *SessionService) CancelSession(sessionID string) error {
	now := time.Now()

	input := &dynamodb.UpdateItemInput{
		TableName: aws.String("LineBot-Consultation-Sessions"),
		Key: map[string]*dynamodb.AttributeValue{
			"id": {
				S: aws.String(sessionID),
			},
		},
		UpdateExpression: aws.String("SET #status = :status, end_time = :end_time, updated_at = :updated_at"),
		ExpressionAttributeNames: map[string]*string{
			"#status": aws.String("status"),
		},
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":status": {
				S: aws.String(models.SessionStatusCancelled),
			},
			":end_time": {
				S: aws.String(now.Format(time.RFC3339)),
			},
			":updated_at": {
				S: aws.String(now.Format(time.RFC3339)),
			},
		},
	}

	_, err := s.db.client.UpdateItem(input)
	if err != nil {
		log.Printf("Failed to cancel session: %v", err)
		return err
	}

	log.Printf("Successfully cancelled session: %s", sessionID)
	return nil
}

// GetActiveSessionByConsultant gets the active session for a consultant
func (s *SessionService) GetActiveSessionByConsultant(consultantID string) (*models.ConsultationSession, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String("LineBot-Consultation-Sessions"),
		IndexName:              aws.String("ConsultantStatusIndex"),
		KeyConditionExpression: aws.String("consultant_id = :consultant_id AND #status = :status"),
		ExpressionAttributeNames: map[string]*string{
			"#status": aws.String("status"),
		},
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":consultant_id": {
				S: aws.String(consultantID),
			},
			":status": {
				S: aws.String(models.SessionStatusActive),
			},
		},
		Limit: aws.Int64(1),
	}

	result, err := s.db.client.Query(input)
	if err != nil {
		log.Printf("Failed to get active session by consultant: %v", err)
		return nil, err
	}

	if len(result.Items) == 0 {
		return nil, nil // No active session
	}

	var session models.ConsultationSession
	err = dynamodbattribute.UnmarshalMap(result.Items[0], &session)
	if err != nil {
		log.Printf("Failed to unmarshal session: %v", err)
		return nil, err
	}

	return &session, nil
}

// generateSessionID generates a unique session ID
func generateSessionID() string {
	return fmt.Sprintf("session_%d", time.Now().UnixNano())
}

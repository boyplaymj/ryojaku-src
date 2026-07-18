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

// ConsultantService provides consultant-related operations
type ConsultantService struct {
	db *DatabaseService
}

// NewConsultantService creates a new consultant service instance
func NewConsultantService(db *DatabaseService) *ConsultantService {
	return &ConsultantService{
		db: db,
	}
}

// GetConsultant retrieves a consultant by ID
func (s *ConsultantService) GetConsultant(consultantID string) (*models.Consultant, error) {
	result, err := s.db.client.GetItem(&dynamodb.GetItemInput{
		TableName: aws.String(lineBotTable("Consultants")),
		Key: map[string]*dynamodb.AttributeValue{
			"id": {
				S: aws.String(consultantID),
			},
		},
	})

	if err != nil {
		log.Printf("Failed to get consultant: %v", err)
		return nil, err
	}

	if result.Item == nil {
		return nil, fmt.Errorf("consultant not found: %s", consultantID)
	}

	var consultant models.Consultant
	err = dynamodbattribute.UnmarshalMap(result.Item, &consultant)
	if err != nil {
		log.Printf("Failed to unmarshal consultant: %v", err)
		return nil, err
	}

	return &consultant, nil
}

// GetAvailableConsultants retrieves all active consultants
func (s *ConsultantService) GetAvailableConsultants() ([]models.Consultant, error) {
	input := &dynamodb.ScanInput{
		TableName:        aws.String(lineBotTable("Consultants")),
		FilterExpression: aws.String("is_active = :active"),
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":active": {
				BOOL: aws.Bool(true),
			},
		},
	}

	result, err := s.db.client.Scan(input)
	if err != nil {
		log.Printf("Failed to scan consultants: %v", err)
		return nil, err
	}

	var consultants []models.Consultant
	err = dynamodbattribute.UnmarshalListOfMaps(result.Items, &consultants)
	if err != nil {
		log.Printf("Failed to unmarshal consultants: %v", err)
		return nil, err
	}

	return consultants, nil
}

// CreateConsultant creates a new consultant
func (s *ConsultantService) CreateConsultant(consultant *models.Consultant) error {
	consultant.CreatedAt = time.Now()
	consultant.UpdatedAt = time.Now()

	av, err := dynamodbattribute.MarshalMap(consultant)
	if err != nil {
		log.Printf("Failed to marshal consultant: %v", err)
		return err
	}

	input := &dynamodb.PutItemInput{
		TableName: aws.String(lineBotTable("Consultants")),
		Item:      av,
	}

	_, err = s.db.client.PutItem(input)
	if err != nil {
		log.Printf("Failed to create consultant: %v", err)
		return err
	}

	log.Printf("Successfully created consultant: %s", consultant.ID)
	return nil
}

// UpdateConsultant updates an existing consultant
func (s *ConsultantService) UpdateConsultant(consultant *models.Consultant) error {
	consultant.UpdatedAt = time.Now()

	av, err := dynamodbattribute.MarshalMap(consultant)
	if err != nil {
		log.Printf("Failed to marshal consultant: %v", err)
		return err
	}

	input := &dynamodb.PutItemInput{
		TableName: aws.String(lineBotTable("Consultants")),
		Item:      av,
	}

	_, err = s.db.client.PutItem(input)
	if err != nil {
		log.Printf("Failed to update consultant: %v", err)
		return err
	}

	log.Printf("Successfully updated consultant: %s", consultant.ID)
	return nil
}

// IsConsultantAvailable checks if a consultant is available for consultation
func (s *ConsultantService) IsConsultantAvailable(consultantID string) (bool, error) {
	// Check if consultant has any active sessions using scan (temporary until ConsultantStatusIndex is ready)
	input := &dynamodb.ScanInput{
		TableName:        aws.String(lineBotTable("Consultation-Sessions")),
		FilterExpression: aws.String("consultant_id = :consultant_id AND #status = :status"),
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
	}

	result, err := s.db.client.Scan(input)
	if err != nil {
		log.Printf("Failed to check consultant availability: %v", err)
		return false, err
	}

	// If no active sessions, consultant is available
	return len(result.Items) == 0, nil
}

// GetConsultantPersonality gets the full personality description for AI prompts
func (s *ConsultantService) GetConsultantPersonality(consultantID string) (string, error) {
	consultant, err := s.GetConsultant(consultantID)
	if err != nil {
		return "", err
	}

	personality := fmt.Sprintf(`諮詢師資料：
姓名：%s
暱稱：%s
個性描述：%s
說話風格：%s
專長領域：%s

請完全按照以上設定來扮演這位諮詢師，保持一致的個性和說話風格。`,
		consultant.Name,
		consultant.Nickname,
		consultant.Personality,
		consultant.SpeakingStyle,
		strings.Join(consultant.Specialties, "、"))

	return personality, nil
}

// DeactivateConsultant deactivates a consultant
func (s *ConsultantService) DeactivateConsultant(consultantID string) error {
	input := &dynamodb.UpdateItemInput{
		TableName: aws.String(lineBotTable("Consultants")),
		Key: map[string]*dynamodb.AttributeValue{
			"id": {
				S: aws.String(consultantID),
			},
		},
		UpdateExpression: aws.String("SET is_active = :active, updated_at = :updated_at"),
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":active": {
				BOOL: aws.Bool(false),
			},
			":updated_at": {
				S: aws.String(time.Now().Format(time.RFC3339)),
			},
		},
	}

	_, err := s.db.client.UpdateItem(input)
	if err != nil {
		log.Printf("Failed to deactivate consultant: %v", err)
		return err
	}

	log.Printf("Successfully deactivated consultant: %s", consultantID)
	return nil
}

// ActivateConsultant activates a consultant
func (s *ConsultantService) ActivateConsultant(consultantID string) error {
	input := &dynamodb.UpdateItemInput{
		TableName: aws.String(lineBotTable("Consultants")),
		Key: map[string]*dynamodb.AttributeValue{
			"id": {
				S: aws.String(consultantID),
			},
		},
		UpdateExpression: aws.String("SET is_active = :active, updated_at = :updated_at"),
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":active": {
				BOOL: aws.Bool(true),
			},
			":updated_at": {
				S: aws.String(time.Now().Format(time.RFC3339)),
			},
		},
	}

	_, err := s.db.client.UpdateItem(input)
	if err != nil {
		log.Printf("Failed to activate consultant: %v", err)
		return err
	}

	log.Printf("Successfully activated consultant: %s", consultantID)
	return nil
}

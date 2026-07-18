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

// UserProfileService handles user profile operations
type UserProfileService struct {
	db *DatabaseService
}

// NewUserProfileService creates a new user profile service
func NewUserProfileService(db *DatabaseService) *UserProfileService {
	return &UserProfileService{
		db: db,
	}
}

// GetUserProfile retrieves a user's profile
func (s *UserProfileService) GetUserProfile(userID string) (*models.UserProfile, error) {
	result, err := s.db.client.GetItem(&dynamodb.GetItemInput{
		TableName: aws.String(lineBotTable("User-Profiles")),
		Key: map[string]*dynamodb.AttributeValue{
			"user_id": {
				S: aws.String(userID),
			},
		},
	})

	if err != nil {
		log.Printf("Failed to get user profile: %v", err)
		return nil, err
	}

	if result.Item == nil {
		return nil, nil // Profile doesn't exist
	}

	var profile models.UserProfile
	err = dynamodbattribute.UnmarshalMap(result.Item, &profile)
	if err != nil {
		log.Printf("Failed to unmarshal user profile: %v", err)
		return nil, err
	}

	return &profile, nil
}

// SaveUserProfile saves or updates a user's profile
func (s *UserProfileService) SaveUserProfile(profile *models.UserProfile) error {
	now := time.Now()
	profile.UpdatedAt = now

	if profile.CreatedAt.IsZero() {
		profile.CreatedAt = now
	}

	// Debug: Check individual fields before completion check
	log.Printf("Before completion check - Name='%s', BirthDate='%s', Address='%s', Gender='%s'",
		profile.Name, profile.BirthDate, profile.Address, profile.Gender)

	// Check if profile is complete
	profile.IsComplete = profile.IsProfileComplete()

	log.Printf("Saving profile data: Name=%s, BirthDate=%s, Address=%s, Gender=%s, IsComplete=%v",
		profile.Name, profile.BirthDate, profile.Address, profile.Gender, profile.IsComplete)

	av, err := dynamodbattribute.MarshalMap(profile)
	if err != nil {
		log.Printf("Failed to marshal user profile: %v", err)
		return err
	}

	log.Printf("Marshaled profile data: %+v", av)

	input := &dynamodb.PutItemInput{
		TableName: aws.String(lineBotTable("User-Profiles")),
		Item:      av,
	}

	_, err = s.db.client.PutItem(input)
	if err != nil {
		log.Printf("Failed to save user profile: %v", err)
		return err
	}

	log.Printf("Successfully saved user profile for user: %s", profile.UserID)
	return nil
}

// UpdateRedThreadURL updates the red thread URL for a user
func (s *UserProfileService) UpdateRedThreadURL(userID, redThreadURL string) error {
	now := time.Now()

	input := &dynamodb.UpdateItemInput{
		TableName: aws.String(lineBotTable("User-Profiles")),
		Key: map[string]*dynamodb.AttributeValue{
			"user_id": {
				S: aws.String(userID),
			},
		},
		UpdateExpression: aws.String("SET red_thread_url = :url, red_thread_gen_at = :gen_at, updated_at = :updated_at"),
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":url": {
				S: aws.String(redThreadURL),
			},
			":gen_at": {
				S: aws.String(now.Format(time.RFC3339)),
			},
			":updated_at": {
				S: aws.String(now.Format(time.RFC3339)),
			},
		},
	}

	_, err := s.db.client.UpdateItem(input)
	if err != nil {
		log.Printf("Failed to update red thread URL: %v", err)
		return err
	}

	log.Printf("Successfully updated red thread URL for user: %s", userID)
	return nil
}

// HasRedThread checks if user already has a red thread generated
func (s *UserProfileService) HasRedThread(userID string) (bool, string, error) {
	profile, err := s.GetUserProfile(userID)
	if err != nil {
		return false, "", err
	}

	if profile == nil {
		return false, "", nil
	}

	// Check if red thread URL exists and is not empty
	hasRedThread := profile.RedThreadURL != ""
	return hasRedThread, profile.RedThreadURL, nil
}

// GetProfileSession retrieves a user's profile completion session
func (s *UserProfileService) GetProfileSession(userID string) (*models.UserProfileSession, error) {
	result, err := s.db.client.GetItem(&dynamodb.GetItemInput{
		TableName: aws.String(lineBotTable("User-Profile-Sessions")),
		Key: map[string]*dynamodb.AttributeValue{
			"user_id": {
				S: aws.String(userID),
			},
		},
	})

	if err != nil {
		log.Printf("Failed to get profile session: %v", err)
		return nil, err
	}

	if result.Item == nil {
		return nil, nil // Session doesn't exist
	}

	var session models.UserProfileSession
	err = dynamodbattribute.UnmarshalMap(result.Item, &session)
	if err != nil {
		log.Printf("Failed to unmarshal profile session: %v", err)
		return nil, err
	}

	// Check if session has expired
	if time.Now().Unix() > session.ExpiresAt {
		// Delete expired session
		s.DeleteProfileSession(userID)
		return nil, nil
	}

	// Initialize TempData if it's nil (can happen during unmarshaling)
	if session.TempData == nil {
		session.TempData = make(map[string]string)
	}

	return &session, nil
}

// CreateProfileSession creates a new profile completion session
func (s *UserProfileService) CreateProfileSession(userID string) (*models.UserProfileSession, error) {
	now := time.Now()
	session := &models.UserProfileSession{
		UserID:      userID,
		CurrentStep: "name", // Start with name
		TempData:    make(map[string]string),
		CreatedAt:   now,
		UpdatedAt:   now,
		ExpiresAt:   now.Add(30 * time.Minute).Unix(), // 30 minutes to complete
	}

	av, err := dynamodbattribute.MarshalMap(session)
	if err != nil {
		log.Printf("Failed to marshal profile session: %v", err)
		return nil, err
	}

	input := &dynamodb.PutItemInput{
		TableName: aws.String(lineBotTable("User-Profile-Sessions")),
		Item:      av,
	}

	_, err = s.db.client.PutItem(input)
	if err != nil {
		log.Printf("Failed to create profile session: %v", err)
		return nil, err
	}

	log.Printf("Successfully created profile session for user: %s", userID)
	return session, nil
}

// UpdateProfileSession updates a profile completion session
func (s *UserProfileService) UpdateProfileSession(session *models.UserProfileSession) error {
	session.UpdatedAt = time.Now()

	av, err := dynamodbattribute.MarshalMap(session)
	if err != nil {
		log.Printf("Failed to marshal profile session: %v", err)
		return err
	}

	input := &dynamodb.PutItemInput{
		TableName: aws.String(lineBotTable("User-Profile-Sessions")),
		Item:      av,
	}

	_, err = s.db.client.PutItem(input)
	if err != nil {
		log.Printf("Failed to update profile session: %v", err)
		return err
	}

	return nil
}

// DeleteProfileSession deletes a profile completion session
func (s *UserProfileService) DeleteProfileSession(userID string) error {
	input := &dynamodb.DeleteItemInput{
		TableName: aws.String(lineBotTable("User-Profile-Sessions")),
		Key: map[string]*dynamodb.AttributeValue{
			"user_id": {
				S: aws.String(userID),
			},
		},
	}

	_, err := s.db.client.DeleteItem(input)
	if err != nil {
		log.Printf("Failed to delete profile session: %v", err)
		return err
	}

	return nil
}

// IsProfileComplete checks if user has a complete profile
func (s *UserProfileService) IsProfileComplete(userID string) (bool, error) {
	profile, err := s.GetUserProfile(userID)
	if err != nil {
		return false, err
	}

	if profile == nil {
		return false, nil
	}

	// Use the method to check if profile is actually complete
	return profile.IsProfileComplete(), nil
}

// CompleteProfileFromSession creates final profile from session data
func (s *UserProfileService) CompleteProfileFromSession(userID string) (*models.UserProfile, error) {
	session, err := s.GetProfileSession(userID)
	if err != nil {
		return nil, err
	}

	if session == nil {
		return nil, fmt.Errorf("no active profile session found")
	}

	// Create profile from session data
	profile := &models.UserProfile{
		UserID:    userID,
		Name:      session.TempData["name"],
		BirthDate: session.TempData["birth_date"],
		Address:   session.TempData["address"],
		Gender:    session.TempData["gender"],
	}

	// Save the profile
	err = s.SaveUserProfile(profile)
	if err != nil {
		return nil, err
	}

	// Delete the session
	err = s.DeleteProfileSession(userID)
	if err != nil {
		log.Printf("Failed to delete profile session after completion: %v", err)
	}

	return profile, nil
}

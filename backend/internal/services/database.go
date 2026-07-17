package services

import (
	"log"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/dynamodb"
)

// DatabaseService provides database operations
type DatabaseService struct {
	client *dynamodb.DynamoDB
}

// NewDatabaseService creates a new database service instance
func NewDatabaseService() (*DatabaseService, error) {
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String("ap-southeast-1"),
	})
	if err != nil {
		log.Printf("Failed to create AWS session: %v", err)
		return nil, err
	}

	return &DatabaseService{
		client: dynamodb.New(sess),
	}, nil
}

// GetClient returns the DynamoDB client
func (db *DatabaseService) GetClient() *dynamodb.DynamoDB {
	return db.client
}

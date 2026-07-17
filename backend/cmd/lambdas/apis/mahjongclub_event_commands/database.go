package main

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func saveEventCommand(ctx context.Context, cmd *EventCommand) error {
	tableName := tablePrefix + "EventCommands"

	item, err := attributevalue.MarshalMap(cmd)
	if err != nil {
		return fmt.Errorf("failed to marshal event command: %w", err)
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})

	if err != nil {
		return fmt.Errorf("failed to save event command: %w", err)
	}

	return nil
}

func getEventCommand(ctx context.Context, commandID string) (*EventCommand, error) {
	tableName := tablePrefix + "EventCommands"

	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"commandId": &types.AttributeValueMemberS{Value: commandID},
		},
	})

	if err != nil {
		return nil, fmt.Errorf("failed to get event command: %w", err)
	}

	if result.Item == nil {
		return nil, fmt.Errorf("event command not found")
	}

	var cmd EventCommand
	err = attributevalue.UnmarshalMap(result.Item, &cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal event command: %w", err)
	}

	return &cmd, nil
}

func getAllEventCommands(ctx context.Context) ([]*EventCommand, error) {
	tableName := tablePrefix + "EventCommands"

	result, err := dynamoClient.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	})

	if err != nil {
		return nil, fmt.Errorf("failed to scan event commands: %w", err)
	}

	var commands []*EventCommand
	err = attributevalue.UnmarshalListOfMaps(result.Items, &commands)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal event commands: %w", err)
	}

	return commands, nil
}

func checkCommandExists(ctx context.Context, command string) (bool, error) {
	tableName := tablePrefix + "EventCommands"

	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("command-index"),
		KeyConditionExpression: aws.String("command = :command"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":command": &types.AttributeValueMemberS{Value: command},
		},
		Limit: aws.Int32(1),
	})

	if err != nil {
		return false, fmt.Errorf("failed to query event command: %w", err)
	}

	return len(result.Items) > 0, nil
}

func deleteEventCommand(ctx context.Context, commandID string) error {
	tableName := tablePrefix + "EventCommands"

	_, err := dynamoClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"commandId": &types.AttributeValueMemberS{Value: commandID},
		},
	})

	if err != nil {
		return fmt.Errorf("failed to delete event command: %w", err)
	}

	return nil
}

func getEventRedemptionsByCommand(ctx context.Context, commandID string) ([]*EventRedemption, error) {
	tableName := tablePrefix + "EventRedemptions"

	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("commandId-redeemedTS-index"),
		KeyConditionExpression: aws.String("commandId = :commandId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":commandId": &types.AttributeValueMemberS{Value: commandID},
		},
		ScanIndexForward: aws.Bool(false), // Sort by redeemedTS descending
	})

	if err != nil {
		return nil, fmt.Errorf("failed to query event redemptions: %w", err)
	}

	var redemptions []*EventRedemption
	err = attributevalue.UnmarshalListOfMaps(result.Items, &redemptions)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal event redemptions: %w", err)
	}

	return redemptions, nil
}


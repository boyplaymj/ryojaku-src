package services

import (
	"fmt"
	"log"
	"strings"

	"mahjongclub-backend/internal/models"
)

// ConversationContextService manages conversation context for AI
type ConversationContextService struct {
	conversationService *ConversationService
	openaiService       *OpenAIService
}

// NewConversationContextService creates a new conversation context service
func NewConversationContextService(conversationService *ConversationService, openaiService *OpenAIService) *ConversationContextService {
	return &ConversationContextService{
		conversationService: conversationService,
		openaiService:       openaiService,
	}
}

// ConversationContext represents a conversation context for AI
type ConversationContext struct {
	SessionID    string
	UserID       string
	ConsultantID string
	Messages     []ChatMessage
	SystemPrompt string
}

// Note: ChatMessage is already defined in openai.go, we'll reuse that type

// GetConversationContext builds conversation context for AI from database records
func (s *ConversationContextService) GetConversationContext(sessionID, userID, consultantID string, consultant *models.Consultant) (*ConversationContext, error) {
	// Get conversation history from last 7 days
	records, err := s.conversationService.GetUserConsultantHistoryByDays(userID, consultantID, 7)
	if err != nil {
		log.Printf("Failed to get conversation history: %v", err)
		return nil, err
	}

	// Build system prompt
	systemPrompt := s.buildSystemPrompt(consultant)

	// Convert records to ChatMessage format
	messages := []ChatMessage{
		{
			Role:    "system",
			Content: systemPrompt,
		},
	}

	// Add conversation history as proper chat messages
	for _, record := range records {
		var role string
		if record.MessageType == models.MessageTypeUser {
			role = "user"
		} else {
			role = "assistant"
		}

		messages = append(messages, ChatMessage{
			Role:    role,
			Content: record.Message,
		})
	}

	return &ConversationContext{
		SessionID:    sessionID,
		UserID:       userID,
		ConsultantID: consultantID,
		Messages:     messages,
		SystemPrompt: systemPrompt,
	}, nil
}

// AddUserMessage adds a user message to the conversation context
func (s *ConversationContextService) AddUserMessage(context *ConversationContext, message string) {
	context.Messages = append(context.Messages, ChatMessage{
		Role:    "user",
		Content: message,
	})
}

// AddAssistantMessage adds an assistant message to the conversation context
func (s *ConversationContextService) AddAssistantMessage(context *ConversationContext, message string) {
	context.Messages = append(context.Messages, ChatMessage{
		Role:    "assistant",
		Content: message,
	})
}

// GenerateResponse generates AI response using conversation context
func (s *ConversationContextService) GenerateResponse(context *ConversationContext) (string, error) {
	// Limit context to prevent token overflow
	limitedMessages := s.limitContextSize(context.Messages, 4000) // Approximate token limit

	response, err := s.openaiService.ChatCompletion(limitedMessages, 0, 0) // Use default config values
	if err != nil {
		log.Printf("Failed to generate AI response: %v", err)
		return "", err
	}

	if len(response.Choices) == 0 {
		return "", fmt.Errorf("no response choices returned")
	}

	content := response.Choices[0].Message.Content

	// Check for empty response and provide fallback
	if strings.TrimSpace(content) == "" {
		log.Printf("Warning: GPT returned empty response, using fallback")
		content = "抱歉，我需要一點時間思考。請再說一次你的問題？"
	}

	return content, nil
}

// SaveConversationTurn saves both user and assistant messages to database
func (s *ConversationContextService) SaveConversationTurn(context *ConversationContext, userMessage, assistantMessage string) error {
	// Save user message
	err := s.conversationService.SaveMessage(
		context.SessionID,
		context.UserID,
		context.ConsultantID,
		models.MessageTypeUser,
		userMessage,
	)
	if err != nil {
		return fmt.Errorf("failed to save user message: %v", err)
	}

	// Save assistant message
	err = s.conversationService.SaveMessage(
		context.SessionID,
		context.UserID,
		context.ConsultantID,
		models.MessageTypeConsultant,
		assistantMessage,
	)
	if err != nil {
		return fmt.Errorf("failed to save assistant message: %v", err)
	}

	return nil
}

// buildSystemPrompt builds the system prompt for the consultant
func (s *ConversationContextService) buildSystemPrompt(consultant *models.Consultant) string {
	// Get the system prompt template from OpenAI config
	template := s.openaiService.config.SystemPromptTemplate

	// Replace placeholders
	systemPrompt := strings.ReplaceAll(template, "{consultant_name}", consultant.Name)
	systemPrompt = strings.ReplaceAll(systemPrompt, "{consultant_nickname}", consultant.Nickname)
	systemPrompt = strings.ReplaceAll(systemPrompt, "{consultant_personality}", consultant.Personality)
	systemPrompt = strings.ReplaceAll(systemPrompt, "{consultant_speaking_style}", consultant.SpeakingStyle)

	// Remove conversation history and user message placeholders since we use proper chat format
	systemPrompt = strings.ReplaceAll(systemPrompt, "{conversation_history}", "")
	systemPrompt = strings.ReplaceAll(systemPrompt, "{user_message}", "")

	// Clean up extra newlines
	systemPrompt = strings.TrimSpace(systemPrompt)

	return systemPrompt
}

// limitContextSize limits the conversation context to prevent token overflow
func (s *ConversationContextService) limitContextSize(messages []ChatMessage, maxTokens int) []ChatMessage {
	if len(messages) <= 1 {
		return messages // Always keep system message
	}

	// Rough estimation: 1 token ≈ 4 characters for Chinese text
	estimatedTokens := 0
	systemMessage := messages[0] // Always keep system message
	estimatedTokens += len(systemMessage.Content) / 4

	// Start from the most recent messages and work backwards
	var conversationMessages []ChatMessage

	for i := len(messages) - 1; i >= 1; i-- {
		messageTokens := len(messages[i].Content) / 4
		if estimatedTokens+messageTokens > maxTokens {
			break
		}
		estimatedTokens += messageTokens
		conversationMessages = append([]ChatMessage{messages[i]}, conversationMessages...)
	}

	// Build final result: system message first, then conversation history
	result := []ChatMessage{systemMessage}
	result = append(result, conversationMessages...)

	log.Printf("Limited context from %d to %d messages (estimated %d tokens)", len(messages), len(result), estimatedTokens)
	return result
}

// GetConversationSummary generates a summary of the conversation for long-term memory
func (s *ConversationContextService) GetConversationSummary(userID, consultantID string) (string, error) {
	records, err := s.conversationService.GetUserConsultantHistory(userID, consultantID, 50)
	if err != nil {
		return "", err
	}

	if len(records) == 0 {
		return "第一次對話", nil
	}

	// Build conversation text for summarization
	var conversation strings.Builder
	for _, record := range records {
		if record.MessageType == models.MessageTypeUser {
			conversation.WriteString(fmt.Sprintf("用戶：%s\n", record.Message))
		} else {
			conversation.WriteString(fmt.Sprintf("諮詢師：%s\n", record.Message))
		}
	}

	// Use AI to generate summary
	summaryPrompt := fmt.Sprintf(`請總結以下對話的重點，包括：
1. 用戶的主要問題和困擾
2. 諮詢師給出的建議
3. 對話的進展和結果

對話內容：
%s

請用簡潔的方式總結（不超過200字）：`, conversation.String())

	messages := []ChatMessage{
		{
			Role:    "system",
			Content: "你是一個專業的對話總結助手，能夠準確提取對話重點。",
		},
		{
			Role:    "user",
			Content: summaryPrompt,
		},
	}

	response, err := s.openaiService.ChatCompletion(messages, 300, 0.3)
	if err != nil {
		log.Printf("Failed to generate conversation summary: %v", err)
		return "對話總結生成失敗", nil
	}

	if len(response.Choices) == 0 {
		return "無法生成對話總結", nil
	}

	return response.Choices[0].Message.Content, nil
}

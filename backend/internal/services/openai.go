package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/dynamodb"
)

// OpenAIConfig represents the OpenAI configuration
type OpenAIConfig struct {
	Model                    string                 `json:"model"`
	Temperature              float64                `json:"temperature"`
	MaxTokens                int                    `json:"max_tokens"`
	MaxCompletionTokens      int                    `json:"max_completion_tokens"`
	TopP                     float64                `json:"top_p"`
	FrequencyPenalty         float64                `json:"frequency_penalty"`
	PresencePenalty          float64                `json:"presence_penalty"`
	SystemPromptTemplate     string                 `json:"system_prompt_template"`
	ConversationContextLimit int                    `json:"conversation_context_limit"`
	ResponseGuidelines       map[string]interface{} `json:"response_guidelines"`
	FallbackResponses        map[string]string      `json:"fallback_responses"`
	SpecialCommands          map[string][]string    `json:"special_commands"`
}

// OpenAIService provides OpenAI API integration
type OpenAIService struct {
	apiKey string
	client *http.Client
	config *OpenAIConfig
	db     *DatabaseService
}

// ChatMessage represents a chat message for OpenAI API
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest represents the request to OpenAI chat API
type ChatRequest struct {
	Model               string        `json:"model"`
	Messages            []ChatMessage `json:"messages"`
	MaxTokens           int           `json:"max_tokens,omitempty"`
	MaxCompletionTokens int           `json:"max_completion_tokens,omitempty"`
	Temperature         float64       `json:"temperature,omitempty"`
	TopP                float64       `json:"top_p,omitempty"`
	FrequencyPenalty    float64       `json:"frequency_penalty,omitempty"`
	PresencePenalty     float64       `json:"presence_penalty,omitempty"`
	ReasoningEffort     string        `json:"reasoning_effort,omitempty"`
}

// ChatResponse represents the response from OpenAI chat API
type ChatResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index   int `json:"index"`
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// loadOpenAIConfig loads the OpenAI configuration from file
func loadOpenAIConfig() (*OpenAIConfig, error) {
	configPath := filepath.Join(".", "openai-config.json")

	// Try different possible paths
	possiblePaths := []string{
		configPath,
		"../openai-config.json",
		"../../openai-config.json",
		"../../../openai-config.json",
	}

	var configData []byte
	var err error

	for _, path := range possiblePaths {
		configData, err = os.ReadFile(path)
		if err == nil {
			log.Printf("Loaded OpenAI config from: %s", path)
			break
		}
	}

	if err != nil {
		log.Printf("Could not load OpenAI config file, using defaults: %v", err)
		// Return default configuration
		return &OpenAIConfig{
			Model:                    "gpt-4o-mini",
			Temperature:              0.8,
			MaxTokens:                500,
			TopP:                     0.9,
			FrequencyPenalty:         0.1,
			PresencePenalty:          0.1,
			SystemPromptTemplate:     "你是一位專業的感情諮詢師，名字是{consultant_name}，暱稱是{consultant_nickname}。{consultant_personality}\n\n說話風格：{consultant_speaking_style}\n\n請根據以下對話歷史和用戶的新訊息，以你的角色身份回應。\n\n對話歷史：\n{conversation_history}\n\n用戶新訊息：{user_message}\n\n請以{consultant_nickname}的身份回應：",
			ConversationContextLimit: 10,
			ResponseGuidelines:       map[string]interface{}{"max_length": 300, "tone": "supportive_and_caring"},
			FallbackResponses:        map[string]string{"error": "抱歉，我現在有點忙碌，請稍後再試。"},
			SpecialCommands:          map[string][]string{"end_session": {"結束諮詢", "結束", "謝謝", "再見"}},
		}, nil
	}

	var config OpenAIConfig
	if err := json.Unmarshal(configData, &config); err != nil {
		return nil, fmt.Errorf("failed to parse OpenAI config: %v", err)
	}

	return &config, nil
}

// NewOpenAIService creates a new OpenAI service instance
func NewOpenAIService(db *DatabaseService) (*OpenAIService, error) {
	apiKey := os.Getenv("OPENAI_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("OPENAI_KEY environment variable is required")
	}

	service := &OpenAIService{
		apiKey: apiKey,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		db: db,
	}

	config, err := service.loadOpenAIConfigFromDB()
	if err != nil {
		log.Printf("Failed to load config from DB, using defaults: %v", err)
		config = service.getDefaultConfig()
	}
	service.config = config

	return service, nil
}

// ChatCompletion sends a chat completion request to OpenAI
func (s *OpenAIService) ChatCompletion(messages []ChatMessage, maxTokens int, temperature float64) (*ChatResponse, error) {
	// Use config values if parameters are 0 (default)
	if maxTokens == 0 {
		maxTokens = s.config.MaxTokens
	}
	if temperature == 0 {
		temperature = s.config.Temperature
	}

	request := ChatRequest{
		Model:    s.config.Model,
		Messages: messages,
	}

	// GPT-5 models have special requirements
	if strings.HasPrefix(s.config.Model, "gpt-5") {
		// GPT-5 requires reasoning_effort parameter for optimal performance
		request.ReasoningEffort = "minimal"
		// Use higher token limit for GPT-5 due to reasoning overhead
		if s.config.MaxCompletionTokens > 0 {
			request.MaxCompletionTokens = s.config.MaxCompletionTokens
		} else {
			request.MaxCompletionTokens = 500 // Higher default for GPT-5
		}
	} else {
		// Non-GPT-5 models support these parameters
		request.Temperature = temperature
		request.TopP = s.config.TopP
		request.FrequencyPenalty = s.config.FrequencyPenalty
		request.PresencePenalty = s.config.PresencePenalty

		// Use appropriate token parameter for non-GPT-5 models
		if s.config.MaxCompletionTokens > 0 {
			request.MaxCompletionTokens = s.config.MaxCompletionTokens
		} else if s.config.MaxTokens > 0 {
			request.MaxTokens = s.config.MaxTokens
		} else {
			request.MaxTokens = maxTokens
		}
	}

	jsonData, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %v", err)
	}

	req, err := http.NewRequest("POST", "https://api.openai.com/v1/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.apiKey)

	log.Printf("Sending OpenAI request with %d messages", len(messages))

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("OpenAI API error: %s", string(body))
		return nil, fmt.Errorf("OpenAI API returned status %d: %s", resp.StatusCode, string(body))
	}

	var response ChatResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %v", err)
	}

	log.Printf("OpenAI response received with %d choices", len(response.Choices))
	return &response, nil
}

// GenerateResponse generates a simple response using OpenAI
func (s *OpenAIService) GenerateResponse(prompt string, maxTokens int) (string, error) {
	messages := []ChatMessage{
		{
			Role:    "user",
			Content: prompt,
		},
	}

	request := &ChatRequest{
		Model:    s.config.Model,
		Messages: messages,
	}

	// Set appropriate token limit based on model
	if strings.HasPrefix(s.config.Model, "gpt-5") {
		request.MaxCompletionTokens = maxTokens
		request.ReasoningEffort = "minimal"
	} else {
		request.MaxTokens = maxTokens
	}

	response, err := s.ChatCompletion(messages, maxTokens, 0.7)
	if err != nil {
		return "", err
	}

	if len(response.Choices) == 0 {
		return "", fmt.Errorf("no response choices received")
	}

	return strings.TrimSpace(response.Choices[0].Message.Content), nil
}

// GenerateConsultantResponse generates a response from a consultant using OpenAI
func (s *OpenAIService) GenerateConsultantResponse(consultantName, consultantNickname, consultantPersonality, consultantSpeakingStyle, conversationHistory, userMessage string) (string, error) {
	// Use the configured system prompt template
	systemPrompt := s.config.SystemPromptTemplate
	systemPrompt = strings.ReplaceAll(systemPrompt, "{consultant_name}", consultantName)
	systemPrompt = strings.ReplaceAll(systemPrompt, "{consultant_nickname}", consultantNickname)
	systemPrompt = strings.ReplaceAll(systemPrompt, "{consultant_personality}", consultantPersonality)
	systemPrompt = strings.ReplaceAll(systemPrompt, "{consultant_speaking_style}", consultantSpeakingStyle)
	systemPrompt = strings.ReplaceAll(systemPrompt, "{conversation_history}", conversationHistory)
	systemPrompt = strings.ReplaceAll(systemPrompt, "{user_message}", userMessage)

	messages := []ChatMessage{
		{
			Role:    "system",
			Content: systemPrompt,
		},
		{
			Role:    "user",
			Content: userMessage,
		},
	}

	response, err := s.ChatCompletion(messages, s.config.MaxTokens, s.config.Temperature)
	if err != nil {
		// Return fallback response on error
		if fallback, exists := s.config.FallbackResponses["error"]; exists {
			return fallback, nil
		}
		return "抱歉，我現在有點忙碌，請稍後再試。", nil
	}

	if len(response.Choices) == 0 {
		if fallback, exists := s.config.FallbackResponses["no_context"]; exists {
			return fallback, nil
		}
		return "很高興認識你！有什麼感情問題想要聊聊嗎？", nil
	}

	return response.Choices[0].Message.Content, nil
}

// loadOpenAIConfigFromDB loads OpenAI configuration from DynamoDB
func (s *OpenAIService) loadOpenAIConfigFromDB() (*OpenAIConfig, error) {
	config := &OpenAIConfig{}

	// Load OpenAI settings
	settingsResult, err := s.db.client.GetItem(&dynamodb.GetItemInput{
		TableName: aws.String(lineBotTable("OpenAI-Config")),
		Key: map[string]*dynamodb.AttributeValue{
			"config_key": {
				S: aws.String("openai_settings"),
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get openai_settings: %v", err)
	}

	if settingsResult.Item != nil {
		if val, ok := settingsResult.Item["model"]; ok && val.S != nil {
			config.Model = *val.S
		}
		if val, ok := settingsResult.Item["temperature"]; ok && val.N != nil {
			if temp, err := strconv.ParseFloat(*val.N, 64); err == nil {
				config.Temperature = temp
			}
		}
		if val, ok := settingsResult.Item["max_tokens"]; ok && val.N != nil {
			if tokens, err := strconv.Atoi(*val.N); err == nil {
				config.MaxTokens = tokens
			}
		}
		if val, ok := settingsResult.Item["max_completion_tokens"]; ok && val.N != nil {
			if tokens, err := strconv.Atoi(*val.N); err == nil {
				config.MaxCompletionTokens = tokens
			}
		}
		if val, ok := settingsResult.Item["top_p"]; ok && val.N != nil {
			if topP, err := strconv.ParseFloat(*val.N, 64); err == nil {
				config.TopP = topP
			}
		}
		if val, ok := settingsResult.Item["frequency_penalty"]; ok && val.N != nil {
			if penalty, err := strconv.ParseFloat(*val.N, 64); err == nil {
				config.FrequencyPenalty = penalty
			}
		}
		if val, ok := settingsResult.Item["presence_penalty"]; ok && val.N != nil {
			if penalty, err := strconv.ParseFloat(*val.N, 64); err == nil {
				config.PresencePenalty = penalty
			}
		}
		if val, ok := settingsResult.Item["conversation_context_limit"]; ok && val.N != nil {
			if limit, err := strconv.Atoi(*val.N); err == nil {
				config.ConversationContextLimit = limit
			}
		}
	}

	// Load system prompt template
	templateResult, err := s.db.client.GetItem(&dynamodb.GetItemInput{
		TableName: aws.String(lineBotTable("OpenAI-Config")),
		Key: map[string]*dynamodb.AttributeValue{
			"config_key": {
				S: aws.String("system_prompt_template"),
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get system_prompt_template: %v", err)
	}

	if templateResult.Item != nil {
		if val, ok := templateResult.Item["template"]; ok && val.S != nil {
			config.SystemPromptTemplate = *val.S
		}
	}

	// Load response guidelines
	guidelinesResult, err := s.db.client.GetItem(&dynamodb.GetItemInput{
		TableName: aws.String(lineBotTable("OpenAI-Config")),
		Key: map[string]*dynamodb.AttributeValue{
			"config_key": {
				S: aws.String("response_guidelines"),
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get response_guidelines: %v", err)
	}

	if guidelinesResult.Item != nil {
		guidelines := make(map[string]interface{})
		for key, val := range guidelinesResult.Item {
			if key == "config_key" {
				continue
			}
			if val.N != nil {
				if num, err := strconv.Atoi(*val.N); err == nil {
					guidelines[key] = num
				}
			} else if val.S != nil {
				guidelines[key] = *val.S
			} else if val.BOOL != nil {
				guidelines[key] = *val.BOOL
			}
		}
		config.ResponseGuidelines = guidelines
	}

	// Load fallback responses
	fallbackResult, err := s.db.client.GetItem(&dynamodb.GetItemInput{
		TableName: aws.String(lineBotTable("OpenAI-Config")),
		Key: map[string]*dynamodb.AttributeValue{
			"config_key": {
				S: aws.String("fallback_responses"),
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get fallback_responses: %v", err)
	}

	if fallbackResult.Item != nil {
		fallbacks := make(map[string]string)
		for key, val := range fallbackResult.Item {
			if key == "config_key" {
				continue
			}
			if val.S != nil {
				fallbacks[key] = *val.S
			}
		}
		config.FallbackResponses = fallbacks
	}

	// Load special commands
	commandsResult, err := s.db.client.GetItem(&dynamodb.GetItemInput{
		TableName: aws.String(lineBotTable("OpenAI-Config")),
		Key: map[string]*dynamodb.AttributeValue{
			"config_key": {
				S: aws.String("special_commands"),
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get special_commands: %v", err)
	}

	if commandsResult.Item != nil {
		commands := make(map[string][]string)
		for key, val := range commandsResult.Item {
			if key == "config_key" {
				continue
			}
			if val.SS != nil {
				var stringSlice []string
				for _, s := range val.SS {
					if s != nil {
						stringSlice = append(stringSlice, *s)
					}
				}
				commands[key] = stringSlice
			}
		}
		config.SpecialCommands = commands
	}

	return config, nil
}

// getDefaultConfig returns default OpenAI configuration
func (s *OpenAIService) getDefaultConfig() *OpenAIConfig {
	return &OpenAIConfig{
		Model:                    "gpt-4o-mini",
		Temperature:              0.9,
		MaxTokens:                150,
		TopP:                     0.95,
		FrequencyPenalty:         0.3,
		PresencePenalty:          0.2,
		SystemPromptTemplate:     "你是{consultant_nickname}，一位{consultant_personality}的感情諮詢師。{consultant_speaking_style}\n\n重要規則：\n- 回應要簡短（1-3句話）\n- 用口語化表達，像朋友聊天\n- 不要寫長篇大論\n- 可以用「嗯」「哦」「對啊」等語助詞\n- 適時加入emoji表情\n- 先理解情緒，再給建議\n\n對話記錄：{conversation_history}\n\n用戶說：{user_message}\n\n{consultant_nickname}回應：",
		ConversationContextLimit: 6,
		ResponseGuidelines:       map[string]interface{}{"max_length": 80, "tone": "casual_and_friendly", "include_emoji": true, "use_colloquial_language": true, "short_sentences": true, "empathy_first": true},
		FallbackResponses:        map[string]string{"error": "哎呀，我這邊有點卡住了，等等再試試看好嗎？😅", "no_context": "嗨～我是你的諮詢師！有什麼想聊的嗎？😊", "session_timeout": "時間到囉～有需要的話隨時再找我聊！💕"},
		SpecialCommands:          map[string][]string{"end_session": {"結束諮詢", "結束", "謝謝", "再見"}, "status_check": {"狀態", "時間", "剩餘時間"}, "help": {"幫助", "說明", "怎麼用"}},
	}
}

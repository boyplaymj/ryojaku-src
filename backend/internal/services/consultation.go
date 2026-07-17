package services

import (
	"fmt"
	"log"
	"time"

	"mahjongclub-backend/internal/models"
)

// ConsultationService provides consultation management operations
type ConsultationService struct {
	consultantService          *ConsultantService
	sessionService             *SessionService
	conversationService        *ConversationService
	conversationContextService *ConversationContextService
	openaiService              *OpenAIService
	typingDelayService         *TypingDelayService
}

// NewConsultationService creates a new consultation service instance
func NewConsultationService(
	consultantService *ConsultantService,
	sessionService *SessionService,
	conversationService *ConversationService,
	openaiService *OpenAIService,
) *ConsultationService {
	// Create conversation context service
	conversationContextService := NewConversationContextService(conversationService, openaiService)

	return &ConsultationService{
		consultantService:          consultantService,
		sessionService:             sessionService,
		conversationService:        conversationService,
		conversationContextService: conversationContextService,
		openaiService:              openaiService,
		typingDelayService:         NewTypingDelayService(),
	}
}

// StartConsultation starts a new consultation session
func (s *ConsultationService) StartConsultation(userID, consultantID string, duration int) (*models.ConsultationSession, error) {
	// Check if consultant is available
	available, err := s.consultantService.IsConsultantAvailable(consultantID)
	if err != nil {
		return nil, err
	}

	// Create session (will be in waiting status if consultant is busy)
	session, err := s.sessionService.CreateSession(userID, consultantID, duration)
	if err != nil {
		return nil, err
	}

	// If consultant is available, start the session immediately
	if available {
		err = s.sessionService.StartSession(session.ID)
		if err != nil {
			return nil, err
		}
		session.Status = models.SessionStatusActive
		log.Printf("Started consultation session immediately: %s", session.ID)
	} else {
		log.Printf("Added user to waiting queue for consultant %s", consultantID)
	}

	return session, nil
}

// ProcessUserMessage processes a user message in an active consultation
func (s *ConsultationService) ProcessUserMessage(userID, message string) (string, error) {
	// Get user's active session
	session, err := s.sessionService.GetActiveSession(userID)
	if err != nil {
		return "", err
	}

	if session == nil {
		return "您目前沒有進行中的諮詢會話。請先選擇諮詢師開始諮詢。", nil
	}

	// Check if session has timed out
	timedOut, err := s.sessionService.CheckSessionTimeout(session.ID)
	if err != nil {
		return "", err
	}

	if timedOut {
		// End the session
		err = s.sessionService.EndSession(session.ID)
		if err != nil {
			log.Printf("Failed to end timed out session: %v", err)
		}

		// Process next in queue
		_, err = s.sessionService.ProcessNextInQueue(session.ConsultantID)
		if err != nil {
			log.Printf("Failed to process next in queue: %v", err)
		}

		return "您的諮詢時間已結束。感謝您的使用！", nil
	}

	// Get consultant information
	consultant, err := s.consultantService.GetConsultant(session.ConsultantID)
	if err != nil {
		return "", err
	}

	// Get conversation context (includes history as proper chat messages)
	context, err := s.conversationContextService.GetConversationContext(
		session.ID,
		userID,
		session.ConsultantID,
		consultant,
	)
	if err != nil {
		log.Printf("Failed to get conversation context: %v", err)
		return "抱歉，我現在有點忙，請稍後再試。", nil
	}

	// Add current user message to context
	s.conversationContextService.AddUserMessage(context, message)

	// Generate AI response using conversation context
	response, err := s.conversationContextService.GenerateResponse(context)
	if err != nil {
		log.Printf("Failed to generate AI response: %v", err)
		return "抱歉，我現在有點忙，請稍後再試。", nil
	}

	// Simulate human typing delay based on response length
	log.Printf("Simulating typing delay for response from %s", consultant.Nickname)
	s.typingDelayService.SimulateTyping(response)

	// Save both user and assistant messages to database
	err = s.conversationContextService.SaveConversationTurn(context, message, response)
	if err != nil {
		log.Printf("Failed to save conversation turn: %v", err)
	}

	return response, nil
}

// EndConsultation ends a consultation session
func (s *ConsultationService) EndConsultation(userID string) error {
	// Get user's active session
	session, err := s.sessionService.GetActiveSession(userID)
	if err != nil {
		return err
	}

	if session == nil {
		return fmt.Errorf("no active session found for user")
	}

	// End the session
	err = s.sessionService.EndSession(session.ID)
	if err != nil {
		return err
	}

	// Process next in queue
	nextSession, err := s.sessionService.ProcessNextInQueue(session.ConsultantID)
	if err != nil {
		log.Printf("Failed to process next in queue: %v", err)
	} else if nextSession != nil {
		log.Printf("Started next session in queue: %s", nextSession.ID)
	}

	return nil
}

// GetUserSessionStatus gets the current session status for a user
func (s *ConsultationService) GetUserSessionStatus(userID string) (map[string]interface{}, error) {
	// Check for active session
	activeSession, err := s.sessionService.GetActiveSession(userID)
	if err != nil {
		return nil, err
	}

	status := map[string]interface{}{
		"has_active_session": false,
		"session_id":         "",
		"consultant_id":      "",
		"consultant_name":    "",
		"start_time":         "",
		"remaining_time":     0,
		"queue_position":     0,
	}

	if activeSession != nil {
		consultant, err := s.consultantService.GetConsultant(activeSession.ConsultantID)
		if err != nil {
			return nil, err
		}

		elapsed := time.Since(activeSession.StartTime)
		maxDuration := time.Duration(activeSession.Duration) * time.Minute
		remaining := maxDuration - elapsed

		status["has_active_session"] = true
		status["session_id"] = activeSession.ID
		status["consultant_id"] = activeSession.ConsultantID
		status["consultant_name"] = consultant.Name
		status["start_time"] = activeSession.StartTime.Format("2006-01-02 15:04:05")
		status["remaining_time"] = int(remaining.Minutes())

		return status, nil
	}

	// Check for waiting sessions
	consultants, err := s.consultantService.GetAvailableConsultants()
	if err != nil {
		return status, nil
	}

	for _, consultant := range consultants {
		position, err := s.sessionService.GetUserPosition(userID, consultant.ID)
		if err == nil && position > 0 {
			status["queue_position"] = position
			status["consultant_id"] = consultant.ID
			status["consultant_name"] = consultant.Name
			break
		}
	}

	return status, nil
}

// GetAvailableConsultants gets all available consultants with their status
func (s *ConsultationService) GetAvailableConsultants() ([]map[string]interface{}, error) {
	consultants, err := s.consultantService.GetAvailableConsultants()
	if err != nil {
		return nil, err
	}

	var result []map[string]interface{}

	for _, consultant := range consultants {
		available, err := s.consultantService.IsConsultantAvailable(consultant.ID)
		if err != nil {
			log.Printf("Failed to check consultant availability: %v", err)
			continue
		}

		queueLength := 0
		if !available {
			waitingQueue, err := s.sessionService.GetWaitingQueue(consultant.ID)
			if err == nil {
				queueLength = len(waitingQueue)
			}
		}

		consultantInfo := map[string]interface{}{
			"id":           consultant.ID,
			"name":         consultant.Name,
			"nickname":     consultant.Nickname,
			"description":  consultant.Description,
			"specialties":  consultant.Specialties,
			"available":    available,
			"queue_length": queueLength,
		}

		result = append(result, consultantInfo)
	}

	return result, nil
}

package services

import (
	"log"
	"time"
	"unicode/utf8"
)

// TypingDelayService provides human-like typing delay calculations
type TypingDelayService struct {
	baseDelayPerChar time.Duration // Base delay per character (100ms)
	minDelay         time.Duration // Minimum delay (0.5 second)
	maxDelay         time.Duration // Maximum delay (3 seconds)
}

// NewTypingDelayService creates a new typing delay service
func NewTypingDelayService() *TypingDelayService {
	return &TypingDelayService{
		baseDelayPerChar: 100 * time.Millisecond, // 100ms per character (faster)
		minDelay:         500 * time.Millisecond, // Minimum 0.5 second
		maxDelay:         3 * time.Second,        // Maximum 3 seconds
	}
}

// CalculateTypingDelay calculates the typing delay based on response length
func (s *TypingDelayService) CalculateTypingDelay(response string) time.Duration {
	// Count characters (including Chinese characters)
	charCount := utf8.RuneCountInString(response)

	// Calculate base delay
	delay := time.Duration(charCount) * s.baseDelayPerChar

	// Apply minimum and maximum constraints
	if delay < s.minDelay {
		delay = s.minDelay
	}
	if delay > s.maxDelay {
		delay = s.maxDelay
	}

	log.Printf("Calculated typing delay: %d characters = %.2f seconds", charCount, delay.Seconds())
	return delay
}

// SimulateTyping simulates human typing by waiting for the calculated delay
func (s *TypingDelayService) SimulateTyping(response string) {
	delay := s.CalculateTypingDelay(response)
	log.Printf("Simulating typing delay of %.2f seconds for response: %s", delay.Seconds(), response[:min(50, len(response))])
	time.Sleep(delay)
}

// min helper function for Go versions that don't have it built-in
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

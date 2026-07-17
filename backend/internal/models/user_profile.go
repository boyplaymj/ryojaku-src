package models

import "time"

// UserProfile represents a user's personal information for matchmaker services
type UserProfile struct {
	UserID         string    `json:"user_id" dynamodbav:"user_id"`
	Name           string    `json:"name" dynamodbav:"name"`
	BirthDate      string    `json:"birth_date" dynamodbav:"birth_date"` // Format: YYYY-MM-DD
	Address        string    `json:"address" dynamodbav:"address"`
	Gender         string    `json:"gender" dynamodbav:"gender"`                       // "男" or "女"
	IsComplete     bool      `json:"is_complete" dynamodbav:"is_complete"`             // Whether profile is complete
	RedThreadURL   string    `json:"red_thread_url" dynamodbav:"red_thread_url"`       // S3 URL of personalized red thread image
	RedThreadGenAt time.Time `json:"red_thread_gen_at" dynamodbav:"red_thread_gen_at"` // When red thread was generated
	CreatedAt      time.Time `json:"created_at" dynamodbav:"created_at"`
	UpdatedAt      time.Time `json:"updated_at" dynamodbav:"updated_at"`
}

// UserProfileSession represents a profile completion session
type UserProfileSession struct {
	UserID      string            `json:"user_id" dynamodbav:"user_id"`
	CurrentStep string            `json:"current_step" dynamodbav:"current_step"` // "name", "birth_date", "address", "gender", "completed"
	TempData    map[string]string `json:"temp_data" dynamodbav:"temp_data"`       // Temporary data during completion
	CreatedAt   time.Time         `json:"created_at" dynamodbav:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at" dynamodbav:"updated_at"`
	ExpiresAt   int64             `json:"expires_at" dynamodbav:"expires_at"` // Session expiry (Unix timestamp)
}

// ProfileCompletionSteps defines the order of profile completion
var ProfileCompletionSteps = []string{
	"name",
	"birth_date",
	"address",
	"gender",
	"completed",
}

// GetNextStep returns the next step in profile completion
func (p *UserProfileSession) GetNextStep() string {
	for i, step := range ProfileCompletionSteps {
		if step == p.CurrentStep && i < len(ProfileCompletionSteps)-1 {
			return ProfileCompletionSteps[i+1]
		}
	}
	return "completed"
}

// IsProfileComplete checks if all required fields are filled
func (p *UserProfile) IsProfileComplete() bool {
	return p.Name != "" && p.Name != "空字串" &&
		p.BirthDate != "" && p.BirthDate != "空字串" &&
		p.Address != "" && p.Address != "空字串" &&
		p.Gender != "" && p.Gender != "空字串"
}

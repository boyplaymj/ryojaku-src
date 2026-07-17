package services

import (
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"mahjongclub-backend/internal/models"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
)

// SmartFormService handles intelligent form completion using GPT
type SmartFormService struct {
	userProfileService *UserProfileService
	openaiService      *OpenAIService
}

// NewSmartFormService creates a new smart form service
func NewSmartFormService(userProfileService *UserProfileService, openaiService *OpenAIService) *SmartFormService {
	return &SmartFormService{
		userProfileService: userProfileService,
		openaiService:      openaiService,
	}
}

// ProcessProfileCompletion handles profile completion conversation
func (s *SmartFormService) ProcessProfileCompletion(userID, userMessage string) (string, bool, error) {
	// Get or create profile session
	session, err := s.userProfileService.GetProfileSession(userID)
	if err != nil {
		return "", false, err
	}

	if session == nil {
		// Create new session
		session, err = s.userProfileService.CreateProfileSession(userID)
		if err != nil {
			return "", false, err
		}
	}

	// Process user input based on current step
	response, isComplete, err := s.processStepInput(session, userMessage)
	if err != nil {
		return "", false, err
	}

	// Update session
	err = s.userProfileService.UpdateProfileSession(session)
	if err != nil {
		return "", false, err
	}

	return response, isComplete, nil
}

// processStepInput processes user input for the current step
func (s *SmartFormService) processStepInput(session *models.UserProfileSession, userMessage string) (string, bool, error) {
	switch session.CurrentStep {
	case "name":
		return s.processNameInput(session, userMessage)
	case "birth_date":
		return s.processBirthDateInput(session, userMessage)
	case "address":
		return s.processAddressInput(session, userMessage)
	case "gender":
		return s.processGenderInput(session, userMessage)
	default:
		return "資料填寫過程發生錯誤，請重新開始。", false, nil
	}
}

// processNameInput processes name input
func (s *SmartFormService) processNameInput(session *models.UserProfileSession, userMessage string) (string, bool, error) {
	// Extract name using GPT
	extractedName, err := s.extractNameWithGPT(userMessage)
	if err != nil {
		return "抱歉，我無法理解您的姓名，請再說一次您的姓名。", false, err
	}

	if extractedName == "" {
		return "請告訴我您的姓名，例如：「我叫王小明」或直接說「王小明」", false, nil
	}

	// Save name and move to next step
	session.TempData["name"] = extractedName
	session.CurrentStep = session.GetNextStep()

	return fmt.Sprintf("好的，%s，請告訴我您的生日，可以是國曆或農曆，例如：「我的生日是1990年5月15日」", extractedName), false, nil
}

// processBirthDateInput processes birth date input
func (s *SmartFormService) processBirthDateInput(session *models.UserProfileSession, userMessage string) (string, bool, error) {
	// Extract birth date using GPT
	extractedDate, err := s.extractBirthDateWithGPT(userMessage)
	if err != nil {
		return "抱歉，我無法理解您的生日，請再說一次您的生日。", false, err
	}

	if extractedDate == "" {
		return "請告訴我您的生日，例如：「1990年5月15日」或「民國79年5月15日」", false, nil
	}

	// Save birth date and move to next step
	session.TempData["birth_date"] = extractedDate
	session.CurrentStep = session.GetNextStep()

	return "謝謝！請告訴我您的地址，例如：「我住在台北市大安區」", false, nil
}

// processAddressInput processes address input
func (s *SmartFormService) processAddressInput(session *models.UserProfileSession, userMessage string) (string, bool, error) {
	// Extract address using GPT
	extractedAddress, err := s.extractAddressWithGPT(userMessage)
	if err != nil {
		return "抱歉，我無法理解您的地址，請再說一次您的地址。", false, err
	}

	if extractedAddress == "" {
		return "請告訴我您的地址，例如：「台北市大安區」或「我住在高雄市」", false, nil
	}

	// Save address and move to next step
	session.TempData["address"] = extractedAddress
	session.CurrentStep = session.GetNextStep()

	return "最後，請告訴我您的性別，例如：「我是男生」或「女」", false, nil
}

// processGenderInput processes gender input
func (s *SmartFormService) processGenderInput(session *models.UserProfileSession, userMessage string) (string, bool, error) {
	// Extract gender using simple pattern matching
	gender := s.extractGender(userMessage)
	if gender == "" {
		return "請告訴我您的性別，例如：「男」、「女」、「我是男生」或「我是女生」", false, nil
	}

	// Save gender and complete profile
	session.TempData["gender"] = gender
	session.CurrentStep = "completed"

	// Update session in database first before completing profile
	err := s.userProfileService.UpdateProfileSession(session)
	if err != nil {
		return "資料儲存時發生錯誤，請稍後再試。", false, err
	}

	// Create final profile
	profile, err := s.userProfileService.CompleteProfileFromSession(session.UserID)
	if err != nil {
		return "資料儲存時發生錯誤，請稍後再試。", false, err
	}

	// Generate worship card
	worshipCard := s.generateWorshipCard(profile)

	return fmt.Sprintf("太好了！您的資料已經完整填寫完畢。\n\n%s\n\n現在您可以使用「月老」指令來開始使用月老的各項功能了！", worshipCard), true, nil
}

// extractNameWithGPT uses GPT to extract name from user message
func (s *SmartFormService) extractNameWithGPT(userMessage string) (string, error) {
	prompt := fmt.Sprintf(`請從以下用戶訊息中提取姓名，只回傳姓名，如果無法提取則回傳空字串：

用戶訊息："%s"

請只回傳姓名，不要有其他文字。`, userMessage)

	response, err := s.openaiService.GenerateResponse(prompt, 50)
	if err != nil {
		return "", err
	}

	name := strings.TrimSpace(response)
	// Simple validation - name should be 2-10 characters
	if len([]rune(name)) >= 2 && len([]rune(name)) <= 10 {
		return name, nil
	}

	return "", nil
}

// extractBirthDateWithGPT uses GPT to extract birth date from user message
func (s *SmartFormService) extractBirthDateWithGPT(userMessage string) (string, error) {
	prompt := fmt.Sprintf(`請從以下用戶訊息中提取生日，轉換為YYYY-MM-DD格式，如果是民國年請轉換為西元年，如果無法提取則回傳空字串：

用戶訊息："%s"

請只回傳日期（YYYY-MM-DD格式），不要有其他文字。`, userMessage)

	response, err := s.openaiService.GenerateResponse(prompt, 50)
	if err != nil {
		return "", err
	}

	date := strings.TrimSpace(response)
	// Validate date format YYYY-MM-DD
	matched, _ := regexp.MatchString(`^\d{4}-\d{2}-\d{2}$`, date)
	if matched {
		return date, nil
	}

	return "", nil
}

// extractAddressWithGPT uses GPT to extract address from user message
func (s *SmartFormService) extractAddressWithGPT(userMessage string) (string, error) {
	prompt := fmt.Sprintf(`請從以下用戶訊息中提取地址資訊。

用戶訊息："%s"

規則：
1. 如果訊息包含明確的地址（如：台北市、高雄市、新北市、台中市等），請提取完整地址
2. 如果訊息不包含任何地址資訊，請回傳 "NONE"
3. 只回傳地址本身，不要有其他文字

範例：
- "我住在台北市大安區" → "台北市大安區"
- "台中市西屯區" → "台中市西屯區"
- "我是男生" → "NONE"
- "好的" → "NONE"`, userMessage)

	response, err := s.openaiService.GenerateResponse(prompt, 100)
	if err != nil {
		return "", err
	}

	address := strings.TrimSpace(response)

	// Check if GPT returned NONE or empty
	if address == "NONE" || address == "" {
		return "", nil
	}

	// Validate address contains common location indicators
	locationIndicators := []string{"市", "縣", "區", "鄉", "鎮", "村", "路", "街", "巷", "號"}
	hasLocationIndicator := false
	for _, indicator := range locationIndicators {
		if strings.Contains(address, indicator) {
			hasLocationIndicator = true
			break
		}
	}

	// Address should be at least 3 characters and contain location indicators
	if len([]rune(address)) >= 3 && hasLocationIndicator {
		return address, nil
	}

	return "", nil
}

// extractGender extracts gender from user message using pattern matching
func (s *SmartFormService) extractGender(userMessage string) string {
	log.Printf("DEBUG extractGender: original message='%s', bytes=%v", userMessage, []byte(userMessage))
	message := strings.ToLower(userMessage)
	log.Printf("DEBUG extractGender: lowercased message='%s', bytes=%v", message, []byte(message))

	// Check for male indicators
	malePatterns := []string{"男", "男生", "男性", "先生", "boy", "male", "man"}
	for _, pattern := range malePatterns {
		log.Printf("DEBUG extractGender: checking pattern='%s' in message='%s'", pattern, message)
		if strings.Contains(message, pattern) {
			log.Printf("DEBUG extractGender: found male pattern '%s', returning '男'", pattern)
			return "男"
		}
	}

	// Check for female indicators
	femalePatterns := []string{"女", "女生", "女性", "小姐", "girl", "female", "woman"}
	for _, pattern := range femalePatterns {
		log.Printf("DEBUG extractGender: checking pattern='%s' in message='%s'", pattern, message)
		if strings.Contains(message, pattern) {
			log.Printf("DEBUG extractGender: found female pattern '%s', returning '女'", pattern)
			return "女"
		}
	}

	log.Printf("DEBUG extractGender: no gender pattern found, returning empty string")
	return ""
}

// generateWorshipCard generates the worship card text
func (s *SmartFormService) generateWorshipCard(profile *models.UserProfile) string {
	genderTitle := "善男"
	if profile.Gender == "女" {
		genderTitle = "信女"
	}

	today := time.Now().Format("2006年01月02日")

	return fmt.Sprintf(`🙏 參拜祈願卡 🙏

%s %s，今天第一次來參拜，
我的生日是%s，
住在%s，今天是%s，
%s %s 懇請月老幫忙

願月老牽起良緣紅線 💕`,
		genderTitle, profile.Name,
		profile.BirthDate,
		profile.Address,
		today,
		genderTitle, profile.Name)
}

// GenerateWorshipCardFlexMessage generates a professional pink-themed flex message for worship card
func (s *SmartFormService) GenerateWorshipCardFlexMessage(profile *models.UserProfile) *messaging_api.FlexMessage {
	genderTitle := "善男"
	if profile.Gender == "女" {
		genderTitle = "信女"
	}

	today := time.Now().Format("2006年01月02日")

	flexContainer := &messaging_api.FlexBubble{
		Size: "kilo",
		Header: &messaging_api.FlexBox{
			Layout:          "vertical",
			BackgroundColor: "#FFE4E6",
			PaddingAll:      "20px",
			Contents: []messaging_api.FlexComponentInterface{
				&messaging_api.FlexText{
					Text:   "🙏 參拜祈願卡 🙏",
					Weight: "bold",
					Size:   "xl",
					Color:  "#D91A72",
					Align:  "center",
				},
			},
		},
		Body: &messaging_api.FlexBox{
			Layout:          "vertical",
			BackgroundColor: "#FFF7F8",
			PaddingAll:      "20px",
			Spacing:         "md",
			Contents: []messaging_api.FlexComponentInterface{
				&messaging_api.FlexText{
					Text:  fmt.Sprintf("%s %s，今天第一次來參拜，", genderTitle, profile.Name),
					Size:  "md",
					Color: "#8B5A6B",
					Wrap:  true,
				},
				&messaging_api.FlexText{
					Text:  fmt.Sprintf("我的生日是%s，", profile.BirthDate),
					Size:  "md",
					Color: "#8B5A6B",
					Wrap:  true,
				},
				&messaging_api.FlexText{
					Text:  fmt.Sprintf("住在%s，今天是%s，", profile.Address, today),
					Size:  "md",
					Color: "#8B5A6B",
					Wrap:  true,
				},
				&messaging_api.FlexText{
					Text:  fmt.Sprintf("%s %s 懇請月老幫忙", genderTitle, profile.Name),
					Size:  "md",
					Color: "#8B5A6B",
					Wrap:  true,
				},
				&messaging_api.FlexSeparator{
					Margin: "lg",
					Color:  "#F8BBD9",
				},
				&messaging_api.FlexText{
					Text:   "願月老牽起良緣紅線 💕",
					Size:   "lg",
					Color:  "#D91A72",
					Weight: "bold",
					Align:  "center",
					Margin: "lg",
				},
			},
		},
		Footer: &messaging_api.FlexBox{
			Layout:          "vertical",
			BackgroundColor: "#FFE4E6",
			PaddingAll:      "15px",
			Contents: []messaging_api.FlexComponentInterface{
				&messaging_api.FlexText{
					Text:  "現在您可以使用「月老」指令來開始使用月老的各項功能了！",
					Size:  "sm",
					Color: "#8B5A6B",
					Align: "center",
					Wrap:  true,
				},
			},
		},
	}

	return &messaging_api.FlexMessage{
		AltText:  "參拜祈願卡已完成",
		Contents: flexContainer,
	}
}

// GetProfileCompletionPrompt returns the initial prompt for profile completion
func (s *SmartFormService) GetProfileCompletionPrompt() string {
	return `歡迎來到月老廟！✨

在開始使用月老的各項功能之前，需要先完成個人資料的填寫，這樣月老才能更好地為您服務。

請告訴我您的姓名，例如：「我叫王小明」或直接說「王小明」`
}

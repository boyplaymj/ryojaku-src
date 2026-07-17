package shared

// Gender constants
const (
	GenderMale   = "male"
	GenderFemale = "female"
	GenderOther  = "other"
)

// MahjongExperience constants
const (
	ExperienceBeginner     = "beginner"
	ExperienceIntermediate = "intermediate"
	ExperienceAdvanced     = "advanced"
	ExperienceExpert       = "expert"
)

// GameStatus constants
const (
	GameStatusRecruiting = "recruiting"
	GameStatusFull       = "full"
	GameStatusClosed     = "closed"
	GameStatusCancelled  = "cancelled"
	GameStatusExpired    = "expired"
)

// VerificationStatus constants
const (
	VerificationUnknown  = "unknown"
	VerificationPending  = "pending"
	VerificationVerified = "verified"
	VerificationRejected = "rejected"
)

// AgeRange constants
const (
	AgeRange18_22  = "18-22"
	AgeRange23_27  = "23-27"
	AgeRange28_32  = "28-32"
	AgeRange33_37  = "33-37"
	AgeRange38_42  = "38-42"
	AgeRange43_47  = "43-47"
	AgeRange48_52  = "48-52"
	AgeRange53_57  = "53-57"
	AgeRange58_62  = "58-62"
	AgeRange63_67  = "63-67"
	AgeRange68_72  = "68-72"
	AgeRange73_77  = "73-77"
	AgeRange78_82  = "78-82"
	AgeRange83_87  = "83-87"
	AgeRange88_92  = "88-92"
	AgeRange93_97  = "93-97"
	AgeRange98_100 = "98-100"
)

// GenderDisplayMap maps gender codes to display text
var GenderDisplayMap = map[string]string{
	GenderMale:   "男",
	GenderFemale: "女",
	GenderOther:  "其他",
}

// ExperienceDisplayMap maps experience codes to display text
var ExperienceDisplayMap = map[string]string{
	ExperienceBeginner:     "初學",
	ExperienceIntermediate: "中級",
	ExperienceAdvanced:     "高級",
	ExperienceExpert:       "專家",
}

// VerificationDisplayMap maps verification status to display text
var VerificationDisplayMap = map[string]string{
	VerificationUnknown:  "未知",
	VerificationPending:  "審核中",
	VerificationVerified: "已認證",
	VerificationRejected: "未通過",
}

// AgeRangeDisplayMap maps age range codes to display text
var AgeRangeDisplayMap = map[string]string{
	AgeRange18_22:  "18-22歲",
	AgeRange23_27:  "23-27歲",
	AgeRange28_32:  "28-32歲",
	AgeRange33_37:  "33-37歲",
	AgeRange38_42:  "38-42歲",
	AgeRange43_47:  "43-47歲",
	AgeRange48_52:  "48-52歲",
	AgeRange53_57:  "53-57歲",
	AgeRange58_62:  "58-62歲",
	AgeRange63_67:  "63-67歲",
	AgeRange68_72:  "68-72歲",
	AgeRange73_77:  "73-77歲",
	AgeRange78_82:  "78-82歲",
	AgeRange83_87:  "83-87歲",
	AgeRange88_92:  "88-92歲",
	AgeRange93_97:  "93-97歲",
	AgeRange98_100: "98-100歲",
}

// GetGenderDisplay returns the display text for a gender code
func GetGenderDisplay(code string) string {
	if display, ok := GenderDisplayMap[code]; ok {
		return display
	}
	return code
}

// GetExperienceDisplay returns the display text for an experience code
func GetExperienceDisplay(code string) string {
	if display, ok := ExperienceDisplayMap[code]; ok {
		return display
	}
	return code
}

// GetVerificationDisplay returns the display text for a verification status
func GetVerificationDisplay(code string) string {
	if display, ok := VerificationDisplayMap[code]; ok {
		return display
	}
	return code
}

// GetAgeRangeDisplay returns the display text for an age range code
func GetAgeRangeDisplay(code string) string {
	if display, ok := AgeRangeDisplayMap[code]; ok {
		return display
	}
	return code
}

// GetAllGenderOptions returns all gender options
func GetAllGenderOptions() []map[string]string {
	return []map[string]string{
		{"code": GenderMale, "display": GenderDisplayMap[GenderMale]},
		{"code": GenderFemale, "display": GenderDisplayMap[GenderFemale]},
		{"code": GenderOther, "display": GenderDisplayMap[GenderOther]},
	}
}

// GetAllExperienceOptions returns all experience options
func GetAllExperienceOptions() []map[string]string {
	return []map[string]string{
		{"code": ExperienceBeginner, "display": ExperienceDisplayMap[ExperienceBeginner]},
		{"code": ExperienceIntermediate, "display": ExperienceDisplayMap[ExperienceIntermediate]},
		{"code": ExperienceAdvanced, "display": ExperienceDisplayMap[ExperienceAdvanced]},
		{"code": ExperienceExpert, "display": ExperienceDisplayMap[ExperienceExpert]},
	}
}

// GetAllAgeRangeOptions returns all age range options
func GetAllAgeRangeOptions() []map[string]string {
	return []map[string]string{
		{"code": AgeRange18_22, "display": AgeRangeDisplayMap[AgeRange18_22]},
		{"code": AgeRange23_27, "display": AgeRangeDisplayMap[AgeRange23_27]},
		{"code": AgeRange28_32, "display": AgeRangeDisplayMap[AgeRange28_32]},
		{"code": AgeRange33_37, "display": AgeRangeDisplayMap[AgeRange33_37]},
		{"code": AgeRange38_42, "display": AgeRangeDisplayMap[AgeRange38_42]},
		{"code": AgeRange43_47, "display": AgeRangeDisplayMap[AgeRange43_47]},
		{"code": AgeRange48_52, "display": AgeRangeDisplayMap[AgeRange48_52]},
		{"code": AgeRange53_57, "display": AgeRangeDisplayMap[AgeRange53_57]},
		{"code": AgeRange58_62, "display": AgeRangeDisplayMap[AgeRange58_62]},
		{"code": AgeRange63_67, "display": AgeRangeDisplayMap[AgeRange63_67]},
		{"code": AgeRange68_72, "display": AgeRangeDisplayMap[AgeRange68_72]},
		{"code": AgeRange73_77, "display": AgeRangeDisplayMap[AgeRange73_77]},
		{"code": AgeRange78_82, "display": AgeRangeDisplayMap[AgeRange78_82]},
		{"code": AgeRange83_87, "display": AgeRangeDisplayMap[AgeRange83_87]},
		{"code": AgeRange88_92, "display": AgeRangeDisplayMap[AgeRange88_92]},
		{"code": AgeRange93_97, "display": AgeRangeDisplayMap[AgeRange93_97]},
		{"code": AgeRange98_100, "display": AgeRangeDisplayMap[AgeRange98_100]},
	}
}


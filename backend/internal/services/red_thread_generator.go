package services

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// RedThreadParams 紅線參數
type RedThreadParams struct {
	CurveIntensity float64 // 彎曲強度 0.0-1.0
	Angle          int     // 旋轉角度 0-360
	Thickness      int     // 線條粗細 1-5
	ColorShade     string  // 紅色深淺
	Pattern        string  // 線條樣式
	Length         int     // 線條長度
	Waves          int     // 波浪數量
}

// RedThreadGenerator 紅線生成器
type RedThreadGenerator struct{}

// NewRedThreadGenerator 創建紅線生成器
func NewRedThreadGenerator() *RedThreadGenerator {
	return &RedThreadGenerator{}
}

// GenerateRedThread 為用戶生成獨特的紅線SVG
func (g *RedThreadGenerator) GenerateRedThread(userID string) string {
	params := g.generateParams(userID)
	return g.createSVG(params)
}

// generateParams 根據用戶ID生成獨特參數
func (g *RedThreadGenerator) generateParams(userID string) RedThreadParams {
	// 使用MD5哈希生成穩定的隨機種子
	hash := md5.Sum([]byte(userID))
	hashStr := hex.EncodeToString(hash[:])

	// 從哈希中提取不同的數值
	seed1 := g.hashToInt(hashStr[0:8])
	seed2 := g.hashToInt(hashStr[8:16])
	seed3 := g.hashToInt(hashStr[16:24])
	seed4 := g.hashToInt(hashStr[24:32])

	return RedThreadParams{
		CurveIntensity: 0.2 + float64(seed1%60)/100.0, // 0.2-0.8
		Angle:          seed2 % 360,                   // 0-360度
		Thickness:      2 + seed3%4,                   // 2-5px
		ColorShade:     g.getRedShade(seed4),          // 不同深淺的紅色
		Pattern:        g.getPattern(seed1),           // 線條樣式
		Length:         200 + seed2%100,               // 200-300px
		Waves:          2 + seed3%4,                   // 2-5個波浪
	}
}

// hashToInt 將16進制字符串轉為整數
func (g *RedThreadGenerator) hashToInt(hexStr string) int {
	if val, err := strconv.ParseInt(hexStr, 16, 64); err == nil {
		return int(val)
	}
	return 0
}

// getRedShade 獲取紅色深淺
func (g *RedThreadGenerator) getRedShade(seed int) string {
	shades := []string{
		"#DC143C", // 深紅
		"#FF1493", // 深粉紅
		"#FF6347", // 番茄紅
		"#FF4500", // 橙紅
		"#B22222", // 火磚紅
		"#CD5C5C", // 印度紅
		"#F08080", // 淺珊瑚色
	}
	return shades[seed%len(shades)]
}

// getPattern 獲取線條樣式 - 只使用實線
func (g *RedThreadGenerator) getPattern(seed int) string {
	// 紅線應該是實線，不使用虛線樣式
	return "none"
}

// createSVG 創建SVG字符串
func (g *RedThreadGenerator) createSVG(params RedThreadParams) string {
	width := 400
	height := 300

	// 計算路徑點
	path := g.generatePath(params, width, height)

	// 構建SVG - 柔軟的紅線樣式
	svg := fmt.Sprintf(`<svg width="%d" height="%d" viewBox="0 0 %d %d" xmlns="http://www.w3.org/2000/svg">
	<defs>
		<filter id="softGlow">
			<feGaussianBlur stdDeviation="2" result="coloredBlur"/>
			<feMerge>
				<feMergeNode in="coloredBlur"/>
				<feMergeNode in="SourceGraphic"/>
			</feMerge>
		</filter>
		<linearGradient id="redGradient" x1="0%%" y1="0%%" x2="100%%" y2="0%%">
			<stop offset="0%%" style="stop-color:%s;stop-opacity:0.8"/>
			<stop offset="50%%" style="stop-color:%s;stop-opacity:1"/>
			<stop offset="100%%" style="stop-color:%s;stop-opacity:0.8"/>
		</linearGradient>
	</defs>
	<g transform="rotate(%d %d %d)">
		<path d="%s"
			  stroke="url(#redGradient)"
			  stroke-width="%d"
			  stroke-linecap="round"
			  stroke-linejoin="round"
			  fill="none"
			  filter="url(#softGlow)"
			  opacity="0.95">
		</path>
		<!-- 柔軟的紅線，無裝飾元素 -->
	</g>
</svg>`, width, height, width, height,
		params.ColorShade, params.ColorShade, params.ColorShade,
		params.Angle, width/2, height/2,
		path, params.Thickness)

	return svg
}

// generatePath 生成柔軟圓滑的紅線路徑
func (g *RedThreadGenerator) generatePath(params RedThreadParams, width, height int) string {
	centerX := float64(width) / 2
	centerY := float64(height) / 2

	// 起始點
	startX := centerX - float64(params.Length)/2
	startY := centerY

	var pathParts []string
	pathParts = append(pathParts, fmt.Sprintf("M %.2f %.2f", startX, startY))

	// 生成柔軟的波浪路徑，使用更多的貝塞爾曲線
	segments := params.Waves * 8 // 增加控制點數量讓線條更圓滑
	stepX := float64(params.Length) / float64(segments)

	// 預先計算所有點的位置
	points := make([]struct{ x, y float64 }, segments+1)
	points[0] = struct{ x, y float64 }{startX, startY}

	for i := 1; i <= segments; i++ {
		x := startX + float64(i)*stepX

		// 使用多個正弦波疊加創造更自然的曲線
		wavePhase1 := float64(i) * 2 * math.Pi / float64(segments/params.Waves)
		wavePhase2 := float64(i) * 4 * math.Pi / float64(segments/params.Waves)

		// 主波浪
		yOffset1 := math.Sin(wavePhase1) * params.CurveIntensity * 40
		// 次波浪（更細微的變化）
		yOffset2 := math.Sin(wavePhase2) * params.CurveIntensity * 15

		y := centerY + yOffset1 + yOffset2
		points[i] = struct{ x, y float64 }{x, y}
	}

	// 使用三次貝塞爾曲線連接所有點，創造柔軟的線條
	for i := 1; i < len(points); i++ {
		if i == 1 {
			// 第一段使用二次貝塞爾曲線
			controlX := (points[0].x + points[1].x) / 2
			controlY := (points[0].y + points[1].y) / 2
			pathParts = append(pathParts, fmt.Sprintf("Q %.2f %.2f %.2f %.2f",
				controlX, controlY, points[1].x, points[1].y))
		} else {
			// 後續使用平滑的三次貝塞爾曲線
			prevPoint := points[i-1]
			currPoint := points[i]

			// 計算控制點，讓曲線更平滑
			cp1X := prevPoint.x + stepX*0.3
			cp1Y := prevPoint.y
			cp2X := currPoint.x - stepX*0.3
			cp2Y := currPoint.y

			pathParts = append(pathParts, fmt.Sprintf("C %.2f %.2f %.2f %.2f %.2f %.2f",
				cp1X, cp1Y, cp2X, cp2Y, currPoint.x, currPoint.y))
		}
	}

	return strings.Join(pathParts, " ")
}

// GenerateRedThreadURL 生成紅線圖片URL（如果需要轉換為圖片）
func (g *RedThreadGenerator) GenerateRedThreadURL(userID string) string {
	// 這裡可以實現將SVG轉換為PNG並上傳到S3的邏輯
	// 目前返回一個基於用戶ID的唯一URL
	return fmt.Sprintf("https://your-s3-bucket.s3.amazonaws.com/red-threads/%s.svg", userID)
}

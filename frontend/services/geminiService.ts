import { GoogleGenAI } from "@google/genai";
import { Category, CreateGroupPayload } from '../types';

// 🔴 這裡刻意是空字串，不是「還沒接上」。
//    原本寫 `process.env.API_KEY || ''`，而那個值由 vite 的 `define` 在建置期
//    字面替換進來（稽核 finding 4）—— 等於把金鑰發給每一個使用者。define 已移除，
//    這行若照舊讀 `process.env` 會在瀏覽器拋 `process is not defined`。
// ⚠️ 本檔目前**零呼叫者**。要真的啟用 Gemini 的話：加一支後端 lambda 當代理，
//    讓這裡打自家 API，金鑰留在後端。**不要**把金鑰用任何形式送進前端 bundle。
//    下面每一支匯出函式都已經有 `if (!apiKey)` 的降級路徑，所以維持空字串是安全的。
const apiKey = '';
const ai = new GoogleGenAI({ apiKey });

/**
 * Generates a catchy description for an event based on basic details.
 */
export const generateEventDescription = async (
  title: string, 
  category: Category, 
  roughIdea: string
): Promise<string> => {
  if (!apiKey) {
    console.warn("API_KEY is missing. Returning original text.");
    return roughIdea;
  }

  try {
    const prompt = `
      你是一個專業的社群活動文案寫手。
      請為一個分類為 "${category}" 且標題為 "${title}" 的活動寫一段簡短、吸引人且充滿活力的介紹（100字以內）。
      
      用戶提供的筆記： "${roughIdea}"。
      
      請使用繁體中文 (Traditional Chinese)。
      適當加入 Emoji 讓語氣更輕鬆有趣。
      只需輸出文案內容，不需要標題或其他文字。
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text ? response.text.trim() : roughIdea;
  } catch (error) {
    console.error("Error generating description:", error);
    return roughIdea; // Fallback
  }
};

/**
 * Suggests a fun title based on category and location.
 */
export const suggestEventTitle = async (category: Category, location: string): Promise<string> => {
    if (!apiKey) return "超棒的聚會";

    try {
      const prompt = `請為一個在 ${location} 舉辦的 ${category} 活動，建議一個有創意、簡短且吸引人的繁體中文標題。只需回傳標題文字，不要有引號。`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      return response.text ? response.text.trim().replace(/"/g, '') : `${category} 聚會`;
    } catch (e) {
      return `${category} 聚會`;
    }
}

/**
 * Parses natural language input into structured event data.
 */
export const parseEventFromNaturalLanguage = async (input: string): Promise<Partial<CreateGroupPayload>> => {
    if (!apiKey) return {};

    try {
        const prompt = `
            從以下文字中提取活動細節並回傳 JSON 物件。
            文字: "${input}"
            
            目標格式:
            {
                "title": string (根據意圖生成一個簡短吸引人的繁體中文標題),
                "category": string (必須是以下之一: 'Food', 'Sports', 'Travel', 'Game', 'Other'),
                "location": string (推斷地點或回傳空字串),
                "maxMembers": number (推斷人數或預設為 4),
                "description": string (根據文字生成一段簡短的繁體中文描述)
            }
            
            規則:
            1. Category 必須嚴格對應提供的英文選項 (Food, Sports, etc.)，即便輸入是中文。
            2. 如果提到日期（如「明天」、「下週五」），先忽略，因為日期會另外處理，或回傳 null。
            3. 只回傳原始 JSON，不要 Markdown 格式。
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json'
            }
        });

        const text = response.text;
        if (!text) return {};
        
        const parsed = JSON.parse(text);
        
        // Validate category
        const validCategories = Object.values(Category);
        if (!validCategories.includes(parsed.category)) {
            parsed.category = Category.OTHER;
        }

        return parsed;
    } catch (e) {
        console.error("Error parsing natural language:", e);
        return {};
    }
}
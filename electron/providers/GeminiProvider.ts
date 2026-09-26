import * as axios from "axios"
import { AIProvider, ScreenshotData, ProcessingResult } from "./AIProvider"

interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}

export class GeminiProvider implements AIProvider {
  private apiKey: string | null = null;

  public initialize(apiKey: string): boolean {
    if (!apiKey) return false;
    this.apiKey = apiKey;
    return true;
  }

  public isReady(): boolean {
    return this.apiKey !== null;
  }

  public async generateSolution(
    model: string,
    prompt: string,
    images: ScreenshotData[],
    signal: AbortSignal
  ): Promise<ProcessingResult> {
    if (!this.apiKey) {
      return { success: false, error: "Gemini API key not configured" };
    }

    // Combine prompt with system instruction
    const combinedPrompt = `You are an expert coding interview assistant. You extract problem details from screenshots and generate optimal solutions. Always respond with valid JSON only, no markdown code blocks around the JSON.\n\n${prompt}`;

    const geminiMessages: GeminiMessage[] = [
      {
        role: "user",
        parts: [
          { text: combinedPrompt },
          ...images.map(img => ({
            inlineData: {
              mimeType: img.mimeType || "image/png",
              data: img.data
            }
          }))
        ]
      }
    ];

    try {
      const response = await axios.default.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          contents: geminiMessages,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            responseMimeType: "application/json"
          }
        },
        { signal, headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" } }
      );

      const responseText = response.data.candidates[0]?.content?.parts[0]?.text || "";
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                        responseText.match(/```\n([\s\S]*?)\n```/) ||
                        [null, responseText];
                        
      let dataStr = jsonMatch[1].trim();
      if (dataStr.startsWith('{') || dataStr.startsWith('[')) {
        try {
          return { success: true, data: JSON.parse(dataStr) };
        } catch (e) {
          return { success: true, data: dataStr };
        }
      }
      return { success: true, data: dataStr };
    } catch (error: any) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') throw error;
      console.error("Gemini error:", error);
      return { success: false, error: error.message || "Failed to generate solution" };
    }
  }

  public async generateDryRun(
    model: string,
    code: string,
    language: string,
    images: ScreenshotData[],
    signal: AbortSignal
  ): Promise<ProcessingResult> {
    if (!this.apiKey) {
      return { success: false, error: "Gemini API key not configured" };
    }

    const prompt = `You are an expert coding interviewer.
Given the following ${language} code solution:

\`\`\`${language}
${code}
\`\`\`

And the provided screenshot which contains a test case (input and expected output).
Please do a step-by-step dry run of the code using the test case from the screenshot.
Format your response as markdown. Keep it concise, clear, and easy to read out loud. Include the Time and Space complexity at the end. Do NOT wrap your response in JSON.`;

    const geminiMessages: GeminiMessage[] = [
      {
        role: "user",
        parts: [
          { text: prompt },
          ...images.map(img => ({
            inlineData: {
              mimeType: img.mimeType || "image/png",
              data: img.data
            }
          }))
        ]
      }
    ];

    try {
      const response = await axios.default.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          contents: geminiMessages,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          }
        },
        { signal, headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" } }
      );

      const responseText = response.data.candidates[0]?.content?.parts[0]?.text || "";
      return { success: true, data: responseText };
    } catch (error: any) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') throw error;
      console.error("Gemini dry run error:", error);
      return { success: false, error: error.message || "Failed to generate dry run" };
    }
  }
}

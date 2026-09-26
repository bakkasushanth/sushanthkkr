import Anthropic from '@anthropic-ai/sdk'
import { AIProvider, ScreenshotData, ProcessingResult } from "./AIProvider"

export class AnthropicProvider implements AIProvider {
  private client: Anthropic | null = null;

  public initialize(apiKey: string): boolean {
    try {
      this.client = new Anthropic({ apiKey });
      return true;
    } catch (error) {
      console.error("Failed to initialize Anthropic client:", error);
      return false;
    }
  }

  public isReady(): boolean {
    return this.client !== null;
  }

  public async generateSolution(
    model: string,
    prompt: string,
    images: ScreenshotData[],
    signal: AbortSignal
  ): Promise<ProcessingResult> {
    if (!this.client) {
      return { success: false, error: "Anthropic client is not initialized" };
    }

    const messages = [
      {
        role: "user" as const,
        content: [
          ...images.map(img => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: (img.mimeType || "image/png") as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: img.data
            }
          })),
          { type: "text" as const, text: prompt }
        ]
      }
    ];

    try {
      const response = await this.client.messages.create({
        model: model,
        max_tokens: 4096,
        temperature: 0.2,
        system: "You are an expert coding interview assistant. You extract problem details from screenshots and generate optimal solutions. Always respond with valid JSON only, no markdown code blocks around the JSON.",
        messages: messages
      }, { signal });

      let responseText = "";
      if (response.content[0].type === "text") {
        responseText = response.content[0].text;
      }

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
      if (error.name === 'AbortError') throw error;
      console.error("Anthropic error:", error);
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
    if (!this.client) {
      return { success: false, error: "Anthropic client is not initialized" };
    }

    const prompt = `You are an expert coding interviewer.
Given the following ${language} code solution:

\`\`\`${language}
${code}
\`\`\`

And the provided screenshot which contains a test case (input and expected output).
Please do a step-by-step dry run of the code using the test case from the screenshot.
Format your response as markdown. Keep it concise, clear, and easy to read out loud. Include the Time and Space complexity at the end. Do NOT wrap your response in JSON.`;

    const messages = [
      {
        role: "user" as const,
        content: [
          ...images.map(img => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: (img.mimeType || "image/png") as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: img.data
            }
          })),
          { type: "text" as const, text: prompt }
        ]
      }
    ];

    try {
      const response = await this.client.messages.create({
        model: model,
        max_tokens: 2048,
        temperature: 0.2,
        messages: messages
      }, { signal });

      let responseText = "";
      if (response.content[0].type === "text") {
        responseText = response.content[0].text;
      }

      return { success: true, data: responseText };
    } catch (error: any) {
      if (error.name === 'AbortError') throw error;
      console.error("Anthropic dry run error:", error);
      return { success: false, error: error.message || "Failed to generate dry run" };
    }
  }
}

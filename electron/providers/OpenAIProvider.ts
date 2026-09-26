import { OpenAI } from "openai"
import { AIProvider, ScreenshotData, ProcessingResult } from "./AIProvider"

const OPENAI_REASONING_MODELS = [
  'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5-mini'
];

function isReasoningModel(model: string): boolean {
  return OPENAI_REASONING_MODELS.some(rm => model.startsWith(rm));
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI | null = null;

  public initialize(apiKey: string): boolean {
    try {
      this.client = new OpenAI({ apiKey });
      return true;
    } catch (error) {
      console.error("Failed to initialize OpenAI client:", error);
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
      return { success: false, error: "OpenAI client is not initialized" };
    }

    const messages = [
      {
        role: "system" as const,
        content: "You are an expert coding interview assistant. You extract problem details from screenshots and generate optimal solutions. Always respond with valid JSON only, no markdown code blocks around the JSON."
      },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          ...images.map(img => ({
            type: "image_url" as const,
            image_url: { url: `data:${img.mimeType || "image/png"};base64,${img.data}` }
          }))
        ]
      }
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: model,
        messages: messages,
        ...(isReasoningModel(model) ? { max_completion_tokens: 4096 } : { max_tokens: 4096, temperature: 0.2 })
      }, { signal });

      const responseText = response.choices[0]?.message?.content || "";
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
      console.error("OpenAI error:", error);
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
      return { success: false, error: "OpenAI client is not initialized" };
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
          { type: "text" as const, text: prompt },
          ...images.map(img => ({
            type: "image_url" as const,
            image_url: { url: `data:${img.mimeType || "image/png"};base64,${img.data}` }
          }))
        ]
      }
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: model,
        messages: messages,
        ...(isReasoningModel(model) ? { max_completion_tokens: 2048 } : { max_tokens: 2048, temperature: 0.2 })
      }, { signal });

      const responseText = response.choices[0]?.message?.content || "";
      return { success: true, data: responseText };
    } catch (error: any) {
      if (error.name === 'AbortError') throw error;
      console.error("OpenAI dry run error:", error);
      return { success: false, error: error.message || "Failed to generate dry run" };
    }
  }
}

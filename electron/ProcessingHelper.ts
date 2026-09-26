import { AIProvider, ScreenshotData } from "./providers/AIProvider";
import { OpenAIProvider } from "./providers/OpenAIProvider";
import { GeminiProvider } from "./providers/GeminiProvider";
import { AnthropicProvider } from "./providers/AnthropicProvider";

// ProcessingHelper.ts
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog, nativeImage } from "electron"
import { OpenAI } from "openai"
import { configHelper } from "./ConfigHelper"
import Anthropic from '@anthropic-ai/sdk';

// Interface for Gemini API requests
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
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}
// OpenAI and Anthropic reasoning models that don't support temperature
function isReasoningModel(model: string): boolean {
  return model.startsWith("o1") || model.startsWith("o3") || model.includes("opus-5-5") || model.includes("gpt-5");
}

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private openaiClient: OpenAI | null = null
  private geminiApiKey: string | null = null
  private anthropicClient: Anthropic | null = null

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  // Cached config to avoid repeated disk reads during a single processing flow
  private cachedConfig: ReturnType<typeof configHelper.loadConfig> | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()
    
    // Initialize AI client based on config
    this.initializeAIClient();
    
    // Listen for config changes to re-initialize the AI client
    configHelper.on('config-updated', () => {
      this.cachedConfig = null; // Invalidate cache on config change
      this.initializeAIClient();
    });
  }

  /**
   * Get config, using cache within a processing flow to avoid repeated disk reads
   */
  private getConfig() {
    if (!this.cachedConfig) {
      this.cachedConfig = configHelper.loadConfig();
    }
    return this.cachedConfig;
  }

  /**
   * Compress an image buffer to reduce API payload size.
   * Resizes large images and converts to JPEG for smaller payloads.
   * Returns base64-encoded JPEG data and the mime type.
   */
  private compressImageForAPI(base64PngData: string): { data: string; mimeType: string } {
    try {
      const buffer = Buffer.from(base64PngData, 'base64');
      const img = nativeImage.createFromBuffer(buffer);
      const size = img.getSize();
      
      // Resize if larger than 1920px on any dimension (most API vision models work fine at this size)
      const MAX_DIM = 1920;
      let resizedImg = img;
      if (size.width > MAX_DIM || size.height > MAX_DIM) {
        const scale = Math.min(MAX_DIM / size.width, MAX_DIM / size.height);
        const newWidth = Math.round(size.width * scale);
        const newHeight = Math.round(size.height * scale);
        resizedImg = img.resize({ width: newWidth, height: newHeight, quality: 'good' });
      }
      
      // Convert to JPEG at 85% quality — much smaller than PNG for screenshots
      const jpegBuffer = resizedImg.toJPEG(85);
      return {
        data: jpegBuffer.toString('base64'),
        mimeType: 'image/jpeg'
      };
    } catch (err) {
      console.warn('Image compression failed, using original PNG:', err);
      return { data: base64PngData, mimeType: 'image/png' };
    }
  }
  
  /**
   * Initialize or reinitialize the AI client with current config
   */
  private initializeAIClient(): void {
    try {
      const config = configHelper.loadConfig();
      
      if (config.apiProvider === "openai") {
        const key = config.openaiApiKey || config.apiKey;
        if (key) {
          this.openaiClient = new OpenAI({ 
            apiKey: key,
            timeout: 60000, // 60 second timeout
            maxRetries: 2   // Retry up to 2 times
          });
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.log("OpenAI client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, OpenAI client not initialized");
        }
      } else if (config.apiProvider === "gemini"){
        // Gemini client initialization
        this.openaiClient = null;
        this.anthropicClient = null;
        const key = config.geminiApiKey || config.apiKey;
        if (key) {
          this.geminiApiKey = key;
          console.log("Gemini API key set successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, Gemini client not initialized");
        }
      } else if (config.apiProvider === "anthropic") {
        // Reset other clients
        this.openaiClient = null;
        this.geminiApiKey = null;
        const key = config.anthropicApiKey || config.apiKey;
        if (key) {
          this.anthropicClient = new Anthropic({
            apiKey: key,
            timeout: 60000,
            maxRetries: 2
          });
          console.log("Anthropic client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, Anthropic client not initialized");
        }
      }
    } catch (error) {
      console.error("Failed to initialize AI client:", error);
      this.openaiClient = null;
      this.geminiApiKey = null;
      this.anthropicClient = null;
    }
  }

  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getCredits(): Promise<number> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 999 // Unlimited credits in this version

    try {
      await this.waitForInitialization(mainWindow)
      return 999 // Always return sufficient credits to work
    } catch (error) {
      console.error("Error getting credits:", error)
      return 999 // Unlimited credits as fallback
    }
  }

  
  private getProvider(config: any): AIProvider | null {
    const provider = config.apiProvider;
    if (provider === 'openai') {
      const p = new OpenAIProvider();
      if (p.initialize(config.openaiApiKey || config.apiKey || '')) return p;
    }
    if (provider === 'anthropic') {
      const p = new AnthropicProvider();
      if (p.initialize(config.anthropicApiKey || config.apiKey || '')) return p;
    }
    
    // Default to Gemini or fallback
    const p = new GeminiProvider();
    if (p.initialize(config.geminiApiKey || config.apiKey || '')) return p;
    return null;
  }

  private async getLanguage(): Promise<string> {
    try {
      // Get language from config
      const config = configHelper.loadConfig();
      if (config.language) {
        return config.language;
      }
      
      // Fallback to window variable if config doesn't have language
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )

          if (
            typeof language === "string" &&
            language !== undefined &&
            language !== null
          ) {
            return language;
          }
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }
      
      // Default fallback
      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    // Refresh config cache at the start of each processing flow
    this.cachedConfig = null;
    const config = this.getConfig();
    
    // First verify we have a valid AI client
    if (config.apiProvider === "openai" && !this.openaiClient) {
      this.initializeAIClient();
      
      if (!this.openaiClient) {
        console.error("OpenAI client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === "gemini" && !this.geminiApiKey) {
      this.initializeAIClient();
      
      if (!this.geminiApiKey) {
        console.error("Gemini API key not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === "anthropic" && !this.anthropicClient) {
      // Add check for Anthropic client
      this.initializeAIClient();
      
      if (!this.anthropicClient) {
        console.error("Anthropic client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)
      
      // Check if the queue is empty
      if (!screenshotQueue || screenshotQueue.length === 0) {
        console.log("No screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      // Check that files actually exist
      const existingScreenshots = screenshotQueue.filter(path => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        console.log("Screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        // Initialize AbortController
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          existingScreenshots.map(async (screenshotPath) => {
            try {
              const rawData = fs.readFileSync(screenshotPath).toString('base64');
              const compressed = this.compressImageForAPI(rawData);
              return {
                path: screenshotPath,
                preview: `data:${compressed.mimeType};base64,${compressed.data}`,
                data: compressed.data,
                mimeType: compressed.mimeType
              };
            } catch (err) {
              console.error(`Error reading screenshot ${screenshotPath}:`, err);
              return null;
            }
          })
        )

        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter((s): s is NonNullable<typeof s> => s !== null);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

        const result = await this.processScreenshotsHelper(validScreenshots, signal)

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key") || result.error?.includes("OpenAI") || result.error?.includes("Gemini")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.API_KEY_INVALID
            )
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            )
          }
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        // Only set view to solutions if processing succeeded
        console.log("Setting view to solutions after successful processing")
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        )
        this.deps.setView("solutions")
      } catch (error: any) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        console.error("Processing error:", error)
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
        }
        // Reset view back to queue on error
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)
      
      // Check if the extra queue is empty
      if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        
        return;
      }

      // Check that files actually exist
      const existingExtraScreenshots = extraScreenshotQueue.filter(path => fs.existsSync(path));
      if (existingExtraScreenshots.length === 0) {
        console.log("Extra screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }
      
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      // Initialize AbortController
      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        // Get all screenshots (both main and extra) for processing
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...existingExtraScreenshots
        ];
        
        const screenshots = await Promise.all(
          allPaths.map(async (screenshotPath) => {
            try {
              if (!fs.existsSync(screenshotPath)) {
                console.warn(`Screenshot file does not exist: ${screenshotPath}`);
                return null;
              }
              
              const rawData = fs.readFileSync(screenshotPath).toString('base64');
              const compressed = this.compressImageForAPI(rawData);
              return {
                path: screenshotPath,
                preview: `data:${compressed.mimeType};base64,${compressed.data}`,
                data: compressed.data,
                mimeType: compressed.mimeType
              };
            } catch (err) {
              console.error(`Error reading screenshot ${screenshotPath}:`, err);
              return null;
            }
          })
        )
        
        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter((s): s is NonNullable<typeof s> => s !== null);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }
        
        console.log(
          "Combined screenshots for processing:",
          validScreenshots.map((s) => s.path)
        )

        const result = await this.processExtraScreenshotsHelper(
          validScreenshots,
          signal
        )

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          )
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string; mimeType?: string }>,
    signal: AbortSignal
  ) {
    try {
      const config = this.getConfig();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();
      
      const imageDataList = screenshots.map(screenshot => ({
        data: screenshot.data,
        mimeType: (screenshot as any).mimeType || 'image/png'
      }));
      
      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing problem and generating solution...",
          progress: 20
        });
      }

      const userResumeContext = config.userResume 
        ? `\n\nUSER RESUME/BACKGROUND:\n${config.userResume}\n\nPlease use the user's resume/background above to tailor the "clarify", "brute_force", and "optimize" dialogue responses so that they sound like they are coming from a candidate with this specific experience.` 
        : '';

      // OPTIMIZATION: Single combined prompt that extracts AND solves in one API call
      const combinedPrompt = `You are an expert coding interview assistant. Analyze the screenshot(s) of a coding problem and:
1. Extract the problem details
2. Generate an optimal solution
3. Produce a structured FAANG-style interview walkthrough

Preferred coding language: ${language}${userResumeContext}

Respond with ONLY a JSON object (no markdown code blocks) with the following structure. Crucially, the "clarify", "brute_force", and "optimize" fields MUST contain realistic dialogue/steps tailored SPECIFICALLY to the problem in the screenshot(s), NOT placeholders for Two-Sum:
{
  "problem_statement": "the full problem statement",
  "constraints": "any constraints mentioned",
  "example_input": "example input if provided",
  "example_output": "example output if provided",
  "code": "clean, optimized solution code in ${language}. MUST include short, 1-line inline comments to the right of important lines explaining what they do",
  "thoughts": ["key insight 1", "key insight 2", "key insight 3"],
  "time_complexity": "O(X) - detailed explanation of why (at least 2 sentences)",
  "space_complexity": "O(X) - detailed explanation of why (at least 2 sentences)",
  "clarify": [
    "A list of 3 natural spoken sentences clarifying constraints, inputs, or edge cases tailored SPECIFICALLY to the actual problem in the screenshot."
  ],
  "brute_force": [
    "A list of 3 natural spoken sentences describing the brute force approach for this specific problem, explaining its complexity, and identifying the bottleneck."
  ],
  "optimize": [
    "A list of 3 natural spoken sentences describing the optimal algorithm/data structure for this specific problem, the key insight (e.g., dynamic programming, sliding window, prefix sums, binary search, tree traversal, etc. depending on what is needed), and why it is optimal."
  ]
}`;

      let combinedResult: any;
      
      if (config.apiProvider === "openai") {
        // Verify OpenAI client
        if (!this.openaiClient) {
          this.initializeAIClient();
          if (!this.openaiClient) {
            return {
              success: false,
              error: "OpenAI API key not configured or invalid. Please check your settings."
            };
          }
        }

        const extractionModel = config.extractionModel || "gpt-4o";
        const messages = [
          {
            role: (isReasoningModel(extractionModel) ? "developer" : "system") as "developer" | "system", 
            content: "You are an expert coding interview assistant. You extract problem details from screenshots and generate optimal solutions. Always respond with valid JSON only, no markdown code blocks around the JSON."
          },
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: combinedPrompt },
              ...imageDataList.map(img => ({
                type: "image_url" as const,
                image_url: { url: `data:${img.mimeType};base64,${img.data}` }
              }))
            ]
          }
        ];

        const response = await this.openaiClient.chat.completions.create({
          model: extractionModel,
          messages: messages,
          ...(isReasoningModel(extractionModel) ? { max_completion_tokens: 4096 } : { max_tokens: 4096, temperature: 0.2 })
        }, { signal });

        try {
          const responseText = response.choices[0].message.content;
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          combinedResult = JSON.parse(jsonText);
        } catch (error) {
          console.error("Error parsing OpenAI response:", error);
          return {
            success: false,
            error: "Failed to parse problem information. Please try again or use clearer screenshots."
          };
        }
      } else if (config.apiProvider === "gemini") {
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          const geminiMessages: GeminiMessage[] = [
            {
              role: "user",
              parts: [
                { text: combinedPrompt },
                ...imageDataList.map(img => ({
                  inlineData: {
                    mimeType: img.mimeType,
                    data: img.data
                  }
                }))
              ]
            }
          ];

          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-2.5-flash"}:generateContent`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4096,
                responseMimeType: "application/json"
              }
            },
            { signal, headers: { "x-goog-api-key": this.geminiApiKey, "Content-Type": "application/json" } }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          const responseText = responseData.candidates[0].content.parts[0].text;
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          combinedResult = JSON.parse(jsonText);
        } catch (error) {
          console.error("Error using Gemini API:", error);
          return {
            success: false,
            error: "Failed to process with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: combinedPrompt },
                ...imageDataList.map(img => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: img.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                    data: img.data
                  }
                }))
              ]
            }
          ];

          const modelId = config.extractionModel || "claude-opus-5-5";
          const response = await this.anthropicClient.messages.create({
            model: modelId,
            max_tokens: 4096,
            messages: messages,
            ...(isReasoningModel(modelId) ? {} : { temperature: 0.2 })
          });

          const responseText = (response.content[0] as { type: 'text', text: string }).text;
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          combinedResult = JSON.parse(jsonText);
        } catch (error: any) {
          console.error("Error using Anthropic API:", error);

          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: "Failed to process with Anthropic API. Please check your API key or try again later."
          };
        }
      }

      // Extract problem info for state
      const problemInfo = {
        problem_statement: combinedResult.problem_statement,
        constraints: combinedResult.constraints,
        example_input: combinedResult.example_input,
        example_output: combinedResult.example_output
      };

      // Store problem info in AppState
      this.deps.setProblemInfo(problemInfo);

      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          problemInfo
        );

        // Clear any existing extra screenshots before transitioning to solutions view
        this.screenshotHelper.clearExtraScreenshotQueue();
        
        // Final progress update
        mainWindow.webContents.send("processing-status", {
          message: "Solution generated successfully",
          progress: 100
        });

        // Format the solution response
        const formattedResponse = {
          code: combinedResult.code || "",
          thoughts: Array.isArray(combinedResult.thoughts) 
            ? combinedResult.thoughts 
            : [combinedResult.thoughts || "Solution approach based on efficiency and readability"],
          time_complexity: combinedResult.time_complexity || "O(n)",
          space_complexity: combinedResult.space_complexity || "O(n)",
          // FAANG interview walkthrough fields
          clarify: Array.isArray(combinedResult.clarify) ? combinedResult.clarify : [],
          brute_force: Array.isArray(combinedResult.brute_force) ? combinedResult.brute_force : [],
          optimize: Array.isArray(combinedResult.optimize) ? combinedResult.optimize : []
        };

        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          formattedResponse
        );
        return { success: true, data: formattedResponse };
      }

      return { success: false, error: "Failed to process screenshots" };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }
      
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "API rate limit exceeded or insufficient credits. Please try again later."
        };
      } else if (error?.response?.status === 500) {
        return {
          success: false,
          error: "API server error. Please try again later."
        };
      }

      console.error("API Error Details:", error);
      return { 
        success: false, 
        error: error.message || "Failed to process screenshots. Please try again." 
      };
    }
  }

  /**
   * @deprecated This method is kept for backward compatibility but is no longer used
   * in the primary flow. The combined extraction+solution is now done in processScreenshotsHelper.
   */
  private async generateSolutionsHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = this.getConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Creating optimal solution with detailed explanations...",
          progress: 60
        });
      }

      const userResumeContext = config.userResume 
        ? `\n\nUSER RESUME/BACKGROUND:\n${config.userResume}\n\nPlease tailor your explanation and thoughts to fit a candidate with this specific background.` 
        : '';

      // Create prompt for solution generation
      const promptText = `
Generate a detailed solution for the following coding problem:

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

LANGUAGE: ${language}${userResumeContext}

I need the response in the following format:
1. Code: A clean, optimized implementation in ${language}. MUST include short, 1-line inline comments to the right of important lines explaining what they do.
2. Your Thoughts: A list of key insights and reasoning behind your approach
3. Time complexity: O(X) with a detailed explanation (at least 2 sentences)
4. Space complexity: O(X) with a detailed explanation (at least 2 sentences)

For complexity explanations, please be thorough. For example: "Time complexity: O(n) because we iterate through the array only once. This is optimal as we need to examine each element at least once to find the solution." or "Space complexity: O(n) because in the worst case, we store all elements in the hashmap. The additional space scales linearly with the input size."

Your solution should be efficient, well-commented (with short inline comments to the right of important lines), and handle edge cases.
`;

      let responseContent;
      
      if (config.apiProvider === "openai") {
        // OpenAI processing
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }
        
        // Send to OpenAI API
        const solutionModel = config.solutionModel || "gpt-4o";
        const solutionResponse = await this.openaiClient.chat.completions.create({
          model: solutionModel,
          messages: [
            { role: (isReasoningModel(solutionModel) ? "developer" : "system") as "developer" | "system", content: "You are an expert coding interview assistant. Provide clear, optimal solutions with detailed explanations." },
            { role: "user" as const, content: promptText }
          ],
          ...(isReasoningModel(solutionModel) ? { max_completion_tokens: 4000 } : { max_tokens: 4000, temperature: 0.2 })
        });

        responseContent = solutionResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini")  {
        // Gemini processing
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }
        
        try {
          // Create Gemini message structure
          const geminiMessages = [
            {
              role: "user",
              parts: [
                {
                  text: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
                }
              ]
            }
          ];

          // Make API request to Gemini
          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-2.5-flash"}:generateContent`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal, headers: { "x-goog-api-key": this.geminiApiKey, "Content-Type": "application/json" } }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          responseContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for solution:", error);
          return {
            success: false,
            error: "Failed to generate solution with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        // Anthropic processing
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }
        
        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
                }
              ]
            }
          ];

          // Send to Anthropic API
          const modelId = config.solutionModel || "claude-opus-5-5";
          const response = await this.anthropicClient.messages.create({
            model: modelId,
            max_tokens: 4000,
            messages: messages,
            ...(isReasoningModel(modelId) ? {} : { temperature: 0.2 })
          });

          responseContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for solution:", error);

          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: "Failed to generate solution with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      // Extract parts from the response
      const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : responseContent;
      
      // Extract thoughts, looking for bullet points or numbered lists
      const thoughtsRegex = /(?:Thoughts:|Key Insights:|Reasoning:|Approach:)([\s\S]*?)(?:Time complexity:|$)/i;
      const thoughtsMatch = responseContent.match(thoughtsRegex);
      let thoughts: string[] = [];
      
      if (thoughtsMatch && thoughtsMatch[1]) {
        // Extract bullet points or numbered items
        const bulletPoints = thoughtsMatch[1].match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g);
        if (bulletPoints) {
          thoughts = bulletPoints.map(point => 
            point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim()
          ).filter(Boolean);
        } else {
          // If no bullet points found, split by newlines and filter empty lines
          thoughts = thoughtsMatch[1].split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        }
      }
      
      // Extract complexity information
      const timeComplexityPattern = /Time complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:Space complexity|$))/i;
      const spaceComplexityPattern = /Space complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:[A-Z]|$))/i;
      
      let timeComplexity = "O(n) - Linear time complexity because we only iterate through the array once. Each element is processed exactly one time, and the hashmap lookups are O(1) operations.";
      let spaceComplexity = "O(n) - Linear space complexity because we store elements in the hashmap. In the worst case, we might need to store all elements before finding the solution pair.";
      
      const timeMatch = responseContent.match(timeComplexityPattern);
      if (timeMatch && timeMatch[1]) {
        timeComplexity = timeMatch[1].trim();
        if (!timeComplexity.match(/O\([^)]+\)/i)) {
          timeComplexity = `O(n) - ${timeComplexity}`;
        } else if (!timeComplexity.includes('-') && !timeComplexity.includes('because')) {
          const notationMatch = timeComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = timeComplexity.replace(notation, '').trim();
            timeComplexity = `${notation} - ${rest}`;
          }
        }
      }
      
      const spaceMatch = responseContent.match(spaceComplexityPattern);
      if (spaceMatch && spaceMatch[1]) {
        spaceComplexity = spaceMatch[1].trim();
        if (!spaceComplexity.match(/O\([^)]+\)/i)) {
          spaceComplexity = `O(n) - ${spaceComplexity}`;
        } else if (!spaceComplexity.includes('-') && !spaceComplexity.includes('because')) {
          const notationMatch = spaceComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = spaceComplexity.replace(notation, '').trim();
            spaceComplexity = `${notation} - ${rest}`;
          }
        }
      }

      const formattedResponse = {
        code: code,
        thoughts: thoughts.length > 0 ? thoughts : ["Solution approach based on efficiency and readability"],
        time_complexity: timeComplexity,
        space_complexity: spaceComplexity
      };

      return { success: true, data: formattedResponse };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }
      
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid OpenAI API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "OpenAI API rate limit exceeded or insufficient credits. Please try again later."
        };
      }
      
      console.error("Solution generation error:", error);
      return { success: false, error: error.message || "Failed to generate solution" };
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = this.getConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Processing debug screenshots...",
          progress: 30
        });
      }

      // Prepare the images for the API call
      const imageDataList = screenshots.map(screenshot => ({
        data: screenshot.data,
        mimeType: (screenshot as any).mimeType || 'image/png'
      }));
      
      let debugContent;
      
      const isRepoDebug = config.repoDebugMode === true;
      const readOnlyConstraint = isRepoDebug && config.readOnlyFiles ? `\nCRITICAL CONSTRAINT: The following files are READ-ONLY and MUST NOT BE MODIFIED. Do not suggest fixes in these files. Work around them: ${config.readOnlyFiles}` : '';

      const debugPrompt = isRepoDebug 
        ? `You are a Senior FAANG Software Engineer helping debug a complex Node.js/Express Repository Challenge.
We are working through hidden unit tests that test edge cases. 
Analyze these screenshots which include the problem description, failing test logs, and the source code.
Identify the exact bug and output the precise line changes required in the editable files to make the hidden tests pass. 
Think deeply about edge cases (nulls, empty arrays, pagination limits, boundary conditions).${readOnlyConstraint}

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Root Cause
- Explain why the test is failing and what edge case was missed

### Precise Code Changes
- List exactly which lines to change in which files (provide a clear code diff)

### Edge Case Verification
- Explain why this fix will pass all hidden test cases and handle edge cases safely`
        : `You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo?.problem_statement || "Unknown"}" in ${language}. I need help with debugging or improving my solution.

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`${language}).`;
      
      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }
        
        const debugModel = config.debuggingModel || "gpt-4o";
        const messages = [
          {
            role: (isReasoningModel(debugModel) ? "developer" : "system") as "developer" | "system", 
            content: isRepoDebug ? "You are a Senior FAANG Software Engineer helping debug a complex Node.js/Express Repository Challenge." : `You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

Your response MUST follow this exact structure with these section headers (use ### for headers):
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).`
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const, 
                text: debugPrompt
              },
              ...imageDataList.map(img => ({
                type: "image_url" as const,
                image_url: { url: `data:${img.mimeType};base64,${img.data}` }
              }))
            ]
          }
        ];

        if (mainWindow) {
          mainWindow.webContents.send("processing-status", {
            message: "Analyzing code and generating debug feedback...",
            progress: 60
          });
        }

        const debugResponse = await this.openaiClient.chat.completions.create({
          model: debugModel,
          messages: messages,
          ...(isReasoningModel(debugModel) ? { max_completion_tokens: 4000 } : { max_tokens: 4000, temperature: 0.2 })
        });
        
        debugContent = debugResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini")  {
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }
        
        try {


          const geminiMessages = [
            {
              role: "user",
              parts: [
                { text: debugPrompt },
                ...imageDataList.map(img => ({
                  inlineData: {
                    mimeType: img.mimeType,
                    data: img.data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Gemini...",
              progress: 60
            });
          }

          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.debuggingModel || "gemini-2.5-flash"}:generateContent`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal, headers: { "x-goog-api-key": this.geminiApiKey, "Content-Type": "application/json" } }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          debugContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for debugging:", error);
          return {
            success: false,
            error: "Failed to process debug request with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }
        
        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: debugPrompt
                },
                ...imageDataList.map(img => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: img.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", 
                    data: img.data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Claude...",
              progress: 60
            });
          }

          const modelId = config.debuggingModel || "claude-opus-5-5";
          const client = this.anthropicClient;
          const response = await client.messages.create({
            model: modelId,
            max_tokens: 4000,
            messages: messages,
            ...(isReasoningModel(modelId) ? {} : { temperature: 0.2 })
          });
          
          debugContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for debugging:", error);
          
          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }
          
          return {
            success: false,
            error: "Failed to process debug request with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      let extractedCode = "// Debug mode - see analysis below";
      const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim();
      }

      let formattedDebugContent = debugContent;
      
      if (!debugContent.includes('# ') && !debugContent.includes('## ')) {
        formattedDebugContent = debugContent
          .replace(/issues identified|problems found|bugs found/i, '## Issues Identified')
          .replace(/code improvements|improvements|suggested changes/i, '## Code Improvements')
          .replace(/optimizations|performance improvements/i, '## Optimizations')
          .replace(/explanation|detailed analysis/i, '## Explanation');
      }

      const bulletPoints = formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      const thoughts = bulletPoints 
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 5)
        : ["Debug analysis based on your screenshots"];
      
      const response = {
        code: extractedCode,
        debug_analysis: formattedDebugContent,
        thoughts: thoughts,
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
      };

      return { success: true, data: response };
    } catch (error: any) {
      console.error("Debug processing error:", error);
      return { success: false, error: error.message || "Failed to process debug request" };
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)

    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }

  /**
   * Explains a specific line of code in the context of the full solution.
   */
  public async explainLine(
    line: string,
    lineNumber: number,
    fullCode: string,
    language: string
  ): Promise<{ success: boolean; explanation?: string; error?: string }> {
    const config = configHelper.loadConfig();
    if (!config.apiKey && !config.openaiApiKey && !config.geminiApiKey && !config.anthropicApiKey) {
      return { success: false, error: "No API key configured" };
    }

    const prompt = `You are a coding interview coach. A student is looking at their solution and wants to understand a specific line.

**Language:** ${language}
**Full Solution:**
\`\`\`${language}
${fullCode}
\`\`\`

**Line ${lineNumber} they're asking about:**
\`\`\`
${line.trim()}
\`\`\`

Explain this line in 2-3 concise sentences:
1. What this line does mechanically
2. WHY it's needed in the algorithm (the strategic purpose)
3. What would break if you removed it

Be concise and direct. No markdown formatting. Speak as if coaching someone mid-interview.`;

    const abortController = new AbortController();
    const signal = abortController.signal;

    try {
      const provider = config.apiProvider || "openai";
      let responseText = "";

      if (provider === "openai") {
        const key = config.openaiApiKey || config.apiKey;
        const client = new OpenAI({ apiKey: key });
        const solutionModel = config.solutionModel || "gpt-4o";
        const response = await client.chat.completions.create({
          model: solutionModel,
          messages: [
            { role: "user", content: prompt }
          ],
          ...(isReasoningModel(solutionModel) ? { max_completion_tokens: 300 } : { max_tokens: 300, temperature: 0.3 })
        }, { signal });
        responseText = response.choices[0]?.message?.content || "";
      } else if (provider === "gemini") {
        const response = await axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-2.5-flash"}:generateContent`,
          {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 300 }
          },
          { signal, headers: { "x-goog-api-key": config.geminiApiKey || config.apiKey, "Content-Type": "application/json" } }
        );
        const data = response.data as GeminiResponse;
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      } else if (provider === "anthropic") {
        const client = new Anthropic({ apiKey: config.anthropicApiKey || config.apiKey });
        const modelId = config.solutionModel || "claude-opus-5-5";
        const response = await client.messages.create({
          model: modelId,
          max_tokens: 300,
          ...(isReasoningModel(modelId) ? {} : { temperature: 0.3 }),
          messages: [{ role: "user", content: prompt }]
        }, { signal });
        if (response.content[0]?.type === "text") {
          responseText = response.content[0].text;
        }
      }

      return { success: true, explanation: responseText.trim() };
    } catch (error: any) {
      console.error("Error explaining line:", error);
      return { success: false, error: error.message || "Failed to explain line" };
    }
  }
  /**
   * Generates a hint based on the interviewer's transcribed audio
   */
  public async generateAudioHint(
    transcript: string,
    fullCode: string,
    language: string
  ): Promise<{ success: boolean; hint?: string; error?: string }> {
    const config = configHelper.loadConfig();
    if (!config.apiKey && !config.openaiApiKey && !config.geminiApiKey && !config.anthropicApiKey) {
      return { success: false, error: "No API key configured" };
    }

    const userResumeContext = config.userResume 
      ? `\n\n**My Resume/Background:**\n${config.userResume}\n` 
      : '';

    const codeContext = fullCode && fullCode.trim().length > 0 
      ? `\n**My Current Code:**\n\`\`\`${language}\n${fullCode}\n\`\`\`\n`
      : `\n**My Current Code:**\nNo code has been written yet. We might just be talking.\n`;

    const prompt = `You are a top 0.1% FAANG engineer acting as an invisible co-pilot in a live interview.
The interviewer just spoke and asked/said the following:

"${transcript}"
${userResumeContext}${codeContext}

Analyze the interviewer's query and provide an elite, direct response.
Crucial rules:
1. IF the question is BEHAVIORAL (e.g., conflicts, leadership, "tell me about a time"): answer using the STAR method (Situation, Task, Action using 'I' not 'we', Result with quantified metrics) drawn STRICTLY from the provided Resume/Background. while actively demonstrating Amazon's Leadership Principles — especially Ownership, Deliver Results, Customer Obsession, Earn Trust, and Insist on Highest Standards — with specific data points, proactive communication, and a lesson learned at the end; never blame others, never be passive, never omit impact numbers, and never claim an LP — prove it through the story, natural-sounding 5-6 sentence story.
2. IF the question is TECHNICAL: NO fluff, NO preamble, NO generic advice. Provide exact syntax (e.g., SQL, React) or code snippets.
3. IF the interviewer asks about project architecture, explain the specific implementation details and trade-offs based on the Resume/Background.
4. Keep the response highly readable so the candidate can read it aloud naturally and sound like a senior engineer.

Output only the answer. Use markdown for code.`;

    try {
      let responseText = "";
      const provider = config.apiProvider || "openai";
      const signal = AbortSignal.timeout(15000);

      if (provider === "openai") {
        if (!this.openaiClient) {
          this.initializeAIClient();
        }
        if (!this.openaiClient) {
          return { success: false, error: "OpenAI client not initialized. Please verify your API key in settings." };
        }
        // Use a highly capable model for top-tier answers
        const audioModel = "gpt-4o";
        const response = await this.openaiClient.chat.completions.create({
          model: audioModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 800,
          temperature: 0
        }, { signal });
        responseText = response.choices[0]?.message?.content || "";
      } else if (provider === "gemini") {
        // Use a highly capable model for top-tier answers
        const audioModel = "gemini-2.5-pro";
        const response = await axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${audioModel}:generateContent`,
          {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 800 }
          },
          { signal, headers: { "x-goog-api-key": config.geminiApiKey || config.apiKey, "Content-Type": "application/json" } }
        );
        const data = response.data as GeminiResponse;
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      } else if (provider === "anthropic") {
        if (!this.anthropicClient) {
          this.initializeAIClient();
        }
        if (!this.anthropicClient) {
          return { success: false, error: "Anthropic client not initialized. Please verify your API key in settings." };
        }
        // Use a highly capable model for top-tier answers
        const audioModel = "claude-3-5-sonnet-20241022";
        const response = await this.anthropicClient.messages.create({
          model: audioModel,
          max_tokens: 800,
          temperature: 0,
          messages: [{ role: "user", content: prompt }]
        }, { signal });
        if (response.content[0]?.type === "text") {
          responseText = response.content[0].text;
        }
      }

      return { success: true, hint: responseText.trim() };
    } catch (error: any) {
      console.error("Error generating audio hint:", error);
      return { success: false, error: error.message || "Failed to generate hint" };
    }
  }

  public async processDryRun(code: string, language: string) {
    const mainWindow = this.deps.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DRY_RUN_START);
    }

    try {
      // 1. Get test case screenshot from extra queue
      const screenshotPaths = this.deps.getExtraScreenshotQueue();
      if (screenshotPaths.length === 0) {
        throw new Error("No test case screenshot found. Please take a screenshot of the test case first.");
      }

      // We only use the MOST RECENT screenshot for the dry run test case
      const testCaseScreenshotPath = screenshotPaths[screenshotPaths.length - 1];
      const imageBase64 = await this.screenshotHelper.getImagePreview(testCaseScreenshotPath);
      
      const images: ScreenshotData[] = [{
        data: imageBase64,
        mimeType: "image/png"
      }];

      // 2. Setup configuration and provider
      const config = configHelper.loadConfig();
      const provider = this.getProvider(config);
      
      if (!provider) {
        throw new Error("No AI provider available. Please check your API key.");
      }

      // 3. Setup cancellation
      if (this.currentExtraProcessingAbortController) {
        this.currentExtraProcessingAbortController.abort();
      }
      const abortController = new AbortController();
      this.currentExtraProcessingAbortController = abortController;

      const modelName = config.solutionModel || (
        config.apiProvider === 'gemini' ? 'gemini-2.5-pro' :
        config.apiProvider === 'anthropic' ? 'claude-opus-5-5' : 'o3-mini'
      );

      // 4. Generate Dry Run
      const result = await provider.generateDryRun(
        modelName,
        code,
        language,
        images,
        abortController.signal
      );

      if (this.currentExtraProcessingAbortController === abortController) {
        this.currentExtraProcessingAbortController = null;
      }

      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to generate dry run trace");
      }

      // Clear the extra screenshot queue since we used it
      this.deps.clearQueues();

      // 5. Send success to frontend
      if (mainWindow) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DRY_RUN_SUCCESS, result.data);
      }

    } catch (error: any) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        console.log("Dry run request was cancelled");
      } else {
        console.error("Dry run error:", error);
        if (mainWindow) {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DRY_RUN_ERROR, error.message);
        }
      }
    }
  }

  public async processChat(messages: Array<{ role: "user" | "assistant", content: string, images?: { data: string, mimeType: string }[] }>): Promise<{ success: boolean; data?: string; error?: string }> {
    const mainWindow = this.deps.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.CHAT_START);
    }

    try {
      const config = configHelper.loadConfig();
      
      let responseText = "";

      const chatSystemPrompt = `You are a top 0.1% FAANG software engineer and an expert pair programmer. 
Your goal is to help the user debug their code or solve problems conversationally. 
CRITICAL RULES:
1. DO NOT simply rewrite or output the entire corrected code block unless explicitly asked.
2. Pinpoint the exact issue, explain WHY it is happening, and provide a tiny, targeted snippet of the fix.
3. Be conversational, concise, and act like a senior engineer reviewing a pull request or pairing with a colleague.`;

      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          this.initializeAIClient();
          if (!this.openaiClient) throw new Error("OpenAI API key not configured");
        }

        const modelId = config.debuggingModel || "gpt-4o";
        const isReasoning = isReasoningModel(modelId);
        
        const openAiMessages = [
          { role: isReasoning ? "developer" : "system", content: chatSystemPrompt },
          ...messages.map(msg => {
            if (msg.role === "assistant") {
              return { role: "assistant" as const, content: msg.content };
            }
            // User message
            const contentArray: any[] = [{ type: "text", text: msg.content }];
            if (msg.images) {
              for (const img of msg.images) {
                const compressed = this.compressImageForAPI(img.data);
                contentArray.push({
                  type: "image_url",
                  image_url: { url: `data:${compressed.mimeType};base64,${compressed.data}` }
                });
              }
            }
            return { role: "user" as const, content: contentArray };
          })
        ];

        const response = await this.openaiClient.chat.completions.create({
          model: modelId,
          messages: openAiMessages as any,
          ...(isReasoning ? { max_completion_tokens: 4000 } : { max_tokens: 4000, temperature: 0.7 })
        });
        
        responseText = response.choices[0].message.content || "";

      } else if (config.apiProvider === "gemini") {
        if (!this.geminiApiKey) throw new Error("Gemini API key not configured");

        const geminiMessages = messages.map(msg => {
          const parts: any[] = [{ text: msg.content }];
          if (msg.role === "user" && msg.images) {
            for (const img of msg.images) {
              const compressed = this.compressImageForAPI(img.data);
              parts.push({
                inlineData: { mimeType: compressed.mimeType, data: compressed.data }
              });
            }
          }
          return { role: msg.role === "assistant" ? "model" : "user", parts };
        });

        const modelId = config.debuggingModel || "gemini-2.5-flash";
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${this.geminiApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            systemInstruction: { parts: [{ text: chatSystemPrompt }] },
            contents: geminiMessages 
          })
        });

        if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
        const data = await response.json();
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          this.initializeAIClient();
          if (!this.anthropicClient) throw new Error("Anthropic API key not configured");
        }

        const anthropicMessages = messages.map(msg => {
          if (msg.role === "assistant") {
            return { role: "assistant" as const, content: msg.content };
          }
          const contentArray: any[] = [{ type: "text", text: msg.content }];
          if (msg.images) {
            for (const img of msg.images) {
              const compressed = this.compressImageForAPI(img.data);
              contentArray.push({
                type: "image",
                source: { type: "base64", media_type: compressed.mimeType, data: compressed.data }
              });
            }
          }
          return { role: "user" as const, content: contentArray };
        });

        const modelId = config.debuggingModel || "claude-opus-5-5";
        const response = await this.anthropicClient.messages.create({
          model: modelId,
          max_tokens: 4000,
          system: chatSystemPrompt,
          messages: anthropicMessages
        });

        responseText = (response.content[0] as any).text || "";
      }

      if (mainWindow) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.CHAT_SUCCESS, responseText);
      }
      return { success: true, data: responseText };

    } catch (error: any) {
      console.error("Chat processing error:", error);
      if (mainWindow) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.CHAT_ERROR, error.message);
      }
      return { success: false, error: error.message };
    }
  }
}

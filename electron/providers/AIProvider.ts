

export interface ScreenshotData {
  path?: string;
  data: string;
  mimeType?: string;
}

export interface ProcessingResult {
  success: boolean;
  error?: string;
  data?: any | string; // The parsed JSON solution data or raw string
}

export interface AIProvider {
  /**
   * Initializes the provider with an API key. Returns true if successful.
   */
  initialize(apiKey: string): boolean;
  
  /**
   * Checks if the provider is initialized and ready to be used.
   */
  isReady(): boolean;
  
  /**
   * Generates a solution based on a prompt and a set of images.
   */
  generateSolution(
    model: string,
    prompt: string, 
    images: ScreenshotData[], 
    signal: AbortSignal,
    isJson?: boolean
  ): Promise<ProcessingResult>;

  /**
   * Generates a step-by-step dry run trace.
   */
  generateDryRun(
    model: string,
    code: string,
    language: string,
    images: ScreenshotData[],
    signal: AbortSignal
  ): Promise<ProcessingResult>;
}

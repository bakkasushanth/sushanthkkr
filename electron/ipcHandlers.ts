// ipcHandlers.ts

import { ipcMain, shell, desktopCapturer, clipboard } from "electron"
import { IIpcHandlerDeps } from "./main"
import { configHelper } from "./ConfigHelper"
import { OpenAI, toFile } from "openai"

// ── Singleton Whisper client ──────────────────────────────────────────────────
// Created once on startup — avoids 200-500ms of constructor + TLS handshake
// overhead on every keystroke/hotkey invocation.
let _whisperClient: OpenAI | null = null;
let _whisperClientKey: string | null = null;

function getWhisperClient(apiKey: string): OpenAI {
  // Reuse the existing client if the key hasn't changed
  if (_whisperClient && _whisperClientKey === apiKey) return _whisperClient;
  _whisperClient = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
  _whisperClientKey = apiKey;
  return _whisperClient;
}

// ── Pre-warm on module load ───────────────────────────────────────────────────
// Boot the singleton immediately so TLS handshake + HTTP/2 session is fully
// established before the user ever presses the hotkey.
;(function preWarmWhisper() {
  try {
    const cfg = configHelper.loadConfig();
    const key = cfg.apiProvider === 'openai'
      ? (cfg.openaiApiKey || cfg.apiKey)
      : (cfg.openaiApiKeyForWhisper || cfg.openaiApiKey);
    if (key && key.startsWith('sk-')) {
      getWhisperClient(key);
      console.log('Audio: Whisper client pre-warmed ✅');
    }
  } catch { /* config not ready yet — will init lazily on first call */ }
})()

export function initializeIpcHandlers(deps: IIpcHandlerDeps): void {
  console.log("Initializing IPC handlers")

  ipcMain.handle("copy-to-clipboard", (_event, text: string) => {
    clipboard.writeText(text);
    return { success: true };
  })

  // Configuration handlers
  ipcMain.handle("get-config", () => {
    return configHelper.loadConfig();
  })

  ipcMain.handle("update-config", (_event, updates) => {
    const result = configHelper.updateConfig(updates);
    if (updates.useChatMode !== undefined) {
      if (updates.useChatMode) {
        deps.setView("chat")
        deps.getMainWindow()?.webContents.send("reset-view")
      } else {
        deps.setView("queue")
        deps.getMainWindow()?.webContents.send("reset-view")
      }
    }
    // Re-warm the Whisper client if the API key just changed
    if (updates.openaiApiKey || updates.openaiApiKeyForWhisper || updates.apiKey || updates.apiProvider) {
      try {
        const cfg = configHelper.loadConfig();
        const key = cfg.apiProvider === 'openai'
          ? (cfg.openaiApiKey || cfg.apiKey)
          : (cfg.openaiApiKeyForWhisper || cfg.openaiApiKey);
        if (key && key.startsWith('sk-')) {
          getWhisperClient(key); // will refresh if key changed
          console.log('Audio: Whisper client re-warmed after config update ✅');
        }
      } catch { /* ignore */ }
    }
    return result;
  })

  ipcMain.handle("check-api-key", () => {
    return configHelper.hasApiKey();
  })
  
  ipcMain.handle("validate-api-key", async (_event, apiKey, provider) => {
    // First check the format
    if (!configHelper.isValidApiKeyFormat(apiKey, provider)) {
      const providerName = provider === 'gemini' ? 'Gemini' : 
                           provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
      return { 
        valid: false, 
        error: `Invalid API key format for ${providerName}.` 
      };
    }
    
    // Then test the API key
    const result = await configHelper.testApiKey(apiKey, provider);
    return result;
  })

  // Credits handlers
  ipcMain.handle("set-initial-credits", async (_event, credits: number) => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) return

    try {
      // Set the credits in a way that ensures atomicity
      await mainWindow.webContents.executeJavaScript(
        `window.__CREDITS__ = ${credits}`
      )
      mainWindow.webContents.send("credits-updated", credits)
    } catch (error) {
      console.error("Error setting initial credits:", error)
      throw error
    }
  })

  ipcMain.handle("decrement-credits", async () => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) return

    try {
      const currentCredits = await mainWindow.webContents.executeJavaScript(
        "window.__CREDITS__"
      )
      if (currentCredits > 0) {
        const newCredits = currentCredits - 1
        await mainWindow.webContents.executeJavaScript(
          `window.__CREDITS__ = ${newCredits}`
        )
        mainWindow.webContents.send("credits-updated", newCredits)
      }
    } catch (error) {
      console.error("Error decrementing credits:", error)
    }
  })

  // Screenshot queue handlers
  ipcMain.handle("get-screenshot-queue", () => {
    return deps.getScreenshotQueue()
  })

  ipcMain.handle("get-extra-screenshot-queue", () => {
    return deps.getExtraScreenshotQueue()
  })

  ipcMain.handle("delete-screenshot", async (event, path: string) => {
    return deps.deleteScreenshot(path)
  })

  ipcMain.handle("get-image-preview", async (event, path: string) => {
    return deps.getImagePreview(path)
  })

  // Screenshot processing handlers
  ipcMain.handle("process-screenshots", async () => {
    // Check for API key before processing
    if (!configHelper.hasApiKey()) {
      const mainWindow = deps.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
      }
      return;
    }
    
    await deps.processingHelper?.processScreenshots()
  })

  ipcMain.handle("process-chat", async (event, messages: any[]) => {
    if (!configHelper.hasApiKey()) {
      const mainWindow = deps.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
      }
      return { success: false, error: "API key required" };
    }
    
    // We assume ProcessingHelper has processChat method implemented
    return await deps.processingHelper?.processChat(messages);
  })

  // Window dimension handlers
  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (width && height) {
        deps.setWindowDimensions(width, height)
      }
    }
  )

  ipcMain.handle(
    "set-window-dimensions",
    (event, width: number, height: number) => {
      deps.setWindowDimensions(width, height)
    }
  )

  // Screenshot management handlers
  ipcMain.handle("get-screenshots", async () => {
    try {
      let previews = []
      const currentView = deps.getView()

      if (currentView === "queue" || currentView === "chat") {
        const queue = deps.getScreenshotQueue()
        previews = await Promise.all(
          queue.map(async (path) => ({
            path,
            preview: await deps.getImagePreview(path)
          }))
        )
      } else {
        const extraQueue = deps.getExtraScreenshotQueue()
        previews = await Promise.all(
          extraQueue.map(async (path) => ({
            path,
            preview: await deps.getImagePreview(path)
          }))
        )
      }

      return previews
    } catch (error) {
      console.error("Error getting screenshots:", error)
      throw error
    }
  })

  // Screenshot trigger handlers
  ipcMain.handle("trigger-screenshot", async () => {
    const mainWindow = deps.getMainWindow()
    if (mainWindow) {
      try {
        const screenshotPath = await deps.takeScreenshot()
        const preview = await deps.getImagePreview(screenshotPath)
        mainWindow.webContents.send("screenshot-taken", {
          path: screenshotPath,
          preview
        })
        return { success: true }
      } catch (error) {
        console.error("Error triggering screenshot:", error)
        return { error: "Failed to trigger screenshot" }
      }
    }
    return { error: "No main window available" }
  })

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await deps.takeScreenshot()
      const preview = await deps.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      console.error("Error taking screenshot:", error)
      return { error: "Failed to take screenshot" }
    }
  })

  // Auth-related handlers removed

  ipcMain.handle("open-external-url", (event, url: string) => {
    shell.openExternal(url)
  })
  
  // Open external URL handler
  ipcMain.handle("openLink", (event, url: string) => {
    try {
      console.log(`Opening external URL: ${url}`);
      shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error(`Error opening URL ${url}:`, error);
      return { success: false, error: `Failed to open URL: ${error}` };
    }
  })

  // Settings portal handler
  ipcMain.handle("open-settings-portal", () => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send("show-settings-dialog");
      return { success: true };
    }
    return { success: false, error: "Main window not available" };
  })

  // Window management handlers
  ipcMain.handle("toggle-window", () => {
    try {
      deps.toggleMainWindow()
      return { success: true }
    } catch (error) {
      console.error("Error toggling window:", error)
      return { error: "Failed to toggle window" }
    }
  })

  ipcMain.handle("toggle-click-through", () => {
    try {
      deps.toggleClickThrough()
      return { success: true }
    } catch (error) {
      console.error("Error toggling click-through:", error)
      return { error: "Failed to toggle click-through" }
    }
  })

  ipcMain.handle("reset-queues", async () => {
    try {
      deps.clearQueues()
      return { success: true }
    } catch (error) {
      console.error("Error resetting queues:", error)
      return { error: "Failed to reset queues" }
    }
  })

  // Process screenshot handlers
  ipcMain.handle("trigger-process-screenshots", async () => {
    try {
      // Check for API key before processing
      if (!configHelper.hasApiKey()) {
        const mainWindow = deps.getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
        }
        return { success: false, error: "API key required" };
      }
      
      await deps.processingHelper?.processScreenshots()
      return { success: true }
    } catch (error) {
      console.error("Error processing screenshots:", error)
      return { error: "Failed to process screenshots" }
    }
  })

  ipcMain.handle("trigger-dry-run", async (event, code: string, language: string) => {
    try {
      if (!configHelper.hasApiKey()) {
        const mainWindow = deps.getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
        }
        return { success: false, error: "API key required" };
      }
      
      await deps.processingHelper?.processDryRun(code, language)
      return { success: true }
    } catch (error) {
      console.error("Error triggering dry run:", error)
      return { error: "Failed to trigger dry run" }
    }
  })


  // Reset handlers
  ipcMain.handle("trigger-reset", () => {
    try {
      // First cancel any ongoing requests
      deps.processingHelper?.cancelOngoingRequests()

      // Clear all queues immediately
      deps.clearQueues()

      // Reset view to queue
      deps.setView("queue")

      // Get main window and send reset events
      const mainWindow = deps.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Send reset events in sequence
        mainWindow.webContents.send("reset-view")
        mainWindow.webContents.send("reset")
      }

      return { success: true }
    } catch (error) {
      console.error("Error triggering reset:", error)
      return { error: "Failed to trigger reset" }
    }
  })

  // Window movement handlers
  ipcMain.handle("trigger-move-left", () => {
    try {
      deps.moveWindowLeft()
      return { success: true }
    } catch (error) {
      console.error("Error moving window left:", error)
      return { error: "Failed to move window left" }
    }
  })

  ipcMain.handle("trigger-move-right", () => {
    try {
      deps.moveWindowRight()
      return { success: true }
    } catch (error) {
      console.error("Error moving window right:", error)
      return { error: "Failed to move window right" }
    }
  })

  ipcMain.handle("trigger-move-up", () => {
    try {
      deps.moveWindowUp()
      return { success: true }
    } catch (error) {
      console.error("Error moving window up:", error)
      return { error: "Failed to move window up" }
    }
  })

  ipcMain.handle("trigger-move-down", () => {
    try {
      deps.moveWindowDown()
      return { success: true }
    } catch (error) {
      console.error("Error moving window down:", error)
      return { error: "Failed to move window down" }
    }
  })
  
  // Delete last screenshot handler
  ipcMain.handle("delete-last-screenshot", async () => {
    try {
      const queue = deps.getView() === "queue" 
        ? deps.getScreenshotQueue() 
        : deps.getExtraScreenshotQueue()
      
      if (queue.length === 0) {
        return { success: false, error: "No screenshots to delete" }
      }
      
      // Get the last screenshot in the queue
      const lastScreenshot = queue[queue.length - 1]
      
      // Delete it
      const result = await deps.deleteScreenshot(lastScreenshot)
      
      // Notify the renderer about the change
      const mainWindow = deps.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screenshot-deleted", { path: lastScreenshot })
      }
      
      return result
    } catch (error) {
      console.error("Error deleting last screenshot:", error)
      return { success: false, error: "Failed to delete last screenshot" }
    }
  })

  // Explain line handler
  ipcMain.handle("explain-line", async (_event, { line, lineNumber, fullCode, language }: {
    line: string;
    lineNumber: number;
    fullCode: string;
    language: string;
  }) => {
    try {
      if (!deps.processingHelper) {
        return { success: false, error: "Processing helper not initialized" };
      }
      return await deps.processingHelper.explainLine(line, lineNumber, fullCode, language);
    } catch (error: any) {
      return { success: false, error: error.message || "Failed to explain line" };
    }
  })

  ipcMain.handle("generate-audio-hint", async (_event, { transcript, fullCode, language }: {
    transcript: string;
    fullCode: string;
    language: string;
  }) => {
    try {
      if (!deps.processingHelper) {
        return { success: false, error: "Processing helper not initialized" };
      }
      return await deps.processingHelper.generateAudioHint(transcript, fullCode, language);
    } catch (error: any) {
      return { success: false, error: error.message || "Failed to generate audio hint" };
    }
  })

  // Whisper Audio Interception Handlers
  ipcMain.handle("get-desktop-sources", async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"], fetchWindowIcons: false });
      return sources.map(source => ({
        id: source.id,
        name: source.name,
      }));
    } catch (e: any) {
      console.error("Failed to get desktop sources:", e);
      return [];
    }
  });

  ipcMain.handle("process-audio-buffer", async (_event, base64Buffer: string) => {
    const t0 = Date.now();
    try {
      // ── Step 1: Decode base64 → Buffer (synchronous, ~0ms) ──────────────────
      const buffer = Buffer.from(base64Buffer, 'base64');
      console.log(`Audio: ${buffer.length} bytes received`);

      // ── Step 2: Resolve API key ──────────────────────────────────────────────
      const config = configHelper.loadConfig();
      const apiKey = config.apiProvider === 'openai'
        ? (config.openaiApiKey || config.apiKey)
        : (config.openaiApiKeyForWhisper || config.openaiApiKey);

      if (!apiKey || !apiKey.startsWith('sk-')) {
        return { success: false, error: "OpenAI API key required for Whisper audio transcription." };
      }

      // ── Step 3: Build an in-memory File object — zero disk I/O ──────────────
      // toFile() wraps a Buffer into the File interface the SDK expects.
      // No temp file write → no fsync latency → no cleanup race conditions.
      const audioFile = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });

      // ── Step 4: Transcribe with the singleton client ─────────────────────────
      // response_format 'text' skips JSON serialization/deserialization on both
      // sides — Whisper returns a bare string, saving another ~10-30ms.
      const openai = getWhisperClient(apiKey);
      const transcript = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'en',
        temperature: 0,
        response_format: 'text',
        prompt: 'Software engineering technical interview question or coding problem transcript.',
      }) as unknown as string; // SDK types response_format='text' as TranscriptionCreateResponse but returns string

      console.log(`Audio: transcription done in ${Date.now() - t0}ms → "${String(transcript).slice(0, 80)}"`);

      if (!transcript || String(transcript).trim().length < 5) {
        return { success: false, error: "No clear speech detected. Please speak clearly and try again." };
      }

      return { success: true, transcript: String(transcript).trim() };

    } catch (err: any) {
      console.error(`Audio: transcription failed after ${Date.now() - t0}ms:`, err);
      return { success: false, error: err.message || "Audio transcription failed" };
    }
  });

  // ── PIPELINED: Transcribe + Hint in a single IPC round trip ──────────────
  // Instead of: renderer→Whisper→renderer→LLM→renderer (2 IPC round trips)
  // This does:  renderer→[Whisper, then LLM]→renderer (1 IPC round trip)
  // Sends the transcript back as an IPC event as soon as Whisper finishes,
  // so the UI can show it immediately while the LLM hint is still generating.
  ipcMain.handle("process-audio-and-hint", async (_event, { base64Buffer, fullCode, language }: {
    base64Buffer: string;
    fullCode: string;
    language: string;
  }) => {
    const t0 = Date.now();
    try {
      // ── Step 1: Decode + resolve key ──
      const buffer = Buffer.from(base64Buffer, 'base64');
      const config = configHelper.loadConfig();
      const apiKey = config.apiProvider === 'openai'
        ? (config.openaiApiKey || config.apiKey)
        : (config.openaiApiKeyForWhisper || config.openaiApiKey);

      if (!apiKey || !apiKey.startsWith('sk-')) {
        return { success: false, error: "OpenAI API key required for Whisper audio transcription." };
      }

      // ── Step 2: Whisper transcription (in-memory, singleton) ──
      const audioFile = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });
      const openai = getWhisperClient(apiKey);
      const transcript = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'en',
        temperature: 0,
        response_format: 'text',
        prompt: 'Software engineering technical interview question or coding problem transcript.',
      }) as unknown as string;

      const cleanTranscript = String(transcript).trim();
      console.log(`Audio: transcription done in ${Date.now() - t0}ms → "${cleanTranscript.slice(0, 80)}"`);

      if (!cleanTranscript || cleanTranscript.length < 5) {
        return { success: false, error: "No clear speech detected. Please speak clearly and try again." };
      }

      // ── Step 3: Send transcript to UI immediately via event ──
      // UI can display the transcript while we generate the hint
      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("audio-transcript-ready", cleanTranscript);
      }

      // ── Step 4: Generate hint in the same call — zero IPC overhead ──
      let hint = "";
      if (deps.processingHelper) {
        const hintResult = await deps.processingHelper.generateAudioHint(cleanTranscript, fullCode, language);
        if (hintResult.success && hintResult.hint) {
          hint = hintResult.hint;
        }
      }

      console.log(`Audio: full pipeline done in ${Date.now() - t0}ms`);
      return { success: true, transcript: cleanTranscript, hint };

    } catch (err: any) {
      console.error(`Audio: pipeline failed after ${Date.now() - t0}ms:`, err);
      return { success: false, error: err.message || "Audio pipeline failed" };
    }
  });
}

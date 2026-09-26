import React, { useEffect } from 'react';
import { useToast } from '../../contexts/toast';

interface AudioListenerProps {
  onAudioResult: (transcript: string) => void;
  onAudioHintResult?: (result: { transcript: string; hint: string }) => void;
  onAudioError: (error: string) => void;
  onProcessingStart: () => void;
  fullCode?: string;
  language?: string;
}

/**
 * Use window-level storage for audio capture state.
 * This survives Vite HMR, React remounts, and view changes.
 * Module-level variables get wiped by HMR; window does not.
 */
interface WindowAudioState {
  stream: MediaStream | null;
  audioStream: MediaStream | null; // The pure audio-only stream for recorders
  recorder: MediaRecorder | null;
  lastFinalizedBlob: Blob | null;  // Browser-finalized WebM from the previous rotation
  currentChunks: Blob[];           // Chunks accumulating in the current recorder
  initError: string | null;
  ready: boolean;
  initializing: boolean;
  mimeType: string;
  rotationTimer: ReturnType<typeof setInterval> | null;
}

function getAudioState(): WindowAudioState {
  if (!(window as any).__audioCapture) {
    (window as any).__audioCapture = {
      stream: null,
      audioStream: null,
      recorder: null,
      lastFinalizedBlob: null,
      currentChunks: [],
      initError: null,
      ready: false,
      initializing: false,
      mimeType: '',
      rotationTimer: null,
    };
  }
  return (window as any).__audioCapture;
}

// How often we silently rotate the recorder to keep blobs fresh (55 seconds)
const ROTATION_MS = 55_000;

/**
 * Stop a MediaRecorder and wait for the browser to natively finalize the WebM.
 * Returns a perfectly valid, complete WebM blob (with EBML header + closing tags).
 */
function stopAndFinalize(recorder: MediaRecorder, chunks: Blob[]): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (recorder.state === 'inactive') {
      // Already stopped
      if (chunks.length > 0) {
        resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      } else {
        resolve(null);
      }
      return;
    }

    const origOnData = recorder.ondataavailable;
    const origOnStop = recorder.onstop;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      // Restore original handlers
      recorder.ondataavailable = origOnData;
      recorder.onstop = origOnStop;

      if (chunks.length > 0) {
        resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      } else {
        resolve(null);
      }
    };

    recorder.stop(); // Browser writes proper EBML closing tags → valid WebM
  });
}

/**
 * Start a new MediaRecorder on the given audio stream.
 * Uses start(1000) so we get periodic chunks for progress tracking.
 */
function startNewRecorder(state: WindowAudioState): void {
  if (!state.audioStream || state.audioStream.getAudioTracks().every(t => t.readyState === 'ended')) {
    console.warn("Audio: Cannot start recorder, no active audio tracks.");
    state.ready = false;
    return;
  }

  state.currentChunks = [];

  const recorder = new MediaRecorder(
    state.audioStream,
    state.mimeType ? { mimeType: state.mimeType } : undefined
  );

  const MAX_CHUNKS = 17; // 1 header chunk + 16 audio data chunks = 16 seconds of audio

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      const s = getAudioState();
      s.currentChunks.push(e.data);
      if (s.currentChunks.length > MAX_CHUNKS) {
        // Keep the WebM header (index 0) and remove the oldest audio chunk (index 1)
        s.currentChunks.splice(1, 1);
      }
    }
  };

  recorder.onerror = (e: any) => console.error("MediaRecorder error:", e.error || e);

  recorder.start(1000);
  state.recorder = recorder;
  state.ready = true;
  console.log("Audio: ✅ New recorder started.");
}

/**
 * Silent background rotation: stop the current recorder (producing a finalized blob),
 * save it as lastFinalizedBlob, then immediately start a new recorder.
 * This keeps memory bounded and ensures we always have a recent, valid WebM ready.
 */
async function rotateRecorder(): Promise<void> {
  const state = getAudioState();
  if (!state.recorder || state.recorder.state !== 'recording') return;

  const chunks = [...state.currentChunks];
  const blob = await stopAndFinalize(state.recorder, chunks);

  if (blob && blob.size > 1000) { // Only keep if meaningful audio
    state.lastFinalizedBlob = blob;
    console.log(`Audio: 🔄 Rotation complete. Saved ${blob.size} bytes.`);
  }

  // Start fresh
  startNewRecorder(state);
}

async function ensureAudioCapture(): Promise<void> {
  const state = getAudioState();

  if (state.ready && state.recorder && state.recorder.state === 'recording') return;
  if (state.initializing) return;

  state.initializing = true;
  state.initError = null;

  let audioStream: MediaStream | null = null;

  // ─── Strategy 1: getDisplayMedia (system audio loopback) ───
  try {
    console.log("Audio: Trying getDisplayMedia...");
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true
    });

    const audioTracks = displayStream.getAudioTracks();
    displayStream.getVideoTracks().forEach(track => track.stop());

    if (audioTracks.length > 0) {
      audioStream = new MediaStream(audioTracks);
      state.stream = displayStream;
      console.log("Audio: ✅ System audio via getDisplayMedia. Tracks:", audioTracks.length);
    } else {
      displayStream.getTracks().forEach(t => t.stop());
      console.warn("Audio: getDisplayMedia returned 0 audio tracks.");
    }
  } catch (err: any) {
    console.warn("Audio: getDisplayMedia failed:", err.message);
  }

  // ─── Strategy 2: getUserMedia with desktop source ───
  if (!audioStream) {
    try {
      console.log("Audio: Trying getUserMedia desktop...");
      const sources = await window.electronAPI.getDesktopSources();
      if (sources && sources.length > 0) {
        const source = sources.find((s: any) => s.id.startsWith('screen')) || sources[0];
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'desktop' } } as any,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id } } as any
        });

        const audioTracks = stream.getAudioTracks();
        stream.getVideoTracks().forEach(track => track.stop());

        if (audioTracks.length > 0) {
          audioStream = new MediaStream(audioTracks);
          state.stream = stream;
          console.log("Audio: ✅ System audio via getUserMedia desktop. Tracks:", audioTracks.length);
        } else {
          stream.getTracks().forEach(t => t.stop());
          console.warn("Audio: getUserMedia desktop returned 0 audio tracks.");
        }
      }
    } catch (err: any) {
      console.warn("Audio: getUserMedia desktop failed:", err.message);
    }
  }

  // ─── Strategy 3: Microphone ───
  if (!audioStream) {
    try {
      console.log("Audio: Trying microphone fallback...");
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const audioTracks = micStream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioStream = new MediaStream(audioTracks);
        state.stream = micStream;
        console.log("Audio: ✅ Microphone captured. Tracks:", audioTracks.length);
      }
    } catch (err: any) {
      console.warn("Audio: Microphone failed:", err.message);
    }
  }

  if (!audioStream) {
    state.initError = "Could not capture audio. Grant Screen Recording & Microphone permissions.";
    state.initializing = false;
    console.error("Audio:", state.initError);
    return;
  }

  // Track end handler
  audioStream.getAudioTracks().forEach(t => {
    console.log(`Audio track: label="${t.label}" enabled=${t.enabled} muted=${t.muted} state=${t.readyState}`);
    t.onended = () => {
      console.warn("Audio: Track ended. Will re-init on next trigger.");
      const s = getAudioState();
      s.ready = false;
      s.recorder = null;
      s.audioStream = null;
      if (s.rotationTimer) clearInterval(s.rotationTimer);
      s.rotationTimer = null;
    };
  });

  // Determine mimeType
  let mimeType = 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';
  }
  state.mimeType = mimeType;
  state.audioStream = audioStream;

  // Start the first recorder
  startNewRecorder(state);

  // Set up silent background rotation every 55 seconds
  if (state.rotationTimer) clearInterval(state.rotationTimer);
  state.rotationTimer = setInterval(() => {
    rotateRecorder().catch(err => console.error("Audio: rotation error:", err));
  }, ROTATION_MS);

  state.initializing = false;
  state.initError = null;
  console.log(`Audio: ✅ System ready (${mimeType || 'default'}). Rotation every ${ROTATION_MS / 1000}s.`);
}

// Auto-start after a short delay (works with Chromium flags)
if (!(window as any).__audioCaptureInitialized) {
  (window as any).__audioCaptureInitialized = true;
  setTimeout(() => {
    ensureAudioCapture().catch(err => {
      console.warn("Audio: Early init failed:", err);
    });
  }, 2000);
}


export const AudioListener: React.FC<AudioListenerProps> = ({
  onAudioResult,
  onAudioHintResult,
  onAudioError,
  onProcessingStart,
  fullCode = '',
  language = 'python',
}) => {
  const { showToast } = useToast();

  useEffect(() => {
    // Listen for early transcript delivery from the pipelined handler
    const cleanupTranscript = window.electronAPI.onAudioTranscriptReady?.((transcript: string) => {
      onAudioResult(transcript);
    });

    const cleanupShortcut = window.electronAPI.onTriggerAudioProcessing(async () => {
      const state = getAudioState();
      console.log(`Audio shortcut! ready=${state.ready} chunks=${state.currentChunks.length} lastBlob=${state.lastFinalizedBlob?.size ?? 0} recording=${state.recorder?.state} err=${state.initError}`);

      // Lazy init if not ready
      if (!state.ready) {
        console.log("Audio: Not ready, attempting init...");
        await ensureAudioCapture();
        const s = getAudioState();
        if (!s.ready) {
          onAudioError(s.initError || "Audio capture failed. Check permissions.");
          return;
        }
        onAudioError("Audio capture just started! Wait a few seconds and press ⌘+Shift+H again.");
        return;
      }

      // Need at least some audio
      if (state.currentChunks.length === 0 && !state.lastFinalizedBlob) {
        onAudioError("No audio captured yet. Wait a few seconds for audio to accumulate.");
        return;
      }

      onProcessingStart();

      try {
        // ── ZERO-WAIT CAPTURE: Instant synchronous blob creation ──
        let blob: Blob | null = null;

        if (state.recorder && state.recorder.state === 'recording' && state.currentChunks.length > 0) {
          try {
            state.recorder.requestData();
          } catch (e) {
            console.warn("requestData failed:", e);
          }
          blob = new Blob(state.currentChunks, { type: state.mimeType || 'audio/webm' });
        }

        // Fall back to last rotation's blob if current is too short
        if (!blob || blob.size < 1000) {
          blob = state.lastFinalizedBlob;
        }

        if (!blob || blob.size < 1000) {
          onAudioError("Not enough audio captured. Wait a few more seconds and try again.");
          return;
        }

        console.log(`Audio: Sending WebM blob: ${blob.size} bytes`);

        // Convert to base64 via chunked String.fromCharCode (sub-millisecond, zero overhead)
        const arrayBuf = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        let binary = '';
        const chunkSize = 0x8000; // 32KB chunks to prevent stack limits and string allocation lag
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as unknown as number[]);
        }
        const base64Buffer = btoa(binary);

        // ── PIPELINED: Single IPC call for transcription + hint ──
        // The main process does Whisper → LLM in one round trip.
        // It fires 'audio-transcript-ready' as soon as Whisper finishes
        // (handled by cleanupTranscript listener above), so the UI shows
        // the transcript immediately while the LLM hint generates.
        if (window.electronAPI.processAudioAndHint && onAudioHintResult) {
          const result = await window.electronAPI.processAudioAndHint({
            base64Buffer,
            fullCode,
            language,
          });

          if (result.success && result.transcript) {
            if (result.hint) {
              onAudioHintResult({ transcript: result.transcript, hint: result.hint });
            }
            // transcript was already sent via the early event listener
          } else {
            onAudioError(result.error || "Unknown audio processing error");
          }
        } else {
          // Fallback: old two-step flow
          const result = await window.electronAPI.processAudioBuffer(base64Buffer);
          if (result.success && result.transcript) {
            onAudioResult(result.transcript);
          } else {
            onAudioError(result.error || "Unknown audio processing error");
          }
        }
      } catch (err: any) {
        console.error("Audio: Error processing:", err);
        onAudioError(err.message || "Failed to process audio");
      }
    });

    return () => {
      if (cleanupShortcut) cleanupShortcut();
      if (cleanupTranscript) cleanupTranscript();
    };
  }, [onAudioResult, onAudioHintResult, onAudioError, onProcessingStart, fullCode, language]);

  return null;
};

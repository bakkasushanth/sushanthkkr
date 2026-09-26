import React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import Queue from "../_pages/Queue"
import Solutions from "../_pages/Solutions"
import Chat from "../_pages/Chat"
import { useToast } from "../contexts/toast"
import { AudioListener } from "../components/Audio/AudioListener"

interface SubscribedAppProps {
  credits: number
  currentLanguage: string
  setLanguage: (language: string) => void
}

const SubscribedApp: React.FC<SubscribedAppProps> = ({
  credits,
  currentLanguage,
  setLanguage
}) => {
  const queryClient = useQueryClient()
  const [view, setView] = useState<"queue" | "solutions" | "debug" | "chat">("queue")
  const [useChatMode, setUseChatMode] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()

  const [audioHintState, setAudioHintState] = useState<{
    transcript: string | null;
    hint: string | null;
    loading: boolean;
    error: string | null;
  }>({ transcript: null, hint: null, loading: false, error: null });

  // Let's ensure we reset queries etc. if some electron signals happen
  useEffect(() => {
    const cleanup = window.electronAPI.onResetView(() => {
      queryClient.invalidateQueries({
        queryKey: ["screenshots"]
      })
      queryClient.invalidateQueries({
        queryKey: ["problem_statement"]
      })
      queryClient.invalidateQueries({
        queryKey: ["solution"]
      })
      queryClient.invalidateQueries({
        queryKey: ["new_solution"]
      })
      if (useChatMode) {
        setView("chat")
      } else {
        setView("queue")
      }
    })

    return () => {
      cleanup()
    }
  }, [useChatMode])

  // Dynamically update the window size
  useEffect(() => {
    if (!containerRef.current) return

    const updateDimensions = () => {
      if (!containerRef.current) return
      const height = containerRef.current.scrollHeight || 600
      const width = containerRef.current.scrollWidth || 800
      window.electronAPI?.updateContentDimensions({ width, height })
    }

    // Force initial dimension update immediately
    updateDimensions()
    
    // Set a fallback timer to ensure dimensions are set even if content isn't fully loaded
    const fallbackTimer = setTimeout(() => {
      window.electronAPI?.updateContentDimensions({ width: 800, height: 600 })
    }, 500)

    const resizeObserver = new ResizeObserver(updateDimensions)
    resizeObserver.observe(containerRef.current)

    // Also watch DOM changes
    const mutationObserver = new MutationObserver(updateDimensions)
    mutationObserver.observe(containerRef.current, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })

    // Do another update after a delay to catch any late-loading content
    const delayedUpdate = setTimeout(updateDimensions, 1000)

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      clearTimeout(fallbackTimer)
      clearTimeout(delayedUpdate)
    }
  }, [view])

  // Listen for events that might switch views or show errors
  useEffect(() => {
    const cleanupFunctions = [
      window.electronAPI.onSolutionStart(() => {
        setView("solutions")
      }),
      window.electronAPI.onUnauthorized(() => {
        queryClient.removeQueries({
          queryKey: ["screenshots"]
        })
        queryClient.removeQueries({
          queryKey: ["solution"]
        })
        queryClient.removeQueries({
          queryKey: ["problem_statement"]
        })
        setView("queue")
      }),
      window.electronAPI.onResetView(() => {
        queryClient.removeQueries({
          queryKey: ["screenshots"]
        })
        queryClient.removeQueries({
          queryKey: ["solution"]
        })
        queryClient.removeQueries({
          queryKey: ["problem_statement"]
        })
        if (useChatMode) {
          setView("chat")
        } else {
          setView("queue")
        }
      }),
      window.electronAPI.onResetView(() => {
        queryClient.setQueryData(["problem_statement"], null)
      }),
      window.electronAPI.onProblemExtracted((data: any) => {
        if (view === "queue") {
          queryClient.invalidateQueries({
            queryKey: ["problem_statement"]
          })
          queryClient.setQueryData(["problem_statement"], data)
        }
      }),
      window.electronAPI.onSolutionError((error: string) => {
        showToast("Error", error, "error")
      }),
      window.electronAPI.onChatStart(() => {
        setView("chat")
      }),
      // We will handle onChatSuccess and onChatError inside Chat.tsx
    ]
    return () => cleanupFunctions.forEach((fn) => fn())
  }, [view, showToast, queryClient])

  // Load chat mode preference
  useEffect(() => {
    window.electronAPI.getConfig().then((config: any) => {
      if (config.useChatMode !== false) {
        setUseChatMode(true)
        setView("chat")
      } else {
        setUseChatMode(false)
        setView("queue")
      }
    }).catch(console.error)
  }, [])

  return (
    <div ref={containerRef} className="min-h-0 relative">
      <AudioListener
        fullCode={(queryClient.getQueryData(["solution"]) as { code?: string } | undefined)?.code || ""}
        language={currentLanguage}
        onProcessingStart={() => {
          setAudioHintState({ transcript: null, hint: null, loading: true, error: null });
        }}
        onAudioResult={(transcript) => {
          // Early transcript delivery from the pipelined handler
          setAudioHintState(prev => ({ ...prev, transcript, loading: true, error: null }));
        }}
        onAudioHintResult={({ transcript, hint }) => {
          // Pipelined: both transcript + hint arrive together
          setAudioHintState({ transcript, hint, loading: false, error: null });
        }}
        onAudioError={(error) => {
          setAudioHintState({ transcript: null, hint: null, loading: false, error });
        }}
      />

      {/* Audio Hint Panel */}
      {(audioHintState.loading || audioHintState.hint || audioHintState.error) && (
        <div className="mx-4 mt-3 mb-3 p-3 rounded-lg border border-emerald-400/30 bg-emerald-950/60 backdrop-blur-sm text-[12px] leading-relaxed text-gray-100 relative z-50">
          <button
            onClick={() => setAudioHintState({ transcript: null, hint: null, loading: false, error: null })}
            className="absolute top-1.5 right-2 text-white/40 hover:text-white/80 text-[10px] transition hide-in-disguise"
          >
            ✕
          </button>
          <div className="text-[10px] text-emerald-300/80 mb-1.5 font-medium hide-in-disguise">
            Notes
          </div>
          
          {audioHintState.transcript && (
            <div className="text-[10px] text-gray-400 italic mb-2 pb-2 border-b border-white/10 hide-in-disguise">
              "{audioHintState.transcript}"
            </div>
          )}

          {audioHintState.loading ? (
            <p className="text-xs bg-gradient-to-r from-emerald-300 via-emerald-100 to-emerald-300 bg-clip-text text-transparent animate-pulse hide-in-disguise">
              {audioHintState.transcript ? "Thinking..." : "Processing..."}
            </p>
          ) : audioHintState.error ? (
            <p className="text-red-400 text-xs">{audioHintState.error}</p>
          ) : (
            <p className="text-gray-200 whitespace-pre-wrap">{audioHintState.hint}</p>
          )}
        </div>
      )}

      {view === "queue" ? (
        <Queue
          setView={setView}
          credits={credits}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
        />
      ) : view === "solutions" ? (
        <Solutions
          setView={setView}
          credits={credits}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
        />
      ) : view === "chat" ? (
        <Chat
          setView={setView}
          credits={credits}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
        />
      ) : null}
    </div>
  )
}

export default SubscribedApp

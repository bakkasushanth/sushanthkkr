import React, { useState, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import ScreenshotQueue from "../components/Queue/ScreenshotQueue"
import { Screenshot } from "../types/screenshots"
import { COMMAND_KEY } from "../utils/platform"
import { useToast } from "../contexts/toast"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  images?: { data: string; mimeType: string }[]
  thumbnails?: string[] // For displaying in UI without full data
}

interface ChatProps {
  setView: (view: "queue" | "solutions" | "debug" | "chat" | "chat") => void
  credits: number
  currentLanguage: string
  setLanguage: (language: string) => void
}

const Chat: React.FC<ChatProps> = ({ setView }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const submitButtonRef = useRef<HTMLButtonElement>(null)
  const { showToast } = useToast()
  const queryClient = useQueryClient()

  // Fetch screenshots from queue
  const { data: screenshots = [], refetch: refetchScreenshots } = useQuery<Screenshot[]>({
    queryKey: ["screenshots"],
    queryFn: async () => {
      return await window.electronAPI.getScreenshots()
    },
    refetchOnWindowFocus: true
  })

  // Auto-scroll
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  // Listen for chat updates
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onChatSuccess((data: string) => {
        setIsProcessing(false)
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: data }
        ])
      }),
      window.electronAPI.onChatError((error: string) => {
        setIsProcessing(false)
        showToast("Error", error, "error")
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: `**Error:** ${error}` }
        ])
      }),
      window.electronAPI.onScreenshotTaken(() => {
        refetchScreenshots()
      }),
      window.electronAPI.onTriggerChatSubmit(() => {
        submitButtonRef.current?.click()
      })
    ]
    return () => cleanups.forEach(fn => fn())
  }, [showToast, refetchScreenshots])

  // Update window dimensions
  useEffect(() => {
    const updateDimensions = () => {
      if (contentRef.current) {
        const height = contentRef.current.scrollHeight
        const width = contentRef.current.scrollWidth
        window.electronAPI.updateContentDimensions({ width, height })
      }
    }

    const resizeObserver = new ResizeObserver(updateDimensions)
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current)
    }
    updateDimensions()

    return () => resizeObserver.disconnect()
  }, [messages, screenshots])

  const handleDeleteScreenshot = async (index: number) => {
    const screenshotToDelete = screenshots[index]
    try {
      const response = await window.electronAPI.deleteScreenshot(screenshotToDelete.path)
      if (response.success) {
        refetchScreenshots()
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleSubmit = async () => {
    if (!inputText.trim() && screenshots.length === 0) return

    setIsProcessing(true)

    // Prepare images for backend
    const imagesForBackend = screenshots.map(s => {
      // preview is "data:image/png;base64,....."
      // we need to split it
      const [header, data] = s.preview.split(",")
      const mimeType = header.replace("data:", "").replace(";base64", "")
      return { data, mimeType }
    })

    const thumbnails = screenshots.map(s => s.preview)

    const newUserMsg: ChatMessage = {
      role: "user",
      content: inputText,
      images: imagesForBackend.length > 0 ? imagesForBackend : undefined,
      thumbnails: thumbnails.length > 0 ? thumbnails : undefined
    }

    setMessages(prev => [...prev, newUserMsg])
    setInputText("")

    // Clear screenshots queue immediately in frontend
    await window.electronAPI.resetQueues()
    refetchScreenshots()

    // Send to backend
    const updatedMessages = [...messages, newUserMsg]
    await window.electronAPI.processChat(updatedMessages)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      if (!isProcessing) handleSubmit()
    }
  }

  return (
    <div ref={contentRef} className="flex flex-col bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl text-gray-200 p-4" style={{ minWidth: '400px' }}>
      
      {/* Header */}
      <div className="flex justify-between items-center pb-2 border-b border-white/10 mb-4">
        <h2 className="text-sm font-semibold text-white/80">Chat Mode</h2>
        <button 
          onClick={() => window.electronAPI.openSettingsPortal()}
          className="text-xs text-white/50 hover:text-white transition-colors"
        >
          Settings
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2 custom-scrollbar max-h-[500px]">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-white/40 space-y-2">
            <p className="text-sm font-medium">Welcome to Chat Mode!</p>
            <p className="text-xs">Take screenshots and ask questions here.</p>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div 
              className={`max-w-[85%] rounded-lg p-3 ${
                msg.role === 'user' 
                  ? 'bg-blue-600/20 border border-blue-500/30 text-white' 
                  : 'bg-white/5 border border-white/10 text-gray-200'
              }`}
            >
              {msg.thumbnails && msg.thumbnails.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-2">
                  {msg.thumbnails.map((t, i) => (
                    <img key={i} src={t} alt="Attached" className="w-20 h-auto rounded border border-white/20" />
                  ))}
                </div>
              )}
              
              {msg.role === 'user' ? (
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
              ) : (
                <div className="text-sm prose prose-invert max-w-none prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ))}
        {isProcessing && (
          <div className="flex items-start">
            <div className="max-w-[85%] rounded-lg p-3 bg-white/5 border border-white/10">
              <span className="text-sm text-white/50 animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border border-white/10 bg-white/5 rounded-xl p-3 flex flex-col gap-3 shrink-0">
        {screenshots.length > 0 && (
          <div className="flex overflow-x-auto custom-scrollbar pb-2">
            <ScreenshotQueue
              isLoading={isProcessing}
              screenshots={screenshots}
              onDeleteScreenshot={handleDeleteScreenshot}
            />
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask a question... (${COMMAND_KEY} + Enter to send)`}
            className="flex-1 bg-transparent text-sm text-white placeholder-white/30 resize-none outline-none max-h-32 custom-scrollbar"
            rows={1}
            style={{ minHeight: "20px" }}
          />
          <button
            ref={submitButtonRef}
            onClick={handleSubmit}
            disabled={isProcessing || (!inputText.trim() && screenshots.length === 0)}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Send
          </button>
        </div>
      </div>

    </div>
  )
}

export default Chat

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Settings } from "lucide-react";
import { useToast } from "../../contexts/toast";

type APIProvider = "openai" | "gemini" | "anthropic";

type AIModel = {
  id: string;
  name: string;
  description: string;
};

type ModelCategory = {
  key: 'extractionModel' | 'solutionModel' | 'debuggingModel';
  title: string;
  description: string;
  openaiModels: AIModel[];
  geminiModels: AIModel[];
  anthropicModels: AIModel[];
};

// Define available models for each category
const modelCategories: ModelCategory[] = [
  {
    key: 'extractionModel',
    title: 'Problem Extraction',
    description: 'Model used to analyze screenshots and extract problem details',
    openaiModels: [
      {
        id: "gpt-5",
        name: "GPT-5",
        description: "Most advanced — best accuracy for extraction"
      },
      {
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        description: "Lightweight GPT-5 variant, fast & affordable"
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        description: "Fast & highly capable"
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        description: "Budget-friendly, solid performance"
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        description: "Previous gen flagship, reliable"
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        description: "Most cost-effective GPT-4 option"
      },
      {
        id: "o3",
        name: "o3",
        description: "Reasoning model — best for complex problems"
      },
      {
        id: "o4-mini",
        name: "o4-mini",
        description: "Lightweight reasoning model"
      }
    ],
    geminiModels: [
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Most capable — best accuracy for extraction"
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Fast & efficient, great balance"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Previous gen, still capable"
      },
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Stable, battle-tested"
      }
    ],
    anthropicModels: [
      {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        description: "Anthropic's flagship model for most complex tasks",
      },
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        description: "Latest Sonnet 5 model"
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        description: "Latest Haiku 4.5 model"
      },
      {
        id: "claude-opus-4-6-20251101",
        name: "Claude Opus 5.5 Old.6",
        description: "Highly intelligent — top-tier reasoning"
      },
      {
        id: "claude-opus-5-5-old",
        name: "Claude Opus 5.5 Old",
        description: "Most intelligent — best for complex extractions"
      },
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        description: "Best balance of speed and intelligence"
      },
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Latest & most capable — top-tier reasoning"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Highly intelligent — excellent balance"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Previous gen flagship — good for complex tasks"
      },
      {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        description: "Fastest & most cost-effective"
      }
    ]
  },
  {
    key: 'solutionModel',
    title: 'Solution Generation',
    description: 'Model used to generate coding solutions',
    openaiModels: [
      {
        id: "gpt-5",
        name: "GPT-5",
        description: "Most advanced — best solution quality"
      },
      {
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        description: "Lightweight GPT-5 variant, fast & affordable"
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        description: "Fast & highly capable"
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        description: "Budget-friendly, solid coding performance"
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        description: "Previous gen flagship"
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        description: "Most cost-effective GPT-4 option"
      },
      {
        id: "o3",
        name: "o3",
        description: "Reasoning model — great for algorithmic problems"
      },
      {
        id: "o4-mini",
        name: "o4-mini",
        description: "Lightweight reasoning model"
      }
    ],
    geminiModels: [
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Most capable — best solution quality"
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Fast & efficient, great balance"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Previous gen, still capable"
      },
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Stable, battle-tested"
      }
    ],
    anthropicModels: [
      {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        description: "Anthropic's flagship model for most complex tasks",
      },
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        description: "Latest Sonnet 5 model"
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        description: "Latest Haiku 4.5 model"
      },
      {
        id: "claude-opus-4-6-20251101",
        name: "Claude Opus 5.5 Old.6",
        description: "Highly intelligent — top-tier reasoning"
      },
      {
        id: "claude-opus-5-5-old",
        name: "Claude Opus 5.5 Old",
        description: "Most intelligent — best for complex extractions"
      },
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        description: "Best balance of speed and intelligence"
      },
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Latest & most capable — top-tier coding"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Highly intelligent — excellent balance"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Previous gen flagship — good for complex tasks"
      },
      {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        description: "Fastest & most cost-effective"
      }
    ]
  },
  {
    key: 'debuggingModel',
    title: 'Debugging',
    description: 'Model used to debug and improve solutions',
    openaiModels: [
      {
        id: "gpt-5",
        name: "GPT-5",
        description: "Most advanced — best debugging"
      },
      {
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        description: "Lightweight GPT-5 variant, fast & affordable"
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        description: "Fast & highly capable"
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        description: "Budget-friendly, solid debugging"
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        description: "Previous gen flagship"
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        description: "Most cost-effective GPT-4 option"
      },
      {
        id: "o3",
        name: "o3",
        description: "Reasoning model — best for tricky bugs"
      },
      {
        id: "o4-mini",
        name: "o4-mini",
        description: "Lightweight reasoning model"
      }
    ],
    geminiModels: [
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Most capable — best debugging"
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Fast & efficient, great balance"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Previous gen, still capable"
      },
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Stable, battle-tested"
      }
    ],
    anthropicModels: [
      {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        description: "Anthropic's flagship model for most complex tasks",
      },
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        description: "Latest Sonnet 5 model"
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        description: "Latest Haiku 4.5 model"
      },
      {
        id: "claude-opus-4-6-20251101",
        name: "Claude Opus 5.5 Old.6",
        description: "Highly intelligent — top-tier reasoning"
      },
      {
        id: "claude-opus-5-5-old",
        name: "Claude Opus 5.5 Old",
        description: "Most intelligent — best for complex extractions"
      },
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        description: "Best balance of speed and intelligence"
      },
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Latest & most capable — best debugging"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Highly intelligent — excellent balance"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Previous gen flagship — good for tricky bugs"
      },
      {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        description: "Fastest & most cost-effective"
      }
    ]
  }
];

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [openaiApiKeyForWhisper, setOpenaiApiKeyForWhisper] = useState("");
  const [apiProvider, setApiProvider] = useState<APIProvider>("openai");
  const [extractionModel, setExtractionModel] = useState("gpt-4o");
  const [solutionModel, setSolutionModel] = useState("gpt-4o");
  const [debuggingModel, setDebuggingModel] = useState("gpt-4o");
  const [userResume, setUserResume] = useState("");
  const [useChatMode, setUseChatMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  // Sync with external open state
  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);
    }
  }, [externalOpen]);

  // Handle open state changes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    // Only call onOpenChange when there's actually a change
    if (onOpenChange && newOpen !== externalOpen) {
      onOpenChange(newOpen);
    }
  };
  
  // Load current config on dialog open
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      interface Config {
        openaiApiKey?: string;
        geminiApiKey?: string;
        anthropicApiKey?: string;
        apiKey?: string; // Legacy
        openaiApiKeyForWhisper?: string;
        apiProvider?: APIProvider;
        extractionModel?: string;
        solutionModel?: string;
        debuggingModel?: string;
        userResume?: string;
        useChatMode?: boolean;
      }

      window.electronAPI
        .getConfig()
        .then((config: Config) => {
          setOpenaiApiKey(config.openaiApiKey || (config.apiProvider === "openai" ? config.apiKey || "" : ""));
          setGeminiApiKey(config.geminiApiKey || (config.apiProvider === "gemini" ? config.apiKey || "" : ""));
          setAnthropicApiKey(config.anthropicApiKey || (config.apiProvider === "anthropic" ? config.apiKey || "" : ""));
          setOpenaiApiKeyForWhisper(config.openaiApiKeyForWhisper || "");
          setApiProvider(config.apiProvider || "openai");
          setExtractionModel(config.extractionModel || "gpt-4o");
          setSolutionModel(config.solutionModel || "gpt-4o");
          setDebuggingModel(config.debuggingModel || "gpt-4o");
          setUserResume(config.userResume || "");
          setUseChatMode(config.useChatMode !== false); // Default to true
        })
        .catch((error: unknown) => {
          console.error("Failed to load config:", error);
          showToast("Error", "Failed to load settings", "error");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, showToast]);

  // Handle API provider change
  const handleProviderChange = (provider: APIProvider) => {
    setApiProvider(provider);
    
    // Reset models to defaults when changing provider
    if (provider === "openai") {
      setExtractionModel("gpt-4o");
      setSolutionModel("gpt-4o");
      setDebuggingModel("gpt-4o");
    } else if (provider === "gemini") {
      setExtractionModel("gemini-2.5-flash");
      setSolutionModel("gemini-2.5-pro");
      setDebuggingModel("gemini-2.5-flash");
    } else if (provider === "anthropic") {
      setExtractionModel("claude-opus-5-5");
      setSolutionModel("claude-opus-5-5");
      setDebuggingModel("claude-opus-5-5");
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.updateConfig({
        openaiApiKey,
        geminiApiKey,
        anthropicApiKey,
        apiProvider,
        openaiApiKeyForWhisper,
        extractionModel,
        solutionModel,
        debuggingModel,
        userResume,
        useChatMode,
      });
      
      if (result) {
        showToast("Success", "Settings saved successfully", "success");
        handleOpenChange(false);
        
        // Force reload the app to apply the API key
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      showToast("Error", "Failed to save settings", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Mask API key for display
  const maskApiKey = (key: string) => {
    if (!key || key.length < 10) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  // Open external link handler
  const openExternalLink = (url: string) => {
    window.electronAPI.openLink(url);
  };

  const activeKey = apiProvider === "openai" ? openaiApiKey : apiProvider === "gemini" ? geminiApiKey : anthropicApiKey;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="sm:max-w-md bg-black border border-white/10 text-white settings-dialog"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(450px, 90vw)',
          height: 'auto',
          minHeight: '400px',
          maxHeight: '90vh',
          overflowY: 'auto',
          zIndex: 9999,
          margin: 0,
          padding: '20px',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
          animation: 'fadeIn 0.25s ease forwards',
          opacity: 0.98
        }}
      >        
        <DialogHeader>
          <DialogTitle>API Settings</DialogTitle>
          <DialogDescription className="text-white/70">
            Configure your API key and model preferences. You'll need your own API key to use this application.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Resume Upload Section at the top so it's impossible to miss */}
          <div className="space-y-2 pb-4 border-b border-white/10">
            <label className="text-sm font-medium text-white block">Resume / Personal Context</label>
            <p className="text-[10px] text-white/50 mb-2">
              Paste your resume or background here. The AI will use this to answer behavioral questions like "Introduce yourself".
            </p>
            <textarea
              value={userResume}
              onChange={(e) => setUserResume(e.target.value)}
              placeholder="Software Engineer with 5 years of experience..."
              className="flex w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white shadow-sm transition-colors placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 min-h-[100px] resize-y"
            />
          </div>

          {/* Chat Mode Section */}
          <div className="space-y-2 pb-4 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-white block">Chat Mode</label>
                <p className="text-[10px] text-white/50">
                  When enabled, taking screenshots and pressing Cmd+Enter opens a conversational ChatGPT-like interface instead of the rigid structured solution view.
                </p>
              </div>
              <div
                className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${useChatMode ? 'bg-white/90' : 'bg-white/20'}`}
                onClick={() => setUseChatMode(!useChatMode)}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-black transition-transform ${useChatMode ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </div>
            </div>
          </div>

          {/* API Provider Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">API Provider</label>
            <div className="flex gap-2">
              <div
                className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                  apiProvider === "openai"
                    ? "bg-white/10 border border-white/20"
                    : "bg-black/30 border border-white/5 hover:bg-white/5"
                }`}
                onClick={() => handleProviderChange("openai")}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      apiProvider === "openai" ? "bg-white" : "bg-white/20"
                    }`}
                  />
                  <div className="flex flex-col">
                    <p className="font-medium text-white text-sm">OpenAI</p>
                    <p className="text-xs text-white/60">GPT-5, GPT-4 & o-series</p>
                  </div>
                </div>
              </div>
              <div
                className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                  apiProvider === "gemini"
                    ? "bg-white/10 border border-white/20"
                    : "bg-black/30 border border-white/5 hover:bg-white/5"
                }`}
                onClick={() => handleProviderChange("gemini")}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      apiProvider === "gemini" ? "bg-white" : "bg-white/20"
                    }`}
                  />
                  <div className="flex flex-col">
                    <p className="font-medium text-white text-sm">Gemini</p>
                    <p className="text-xs text-white/60">Gemini 2.5 & 2.0 models</p>
                  </div>
                </div>
              </div>
              <div
                className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                  apiProvider === "anthropic"
                    ? "bg-white/10 border border-white/20"
                    : "bg-black/30 border border-white/5 hover:bg-white/5"
                }`}
                onClick={() => handleProviderChange("anthropic")}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      apiProvider === "anthropic" ? "bg-white" : "bg-white/20"
                    }`}
                  />
                  <div className="flex flex-col">
                    <p className="font-medium text-white text-sm">Claude</p>
                    <p className="text-xs text-white/60">Claude 4 & 3.x models</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-white" htmlFor="apiKey">
            {apiProvider === "openai" ? "OpenAI API Key" : 
             apiProvider === "gemini" ? "Gemini API Key" : 
             "Anthropic API Key"}
            </label>
            <Input
              id="apiKey"
              type="password"
              value={apiProvider === "openai" ? openaiApiKey : apiProvider === "gemini" ? geminiApiKey : anthropicApiKey}
              onChange={(e) => {
                if (apiProvider === "openai") setOpenaiApiKey(e.target.value);
                else if (apiProvider === "gemini") setGeminiApiKey(e.target.value);
                else setAnthropicApiKey(e.target.value);
              }}
              placeholder={
                apiProvider === "openai" ? "sk-..." : 
                apiProvider === "gemini" ? "AIza..." :
                "sk-ant-..."
              }
              className="bg-black/50 border-white/10 text-white"
            />
            {activeKey && (
              <p className="text-xs text-white/50 mt-1">
                Current: {maskApiKey(activeKey)}
              </p>
            )}
            <p className="text-xs text-white/50">
              Your API key is stored locally and never sent to any server except {apiProvider === "openai" ? "OpenAI" : "Google"}
            </p>
            <div className="mt-2 p-2 rounded-md bg-white/5 border border-white/10">
              <p className="text-xs text-white/80 mb-1">Don't have an API key?</p>
              {apiProvider === "openai" ? (
                <>
                  <p className="text-xs text-white/60 mb-1">1. Create an account at <button 
                    onClick={() => openExternalLink('https://platform.openai.com/signup')} 
                    className="text-blue-400 hover:underline cursor-pointer">OpenAI</button>
                  </p>
                  <p className="text-xs text-white/60 mb-1">2. Go to <button 
                    onClick={() => openExternalLink('https://platform.openai.com/api-keys')} 
                    className="text-blue-400 hover:underline cursor-pointer">API Keys</button> section
                  </p>
                  <p className="text-xs text-white/60">3. Create a new secret key and paste it here</p>
                </>
              ) : apiProvider === "gemini" ?  (
                <>
                  <p className="text-xs text-white/60 mb-1">1. Create an account at <button 
                    onClick={() => openExternalLink('https://aistudio.google.com/')} 
                    className="text-blue-400 hover:underline cursor-pointer">Google AI Studio</button>
                  </p>
                  <p className="text-xs text-white/60 mb-1">2. Go to the <button 
                    onClick={() => openExternalLink('https://aistudio.google.com/app/apikey')} 
                    className="text-blue-400 hover:underline cursor-pointer">API Keys</button> section
                  </p>
                  <p className="text-xs text-white/60">3. Create a new API key and paste it here</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-white/60 mb-1">1. Create an account at <button 
                    onClick={() => openExternalLink('https://console.anthropic.com/signup')} 
                    className="text-blue-400 hover:underline cursor-pointer">Anthropic</button>
                  </p>
                  <p className="text-xs text-white/60 mb-1">2. Go to the <button 
                    onClick={() => openExternalLink('https://console.anthropic.com/settings/keys')} 
                    className="text-blue-400 hover:underline cursor-pointer">API Keys</button> section
                  </p>
                  <p className="text-xs text-white/60">3. Create a new API key and paste it here</p>
                </>
              )}
            </div>

            {/* Whisper API Key section if not using OpenAI */}
            {apiProvider !== "openai" && (
              <div className="mt-4 p-3 rounded-md bg-white/5 border border-emerald-400/20">
                <label className="text-sm font-medium text-emerald-300/90 mb-1 block">
                  Whisper API Key (OpenAI)
                </label>
                <p className="text-[10px] text-white/50 mb-2">
                  Required only for the "Whisper Audio Hint" feature. Your main solution generation will still use {apiProvider === "anthropic" ? "Claude" : "Gemini"}.
                </p>
                <Input
                  type="password"
                  value={openaiApiKeyForWhisper}
                  onChange={(e) => setOpenaiApiKeyForWhisper(e.target.value)}
                  placeholder="sk-..."
                  className="bg-black/50 border-white/10 text-white h-8 text-sm"
                />
              </div>
            )}
          </div>

          <div className="space-y-2 mt-4">
            <label className="text-sm font-medium text-white mb-2 block">Keyboard Shortcuts</label>
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                <div className="text-white/70">Toggle Visibility</div>
                <div className="text-white/90 font-mono">Ctrl+B / Cmd+B</div>
                
                <div className="text-white/70">Take Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+H / Cmd+H</div>
                
                <div className="text-white/70">Process Screenshots</div>
                <div className="text-white/90 font-mono">Ctrl+Enter / Cmd+Enter</div>
                
                <div className="text-white/70">Delete Last Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+L / Cmd+L</div>
                
                <div className="text-white/70">Reset View</div>
                <div className="text-white/90 font-mono">Ctrl+R / Cmd+R</div>
                
                <div className="text-white/70">Quit Application</div>
                <div className="text-white/90 font-mono">Ctrl+Q / Cmd+Q</div>
                
                <div className="text-white/70">Move Window</div>
                <div className="text-white/90 font-mono">Ctrl+Arrow Keys</div>
                
                <div className="text-white/70">Decrease Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+[ / Cmd+[</div>
                
                <div className="text-white/70">Increase Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+] / Cmd+]</div>
                
                <div className="text-white/70">Zoom Out</div>
                <div className="text-white/90 font-mono">Ctrl+- / Cmd+-</div>
                
                <div className="text-white/70">Reset Zoom</div>
                <div className="text-white/90 font-mono">Ctrl+0 / Cmd+0</div>
                
                <div className="text-white/70">Zoom In</div>
                <div className="text-white/90 font-mono">Ctrl+= / Cmd+=</div>
              </div>
            </div>
          </div>
          
          <div className="space-y-4 mt-4">
            <label className="text-sm font-medium text-white">AI Model Selection</label>
            <p className="text-xs text-white/60 -mt-3 mb-2">
              Select which models to use for each stage of the process
            </p>
            
            {modelCategories.map((category) => {
              // Get the appropriate model list based on selected provider
              const models = 
                apiProvider === "openai" ? category.openaiModels : 
                apiProvider === "gemini" ? category.geminiModels :
                category.anthropicModels;
              
              return (
                <div key={category.key} className="mb-4">
                  <label className="text-sm font-medium text-white mb-1 block">
                    {category.title}
                  </label>
                  <p className="text-xs text-white/60 mb-2">{category.description}</p>
                  
                  <div className="space-y-2">
                    {models.map((m) => {
                      // Determine which state to use based on category key
                      const currentValue = 
                        category.key === 'extractionModel' ? extractionModel :
                        category.key === 'solutionModel' ? solutionModel :
                        debuggingModel;
                      
                      // Determine which setter function to use
                      const setValue = 
                        category.key === 'extractionModel' ? setExtractionModel :
                        category.key === 'solutionModel' ? setSolutionModel :
                        setDebuggingModel;
                        
                      return (
                        <div
                          key={m.id}
                          className={`p-2 rounded-lg cursor-pointer transition-colors ${
                            currentValue === m.id
                              ? "bg-white/10 border border-white/20"
                              : "bg-black/30 border border-white/5 hover:bg-white/5"
                          }`}
                          onClick={() => setValue(m.id)}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-3 h-3 rounded-full ${
                                currentValue === m.id ? "bg-white" : "bg-white/20"
                              }`}
                            />
                            <div>
                              <p className="font-medium text-white text-xs">{m.name}</p>
                              <p className="text-xs text-white/60">{m.description}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-white/10 hover:bg-white/5 text-white"
          >
            Cancel
          </Button>
          <Button
            className="px-4 py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors"
            onClick={handleSave}
            disabled={isLoading || !activeKey}
          >
            {isLoading ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

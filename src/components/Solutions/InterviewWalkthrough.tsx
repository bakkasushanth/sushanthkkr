// InterviewWalkthrough.tsx
import React, { useState } from "react"

export interface InterviewSteps {
  clarify: string[]
  brute_force: string[]
  optimize: string[]
}

interface PhaseConfig {
  key: keyof InterviewSteps
  label: string
  icon: string
  color: string
  borderColor: string
}

const PHASES: PhaseConfig[] = [
  {
    key: "clarify",
    label: "1 · Clarify",
    icon: "🔍",
    color: "text-yellow-300",
    borderColor: "border-yellow-400/60"
  },
  {
    key: "brute_force",
    label: "2 · Brute Force",
    icon: "🔨",
    color: "text-orange-300",
    borderColor: "border-orange-400/60"
  },
  {
    key: "optimize",
    label: "3 · Optimize",
    icon: "⚡",
    color: "text-emerald-300",
    borderColor: "border-emerald-400/60"
  }
]

const SpeechLine: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-[12.5px] leading-[1.6] text-gray-300">
    <span className="text-white/20">&ldquo;</span>
    {text}
    <span className="text-white/20">&rdquo;</span>
  </p>
)

interface PhasePanelProps {
  phase: PhaseConfig
  items: string[]
}

const PhasePanel: React.FC<PhasePanelProps> = ({ phase, items }) => (
  <div className={`border-l-2 ${phase.borderColor} pl-3 space-y-2`}>
    <p className={`text-[11px] font-semibold tracking-widest uppercase ${phase.color} mb-2`}>
      {phase.icon} {phase.label}
    </p>
    {items.map((item, idx) => (
      <SpeechLine key={idx} text={item} />
    ))}
  </div>
)

interface InterviewWalkthroughProps {
  steps: InterviewSteps | null
  isLoading: boolean
}

const InterviewWalkthrough: React.FC<InterviewWalkthroughProps> = ({ steps, isLoading }) => {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-2">
      {/* Section header / toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full group"
        aria-expanded={open}
      >
        <h2 className="text-[13px] font-medium text-white tracking-wide hide-in-disguise">
          Approach Guide
        </h2>
        <span
          className={`text-white/40 text-xs group-hover:text-white/70 transition-all duration-200 select-none ${
            open ? "rotate-180" : ""
          }`}
          style={{ display: "inline-block" }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="bg-white/[0.04] border border-white/10 rounded-lg px-4 py-4 space-y-5">
          {isLoading || !steps ? (
            <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
              Building strategy...
            </p>
          ) : (
            <>
              <p className="text-[11px] text-white/40 italic mb-1">
                Summary
              </p>
              {PHASES.map((phase) => (
                <PhasePanel
                  key={phase.key}
                  phase={phase}
                  items={steps[phase.key] ?? []}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default InterviewWalkthrough

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronDown, ChevronUp, FolderOpen, Loader2, MessageSquare, Send, Settings2, Sparkles } from 'lucide-react'
import type { TimelineClip, Track } from '../../types/project'
import {
  applyEditingAgentActions,
  interpretEditingAgentInput,
  summarizeTimelineForAgent,
  type EditingAgentContext,
} from './editing-agent'
import {
  DEFAULT_EDITING_AGENT_LLM_CONFIG,
  interpretEditingAgentWithLlm,
  type EditingAgentLlmResult,
  type EditingAgentLlmConfig,
} from './editing-agent-llm'
import {
  buildApplyDebugEntry,
  buildErrorDebugEntry,
  buildInterpretationDebugEntry,
  buildRequestDebugEntry,
  persistEditingAgentDebugEntry,
  summarizeActions,
  type EditingAgentDebugEntry,
} from './editing-agent-debug'

interface AgentMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
}

interface EditingAgentPanelProps {
  clips: TimelineClip[]
  tracks: Track[]
  selectedClipIds: Set<string>
  currentTime: number
  rightPanelWidth: number
  pushUndo: () => void
  setClips: Dispatch<SetStateAction<TimelineClip[]>>
  setSelectedClipIds: Dispatch<SetStateAction<Set<string>>>
}

const EDITING_AGENT_LLM_STORAGE_KEY = 'ltx-editing-agent-llm-config'

const QUICK_PROMPTS = [
  '列出片段',
  '选中第一个片段',
  '把选中的片段往后挪2秒',
  '把第一个片段时长改成3秒',
  '给第一个片段加0.5秒淡入',
  '在5秒添加标题 欢迎来到片场',
]

export function EditingAgentPanel({
  clips,
  tracks,
  selectedClipIds,
  currentTime,
  rightPanelWidth,
  pushUndo,
  setClips,
  setSelectedClipIds,
}: EditingAgentPanelProps) {
  const initialSummary = useMemo(() => summarizeTimelineForAgent({ clips, tracks, selectedClipIds, currentTime }), [])
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'assistant-welcome',
      role: 'assistant',
      text: `时间线 Agent 已连接。\n\n${initialSummary}`,
    },
  ])
  const [input, setInput] = useState('')
  const [lastReferencedClipIds, setLastReferencedClipIds] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showDebugLog, setShowDebugLog] = useState(false)
  const [debugLogPath, setDebugLogPath] = useState('')
  const [debugEntries, setDebugEntries] = useState<EditingAgentDebugEntry[]>([])
  const [llmConfig, setLlmConfig] = useState<EditingAgentLlmConfig>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_EDITING_AGENT_LLM_CONFIG
    }
    try {
      const raw = window.localStorage.getItem(EDITING_AGENT_LLM_STORAGE_KEY)
      if (!raw) return DEFAULT_EDITING_AGENT_LLM_CONFIG
      const parsed = JSON.parse(raw) as Partial<EditingAgentLlmConfig>
      return {
        enabled: parsed.enabled ?? DEFAULT_EDITING_AGENT_LLM_CONFIG.enabled,
        baseUrl: parsed.baseUrl ?? DEFAULT_EDITING_AGENT_LLM_CONFIG.baseUrl,
        apiKey: parsed.apiKey ?? DEFAULT_EDITING_AGENT_LLM_CONFIG.apiKey,
        model: parsed.model ?? DEFAULT_EDITING_AGENT_LLM_CONFIG.model,
      }
    } catch {
      return DEFAULT_EDITING_AGENT_LLM_CONFIG
    }
  })

  useEffect(() => {
    window.localStorage.setItem(EDITING_AGENT_LLM_STORAGE_KEY, JSON.stringify(llmConfig))
  }, [llmConfig])

  useEffect(() => {
    if (!showDebugLog) return
    const loadDebugLog = async () => {
      try {
        const result = await window.electronAPI.getAgentDebugLog()
        setDebugLogPath(result.logPath || '')
        const entries = (result.lines || [])
          .map((line) => {
            try {
              return JSON.parse(line) as EditingAgentDebugEntry
            } catch {
              return null
            }
          })
          .filter((entry): entry is EditingAgentDebugEntry => entry !== null)
          .slice(-30)
          .reverse()
        setDebugEntries(entries)
      } catch {
        // Best-effort debug view only.
      }
    }

    void loadDebugLog()
  }, [showDebugLog, isRunning])

  const context: EditingAgentContext = {
    clips,
    tracks,
    selectedClipIds,
    currentTime,
    lastReferencedClipIds,
  }

  const handleSubmit = async (rawText: string) => {
    const text = rawText.trim()
    if (!text || isRunning) return

    const userMessage: AgentMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsRunning(true)

    try {
      const provider = llmConfig.enabled ? 'llm' : 'rule'
      await persistEditingAgentDebugEntry(buildRequestDebugEntry(text, provider, clips))

      let interpretation
        = llmConfig.enabled
          ? await interpretEditingAgentWithLlm(text, context, llmConfig, messages)
          : interpretEditingAgentInput(text, context)

      await persistEditingAgentDebugEntry(buildInterpretationDebugEntry(
        llmConfig.enabled ? 'llm_result' : 'fallback_result',
        text,
        provider,
        interpretation,
        llmConfig.enabled && 'rawContent' in interpretation && 'jsonText' in interpretation
          ? {
            rawContent: (interpretation as EditingAgentLlmResult).rawContent,
            jsonText: (interpretation as EditingAgentLlmResult).jsonText,
            actionCount: interpretation.actions.length,
            sanitizedActions: summarizeActions(interpretation.actions),
          }
          : {
            actionCount: interpretation.actions.length,
            sanitizedActions: summarizeActions(interpretation.actions),
          },
      ))

      let assistantText = interpretation.reply
      if (interpretation.actions.length > 0) {
        pushUndo()
        const applied = applyEditingAgentActions(context, interpretation.actions)
        setClips(applied.clips)
        setSelectedClipIds(applied.selectedClipIds)
        await persistEditingAgentDebugEntry(buildApplyDebugEntry(
          text,
          provider,
          clips,
          applied.clips,
          interpretation,
          applied.summary,
        ))
        assistantText = `${interpretation.reply}\n\n${applied.summary}`
      }

      setLastReferencedClipIds(interpretation.referencedClipIds)
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: assistantText,
        },
      ])
    } catch (error) {
      await persistEditingAgentDebugEntry(buildErrorDebugEntry(text, 'llm', error))
      const fallback = interpretEditingAgentInput(text, context)
      await persistEditingAgentDebugEntry(buildInterpretationDebugEntry(
        'fallback_result',
        text,
        'rule',
        fallback,
        {
          actionCount: fallback.actions.length,
          sanitizedActions: summarizeActions(fallback.actions),
        },
      ))
      let assistantText = `AI 调用失败，已回退到本地规则引擎。\n\n${fallback.reply}`
      if (fallback.actions.length > 0) {
        pushUndo()
        const applied = applyEditingAgentActions(context, fallback.actions)
        setClips(applied.clips)
        setSelectedClipIds(applied.selectedClipIds)
        await persistEditingAgentDebugEntry(buildApplyDebugEntry(
          text,
          'rule',
          clips,
          applied.clips,
          fallback,
          applied.summary,
        ))
        assistantText = `${assistantText}\n\n${applied.summary}`
      }
      setLastReferencedClipIds(fallback.referencedClipIds)
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: `${assistantText}\n\n错误信息：${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ])
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div
      className="bg-zinc-950 border-l border-zinc-800 flex flex-col"
      style={{ width: rightPanelWidth }}
    >
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Timeline Agent</h3>
            <p className="text-[11px] text-zinc-500">真实 AI 输出结构化 actions，再修改时间线 JSON 状态</p>
          </div>
          <button
            onClick={() => setShowSettings((prev) => !prev)}
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white"
            title="Agent settings"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="border-b border-zinc-800 px-4 py-3 space-y-3">
          <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
            <span>使用真实 AI</span>
            <input
              type="checkbox"
              checked={llmConfig.enabled}
              onChange={(e) => setLlmConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
              className="h-4 w-4"
            />
          </label>
          <div className="space-y-2">
            <input
              value={llmConfig.baseUrl}
              onChange={(e) => setLlmConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="Base URL"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500/50"
            />
            <input
              value={llmConfig.model}
              onChange={(e) => setLlmConfig((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="Model"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500/50"
            />
            <input
              value={llmConfig.apiKey}
              onChange={(e) => setLlmConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="API Key"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500/50"
            />
          </div>
          <div className="text-[11px] text-zinc-500">
            当前默认值：`http://127.0.0.1:55555` / `deepseek-chat`
          </div>
        </div>
      )}

      <div className="border-b border-zinc-800 px-4 py-3">
        <button
          onClick={() => setShowDebugLog((prev) => !prev)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-400">
            <MessageSquare className="h-3.5 w-3.5" />
            调试日志
          </div>
          {showDebugLog ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
        </button>
        {showDebugLog && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="truncate text-[10px] text-zinc-500" title={debugLogPath}>
                {debugLogPath || '未生成调试日志文件'}
              </div>
              <button
                onClick={() => { void window.electronAPI.openLogFolder() }}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
              >
                <FolderOpen className="h-3 w-3" />
                打开日志目录
              </button>
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 bg-black/40 p-2">
              {debugEntries.length === 0 ? (
                <div className="text-[11px] text-zinc-500">暂无调试日志</div>
              ) : (
                debugEntries.map((entry, index) => (
                  <div key={`${entry.timestamp}-${index}`} className="rounded-md border border-zinc-800 bg-zinc-950 p-2 text-[10px] leading-4 text-zinc-300">
                    <div className="mb-1 flex items-center justify-between gap-2 text-zinc-500">
                      <span>{entry.phase}</span>
                      <span>{entry.timestamp}</span>
                    </div>
                    <div className="mb-1 text-zinc-200">{entry.userText}</div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-zinc-400 select-text cursor-text">{JSON.stringify(entry.details, null, 2)}</pre>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-zinc-400">
          <MessageSquare className="h-3.5 w-3.5" />
          快捷示例
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => { void handleSubmit(prompt) }}
              className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-white"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-xl border px-3 py-2 whitespace-pre-wrap text-[12px] leading-5 ${
              message.role === 'assistant'
                ? 'border-zinc-800 bg-zinc-900 text-zinc-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
            } select-text cursor-text`}
          >
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              {message.role === 'assistant' ? 'Agent' : 'You'}
            </div>
            {message.text}
          </div>
        ))}
      </div>

      <div className="border-t border-zinc-800 p-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSubmit(input)
            }
          }}
          placeholder="例如：把选中的片段往后挪2秒，或者在5秒添加标题 欢迎来到片场"
          className="min-h-[96px] w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-emerald-500/50"
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[11px] text-zinc-500">
            当前 {clips.length} 个片段，已选中 {selectedClipIds.size} 个
          </div>
          <button
            onClick={() => { void handleSubmit(input) }}
            disabled={isRunning}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300"
          >
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {isRunning ? '调用中' : '执行'}
          </button>
        </div>
      </div>
    </div>
  )
}

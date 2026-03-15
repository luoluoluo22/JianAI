/// <reference types="vite/client" />

interface LogsResponse {
  logPath: string
  lines: string[]
  error?: string
}

interface BackendHealthStatus {
  status: 'alive' | 'restarting' | 'dead'
  exitCode?: number | null
}

interface JianaiExternalAgentState {
  available: boolean
  currentProjectId: string | null
  isRunning: boolean
  llmEnabled: boolean
  model: string
  messageCount: number
}

interface JianaiExternalAgentResult {
  success: boolean
  projectId: string | null
  userText: string
  assistantText: string
  provider: 'llm' | 'rule' | 'unknown'
  actionCount: number
  referencedClipIds: string[]
  error?: string
  timestamp: string
}

interface Window {
  __JIANAI_EXTERNAL_AGENT__?: {
    runCommand: (input: string) => Promise<JianaiExternalAgentResult>
    getState: () => JianaiExternalAgentState
  }
  electronAPI: {
    getBackend: () => Promise<{ url: string; token: string }>
    getModelsPath: () => Promise<string>
    readLocalFile: (filePath: string) => Promise<{ data: string; mimeType: string }>
    checkGpu: () => Promise<{ available: boolean; name?: string; vram?: number }>
    getAppInfo: () => Promise<{ version: string; isPackaged: boolean; modelsPath: string; userDataPath: string; localBackendDisabled: boolean }>
    checkFirstRun: () => Promise<{ needsSetup: boolean; needsLicense: boolean }>
    acceptLicense: () => Promise<boolean>
    completeSetup: () => Promise<boolean>
    fetchLicenseText: () => Promise<string>
    getNoticesText: () => Promise<string>
    openLtxApiKeyPage: () => Promise<boolean>
    openCloudflareApiTokenPage: () => Promise<boolean>
    openParentFolderOfFile: (filePath: string) => Promise<void>
    showItemInFolder: (filePath: string) => Promise<void>
    getLogs: () => Promise<LogsResponse>
    getLogPath: () => Promise<{ logPath: string; logDir: string }>
    getAgentDebugLog: () => Promise<LogsResponse>
    appendAgentDebugLog: (line: string) => Promise<void>
    openLogFolder: () => Promise<boolean>
    getResourcePath: () => Promise<string | null>
    getDownloadsPath: () => Promise<string>
    getRendererSettings: () => Promise<Record<string, unknown>>
    saveRendererSettings: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>
    getExternalControlInfo: () => Promise<{ enabled: boolean; port: number; token: string }>
    copyToProjectAssets: (srcPath: string, projectId: string) => Promise<{ success: boolean; path?: string; url?: string; error?: string }>
    createHtmlAsset: (projectId: string, payload: { html: string; width: number; height: number; name: string; duration?: number }) => Promise<{ success: boolean; mediaType?: 'image' | 'video'; path?: string; url?: string; htmlPath?: string; thumbnailPath?: string; thumbnailUrl?: string; width?: number; height?: number; error?: string }>
    importImageToProjectAssets: (projectId: string, payload: { source: string; name?: string }) => Promise<{ success: boolean; path?: string; url?: string; error?: string }>
    deleteManagedProjectFiles: (filePaths: string[]) => Promise<{ deleted: string[]; skipped: string[] }>
    getProjectAssetsPath: () => Promise<string>
    openProjectAssetsPathChangeDialog: () => Promise<{ success: boolean; path?: string; error?: string }>
    showSaveDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
    saveFile: (filePath: string, data: string, encoding?: string) => Promise<{ success: boolean; path?: string; error?: string }>
    saveBinaryFile: (filePath: string, data: ArrayBuffer) => Promise<{ success: boolean; path?: string; error?: string }>
    generateCloudflareImage: (payload: {
      accountId: string
      apiToken: string
      model: string
      prompt: string
      width: number
      height: number
      steps: number
      guidance?: number
      seed?: number
    }) => Promise<{ success: true; data: ArrayBuffer } | { success: false; error: string }>
    showOpenDirectoryDialog: (options: { title?: string }) => Promise<string | null>
    checkFilesExist: (filePaths: string[]) => Promise<Record<string, boolean>>
    showOpenFileDialog: (options: { title?: string; filters?: { name: string; extensions: string[] }[]; properties?: string[] }) => Promise<string[] | null>
    searchDirectoryForFiles: (directory: string, filenames: string[]) => Promise<Record<string, string | null>>
    exportNative: (data: {
      clips: { url: string; type: string; startTime: number; duration: number; trimStart: number; speed: number; reversed: boolean; flipH: boolean; flipV: boolean; opacity: number; trackIndex: number; muted: boolean; volume: number }[]
      outputPath: string; codec: string; width: number; height: number; fps: number; quality: number
      letterbox?: { ratio: number; color: string; opacity: number }
      subtitles?: { text: string; startTime: number; endTime: number; style: { fontSize: number; fontFamily: string; fontWeight: string; color: string; backgroundColor: string; position: string; italic: boolean } }[]
      textOverlays?: { text: string; startTime: number; endTime: number; style: { fontSize: number; fontFamily: string; fontWeight: string; fontStyle?: string; color: string; backgroundColor: string; textAlign?: 'left' | 'center' | 'right'; positionX: number; positionY: number; strokeColor?: string; strokeWidth?: number; shadowColor?: string; shadowOffsetX?: number; shadowOffsetY?: number } }[]
    }) => Promise<{ success?: boolean; error?: string }>
    exportCancel: (sessionId: string) => Promise<{ ok?: boolean }>
    checkPythonReady: () => Promise<{ ready: boolean }>
    startPythonSetup: () => Promise<void>
    startPythonBackend: () => Promise<void>
    getBackendHealthStatus: () => Promise<BackendHealthStatus | null>
    onPythonSetupProgress: (cb: (data: unknown) => void) => void
    removePythonSetupProgress: () => void
    onBackendHealthStatus: (cb: (data: BackendHealthStatus) => void) => (() => void)
    extractVideoFrame: (videoUrl: string, seekTime: number, width?: number, quality?: number) => Promise<{ path: string; url: string }>
    writeLog: (level: string, message: string) => Promise<void>
    openModelsDirChangeDialog: () => Promise<{ success: boolean; path?: string; error?: string }>
    getAnalyticsState: () => Promise<{ analyticsEnabled: boolean; installationId: string }>
    setAnalyticsEnabled: (enabled: boolean) => Promise<void>
    sendAnalyticsEvent: (eventName: string, extraDetails?: Record<string, unknown> | null) => Promise<void>
    platform: string
  }
}

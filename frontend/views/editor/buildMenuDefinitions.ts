import { type MenuDefinition } from '../../components/MenuBar'
import type { TimelineClip } from '../../types/project'
import { TEXT_PRESETS } from '../../types/project'
import { getShortcutLabel, type ToolType } from './video-editor-utils'
import type { KeyboardLayout } from '../../lib/keyboard-shortcuts'

export interface MenuDepsParams {
  selectedClip: TimelineClip | null | undefined
  selectedClipIds: Set<string>
  clips: TimelineClip[]
  tracks: any[]
  subtitles: any[]
  snapEnabled: boolean
  showEffectsBrowser: boolean
  showSourceMonitor: boolean
  showPropertiesPanel: boolean
  canUseIcLora: boolean
  sourceAsset: any
  activeTool: ToolType
  activeTimeline: any
  timelines: any[]
  kbLayout: KeyboardLayout
  fileInputRef: React.RefObject<HTMLInputElement>
  subtitleFileInputRef: React.RefObject<HTMLInputElement>
  setShowImportTimelineModal: (v: boolean) => void
  setShowExportModal: (v: boolean) => void
  handleExportTimelineXml: () => void
  handleExportSrt: () => void
  undoRef: React.RefObject<() => void>
  redoRef: React.RefObject<() => void>
  cutRef: React.RefObject<() => void>
  copyRef: React.RefObject<() => void>
  pasteRef: React.RefObject<() => void>
  setSelectedClipIds: (v: Set<string>) => void
  handleInsertEdit: () => void
  handleOverwriteEdit: () => void
  matchFrameRef: React.RefObject<() => void>
  setKbEditorOpen: (v: boolean) => void
  splitClipAtPlayhead: (id: string, atTime?: number, batchClipIds?: string[]) => void
  duplicateClip: (id: string) => void
  pushUndo: () => void
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  updateClip: (id: string, patch: Partial<TimelineClip>) => void
  setTracks: React.Dispatch<React.SetStateAction<any[]>>
  addTextClip: (style?: any) => void
  addSubtitleTrack: () => void
  createAdjustmentLayerAsset: () => void
  setSnapEnabled: (v: boolean) => void
  fitToViewRef: React.RefObject<() => void>
  setZoom: React.Dispatch<React.SetStateAction<number>>
  setShowSourceMonitor: (v: boolean) => void
  setShowEffectsBrowser: (v: boolean) => void
  setShowPropertiesPanel: (v: boolean) => void
  onICLoraClip: (clip: TimelineClip) => void
  setActiveTool: (v: ToolType) => void
  setLastTrimTool: (v: ToolType) => void
  handleAddTimeline: () => void
  handleDuplicateTimeline: (id: string) => void
  handleResetLayout: () => void
}

export function buildMenuDefinitions(p: MenuDepsParams): MenuDefinition[] {
  return [
    // ── File ──
    // Import/export, timeline management, project settings
    {
      id: 'file',
      label: '文件',
      items: [
        { id: 'new-timeline', label: '新建时间线', action: () => p.handleAddTimeline() },
        { id: 'duplicate-timeline', label: '复制当前时间线', action: () => { if (p.activeTimeline) p.handleDuplicateTimeline(p.activeTimeline.id) }, disabled: !p.activeTimeline },
        { id: 'sep-0', label: '', separator: true },
        { id: 'import-media', label: '导入素材...', shortcut: 'Ctrl+I', action: () => p.fileInputRef.current?.click() },
        { id: 'import-timeline', label: '导入时间线（XML）...', action: () => p.setShowImportTimelineModal(true) },
        { id: 'import-srt', label: '导入字幕（SRT）...', action: () => p.subtitleFileInputRef.current?.click() },
        { id: 'sep-1', label: '', separator: true },
        { id: 'export-timeline', label: '导出时间线...', shortcut: 'Ctrl+E', action: () => p.setShowExportModal(true) },
        { id: 'export-xml', label: '导出 FCP7 XML...', action: () => p.handleExportTimelineXml() },
        { id: 'export-srt', label: '导出字幕（SRT）...', action: () => p.handleExportSrt(), disabled: p.subtitles.length === 0 },
      ],
    },

    // ── Edit ──
    // Undo/redo, clipboard, selection, source monitor edits
    {
      id: 'edit',
      label: '编辑',
      items: [
        { id: 'undo', label: '撤销', shortcut: getShortcutLabel(p.kbLayout, 'edit.undo'), action: () => p.undoRef.current!() },
        { id: 'redo', label: '重做', shortcut: getShortcutLabel(p.kbLayout, 'edit.redo'), action: () => p.redoRef.current!() },
        { id: 'sep-1', label: '', separator: true },
        { id: 'cut', label: '剪切', shortcut: getShortcutLabel(p.kbLayout, 'edit.cut'), action: () => p.cutRef.current!() },
        { id: 'copy', label: '复制', shortcut: getShortcutLabel(p.kbLayout, 'edit.copy'), action: () => p.copyRef.current!() },
        { id: 'paste', label: '粘贴', shortcut: getShortcutLabel(p.kbLayout, 'edit.paste'), action: () => p.pasteRef.current!() },
        { id: 'sep-2', label: '', separator: true },
        { id: 'select-all', label: '全选', shortcut: getShortcutLabel(p.kbLayout, 'edit.selectAll'), action: () => p.setSelectedClipIds(new Set(p.clips.map(c => c.id))) },
        { id: 'deselect-all', label: '取消全选', shortcut: getShortcutLabel(p.kbLayout, 'edit.deselect'), action: () => p.setSelectedClipIds(new Set()) },
        { id: 'sep-3', label: '', separator: true },
        { id: 'insert-edit', label: '插入编辑', shortcut: getShortcutLabel(p.kbLayout, 'edit.insertEdit'), action: () => p.handleInsertEdit(), disabled: !p.sourceAsset },
        { id: 'overwrite-edit', label: '覆盖编辑', shortcut: getShortcutLabel(p.kbLayout, 'edit.overwriteEdit'), action: () => p.handleOverwriteEdit(), disabled: !p.sourceAsset },
        { id: 'match-frame', label: '匹配帧', shortcut: getShortcutLabel(p.kbLayout, 'edit.matchFrame'), action: () => p.matchFrameRef.current!() },
        { id: 'sep-4', label: '', separator: true },
        { id: 'keyboard-shortcuts', label: '快捷键...', action: () => p.setKbEditorOpen(true) },
      ],
    },

    // ── Clip ──
    // Operations on selected clip(s): split, duplicate, delete, transform, audio, speed
    {
      id: 'clip',
      label: '片段',
      items: [
        { id: 'split', label: '在播放头处分割', shortcut: getShortcutLabel(p.kbLayout, 'tool.blade'), action: () => { if (p.selectedClip) p.splitClipAtPlayhead(p.selectedClip.id) }, disabled: !p.selectedClip },
        { id: 'duplicate', label: '复制片段', action: () => { if (p.selectedClip) p.duplicateClip(p.selectedClip.id) }, disabled: !p.selectedClip },
        { id: 'delete', label: '删除', shortcut: getShortcutLabel(p.kbLayout, 'edit.delete'), action: () => { if (p.selectedClipIds.size > 0) { p.pushUndo(); p.setClips(prev => prev.filter(c => !p.selectedClipIds.has(c.id))); p.setSelectedClipIds(new Set()) } }, disabled: p.selectedClipIds.size === 0 },
        { id: 'sep-1', label: '', separator: true },
        { id: 'flip-h', label: '水平翻转', action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { flipH: !p.selectedClip.flipH }) }, disabled: !p.selectedClip },
        { id: 'flip-v', label: '垂直翻转', action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { flipV: !p.selectedClip.flipV }) }, disabled: !p.selectedClip },
        { id: 'reverse', label: '倒放', action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { reversed: !p.selectedClip.reversed }) }, disabled: !p.selectedClip },
        { id: 'sep-2', label: '', separator: true },
        { id: 'mute', label: p.selectedClip?.muted ? '取消静音片段' : '静音片段', action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { muted: !p.selectedClip.muted }) }, disabled: !p.selectedClip },
        { id: 'link-audio', label: p.selectedClip?.linkedClipIds?.length ? '取消音频链接' : '链接音频', action: () => {
          if (!p.selectedClip) return
          p.pushUndo()
          if (p.selectedClip.linkedClipIds?.length) {
            const linkedIds = p.selectedClip.linkedClipIds
            p.setClips(prev => prev.map(c => {
              if (c.id === p.selectedClip!.id) return { ...c, linkedClipIds: undefined }
              if (linkedIds.includes(c.id)) return { ...c, linkedClipIds: c.linkedClipIds?.filter(lid => lid !== p.selectedClip!.id) }
              return c
            }))
          }
        }, disabled: !p.selectedClip },
        { id: 'sep-3', label: '', separator: true },
        { id: 'speed-025', label: '速度：0.25x', action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 0.25 }) }, disabled: !p.selectedClip },
        { id: 'speed-050', label: '速度：0.5x', action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 0.5 }) }, disabled: !p.selectedClip },
        { id: 'speed-100', label: '速度：1x（正常）', action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 1 }) }, disabled: !p.selectedClip },
        { id: 'speed-150', label: '速度：1.5x', action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 1.5 }) }, disabled: !p.selectedClip },
        { id: 'speed-200', label: '速度：2x', action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 2 }) }, disabled: !p.selectedClip },
        { id: 'speed-400', label: '速度：4x', action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 4 }) }, disabled: !p.selectedClip },
      ],
    },

    // ── Sequence ──
    // Timeline-level: add tracks, add layers, add text/captions, snapping
    {
      id: 'sequence',
      label: '序列',
      items: [
        { id: 'add-video-track', label: '添加视频轨', action: () => { p.pushUndo(); p.setTracks(prev => { const vTracks = prev.filter((t: any) => t.kind === 'video'); const name = `V${vTracks.length + 1}`; return [...prev, { id: `track-${Date.now()}`, name, muted: false, locked: false, kind: 'video' as const }] }) } },
        { id: 'add-audio-track', label: '添加音频轨', action: () => { p.pushUndo(); p.setTracks(prev => { const aTracks = prev.filter((t: any) => t.kind === 'audio'); const name = `A${aTracks.length + 1}`; return [...prev, { id: `track-${Date.now()}`, name, muted: false, locked: false, kind: 'audio' as const }] }) } },
        { id: 'add-subtitle-track', label: '添加字幕轨', action: () => p.addSubtitleTrack() },
        { id: 'sep-1', label: '', separator: true },
        { id: 'add-adjustment', label: '添加调整层', action: () => p.createAdjustmentLayerAsset() },
        { id: 'sep-2', label: '', separator: true },
        { id: 'add-text', label: '添加文字覆盖', action: () => p.addTextClip() },
        { id: 'add-text-lower', label: '添加下三分之一标题', action: () => p.addTextClip(TEXT_PRESETS.find((pr: any) => pr.id === 'lower-third-basic')?.style) },
        { id: 'add-text-subtitle', label: '添加字幕样式文字', action: () => p.addTextClip(TEXT_PRESETS.find((pr: any) => pr.id === 'subtitle-style')?.style) },
        { id: 'sep-3', label: '', separator: true },
        { id: 'snap-toggle', label: p.snapEnabled ? '关闭吸附' : '开启吸附', shortcut: getShortcutLabel(p.kbLayout, 'timeline.toggleSnap'), action: () => p.setSnapEnabled(!p.snapEnabled) },
      ],
    },

    // ── Tools ──
    // Timeline editing tools (selection, trim, blade, etc.)
    {
      id: 'tools',
      label: '工具',
      items: [
        { id: 'tool-select', label: '选择工具', shortcut: getShortcutLabel(p.kbLayout, 'tool.select'), action: () => p.setActiveTool('select') },
        { id: 'tool-blade', label: '刀片工具', shortcut: getShortcutLabel(p.kbLayout, 'tool.blade'), action: () => p.setActiveTool('blade') },
        { id: 'sep-1', label: '', separator: true },
        { id: 'tool-ripple', label: '波纹修剪', shortcut: getShortcutLabel(p.kbLayout, 'tool.ripple'), action: () => { p.setActiveTool('ripple'); p.setLastTrimTool('ripple') } },
        { id: 'tool-roll', label: '滚动修剪', shortcut: getShortcutLabel(p.kbLayout, 'tool.roll'), action: () => { p.setActiveTool('roll'); p.setLastTrimTool('roll') } },
        { id: 'tool-slip', label: '滑移工具', shortcut: getShortcutLabel(p.kbLayout, 'tool.slip'), action: () => { p.setActiveTool('slip'); p.setLastTrimTool('slip') } },
        { id: 'tool-slide', label: '滑动工具', shortcut: getShortcutLabel(p.kbLayout, 'tool.slide'), action: () => { p.setActiveTool('slide'); p.setLastTrimTool('slide') } },
        { id: 'sep-2', label: '', separator: true },
        ...(p.canUseIcLora ? [{
          id: 'ic-lora',
          label: 'IC-LoRA 风格迁移...',
          action: () => {
            if (p.selectedClip?.type === 'video') {
              p.onICLoraClip(p.selectedClip)
            }
          },
          disabled: p.selectedClip?.type !== 'video',
        }] : []),
      ],
    },

    // ── View ──
    // Panel visibility, timeline zoom, layout
    {
      id: 'view',
      label: '视图',
      items: [
        { id: 'clip-viewer', label: p.showSourceMonitor ? '隐藏素材监看器' : '显示素材监看器', action: () => p.setShowSourceMonitor(!p.showSourceMonitor) },
        // EFFECTS HIDDEN - effects-browser menu item hidden because effects are not applied during export
        // { id: 'effects-browser', label: p.showEffectsBrowser ? 'Hide Effects Browser' : 'Show Effects Browser', action: () => p.setShowEffectsBrowser(!p.showEffectsBrowser) },
        { id: 'properties-panel', label: p.showPropertiesPanel ? '隐藏属性面板' : '显示属性面板', action: () => p.setShowPropertiesPanel(!p.showPropertiesPanel) },
        { id: 'sep-1', label: '', separator: true },
        { id: 'fit-to-view', label: '适配视图', shortcut: getShortcutLabel(p.kbLayout, 'timeline.fitToView'), action: () => p.fitToViewRef.current!() },
        { id: 'zoom-in', label: '放大', shortcut: getShortcutLabel(p.kbLayout, 'timeline.zoomIn'), action: () => p.setZoom(z => Math.min(z * 1.25, 10)) },
        { id: 'zoom-out', label: '缩小', shortcut: getShortcutLabel(p.kbLayout, 'timeline.zoomOut'), action: () => p.setZoom(z => Math.max(z / 1.25, 0.1)) },
        { id: 'sep-2', label: '', separator: true },
        { id: 'reset-layout', label: '重置布局', action: () => p.handleResetLayout() },
      ],
    },

    // ── Help ──
    {
      id: 'help',
      label: '帮助',
      items: [
        { id: 'shortcuts', label: '快捷键...', action: () => p.setKbEditorOpen(true) },
        { id: 'about', label: '关于剪艾 JianAI', action: () => window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'about' } })) },
      ],
    },
  ]
}

#!/usr/bin/env node

import fs from 'fs'
import path from 'path'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    if (!current.startsWith('--')) continue
    const key = current.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = 'true'
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

function buildChatCompletionsUrl(baseUrl) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

function decodeJsonishString(value) {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
}

function extractJsonText(content) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] || content).trim()
  const firstBraceIndex = candidate.indexOf('{')
  if (firstBraceIndex === -1) return candidate

  let depth = 0
  let inString = false
  let escaping = false

  for (let index = firstBraceIndex; index < candidate.length; index += 1) {
    const char = candidate[index]
    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }
      if (char === '\\') {
        escaping = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return candidate.slice(firstBraceIndex, index + 1).trim()
      }
    }
  }

  return candidate
}

function extractQuotedField(content, key) {
  const keyPattern = `"${key}"`
  const keyIndex = content.indexOf(keyPattern)
  if (keyIndex === -1) return null
  const colonIndex = content.indexOf(':', keyIndex + keyPattern.length)
  if (colonIndex === -1) return null

  let valueStart = colonIndex + 1
  while (valueStart < content.length && /\s/.test(content[valueStart])) {
    valueStart += 1
  }
  if (content[valueStart] !== '"') return null
  valueStart += 1

  let index = valueStart
  let escaping = false
  while (index < content.length) {
    const char = content[index]
    if (escaping) {
      escaping = false
      index += 1
      continue
    }
    if (char === '\\') {
      escaping = true
      index += 1
      continue
    }
    if (char === '"') {
      return content.slice(valueStart, index)
    }
    index += 1
  }
  return null
}

function extractNumericField(content, key) {
  const match = content.match(new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`))
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function extractJsonishHtmlSegment(content) {
  const htmlKey = '"html"'
  const nameKey = '"name"'
  const htmlKeyIndex = content.indexOf(htmlKey)
  if (htmlKeyIndex === -1) return null
  const htmlColonIndex = content.indexOf(':', htmlKeyIndex + htmlKey.length)
  if (htmlColonIndex === -1) return null

  let htmlValueStart = htmlColonIndex + 1
  while (htmlValueStart < content.length && /\s/.test(content[htmlValueStart])) {
    htmlValueStart += 1
  }
  if (content[htmlValueStart] !== '"') return null
  htmlValueStart += 1

  const nameKeyIndex = content.lastIndexOf(nameKey)
  if (nameKeyIndex === -1 || nameKeyIndex <= htmlValueStart) return null

  let htmlValueEnd = nameKeyIndex
  while (htmlValueEnd > htmlValueStart && /\s/.test(content[htmlValueEnd - 1])) {
    htmlValueEnd -= 1
  }
  if (content[htmlValueEnd - 1] === ',') htmlValueEnd -= 1
  while (htmlValueEnd > htmlValueStart && /\s/.test(content[htmlValueEnd - 1])) {
    htmlValueEnd -= 1
  }
  if (content[htmlValueEnd - 1] !== '"') return null

  return content.slice(htmlValueStart, htmlValueEnd - 1)
}

function tryRepairHtmlAssetGenerationResult(content) {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') || !trimmed.includes('"html"') || !trimmed.includes('"name"')) {
    return null
  }

  const html = extractJsonishHtmlSegment(trimmed)
  const name = extractQuotedField(trimmed, 'name')
  const width = extractNumericField(trimmed, 'width')
  const height = extractNumericField(trimmed, 'height')
  const duration = extractNumericField(trimmed, 'duration')
  if (!html || !name || width === null || height === null || duration === null) {
    return null
  }

  return {
    name: decodeJsonishString(name).trim(),
    html: decodeJsonishString(html).trim(),
    width,
    height,
    duration,
  }
}

const CURRENT_SYSTEM_PROMPT = [
  '你是一个网页动效素材生成器。',
  '你只能返回一个 JSON 对象，不能输出 markdown，不能输出解释。',
  '必须返回真实内容，不能返回占位词、模板词或字段说明。',
  '禁止输出“素材名称”“完整 HTML 或 SVG 字符串”“这里填写内容”这类占位文本。',
  '格式如下：{"name":"烟花夜空","html":"<!doctype html>...</html>","width":1920,"height":1080,"duration":5}',
  '如果是动画网页，请输出完整 HTML，包含所需的 canvas/css/js。',
  '如果是静态矢量图，也可以直接输出单个 <svg>...</svg>。',
  '不要引用外部脚本 CDN，尽量内联样式和脚本。',
  'width 和 height 默认优先使用 1920x1080，除非用户明确要求竖屏。',
  'duration 取 1 到 15 秒。',
].join('\n')

const STRICT_SYSTEM_PROMPT = [
  '你是一个网页动效素材生成器。',
  '你必须返回严格 JSON，首字符必须是 {，末字符必须是 }，不允许 markdown、不允许解释、不允许前后缀文本。',
  '返回格式固定为：{"name":"...","html":"...","width":1920,"height":1080,"duration":5}',
  'html 字段必须是完整的 HTML 或 SVG 字符串，不能省略，不能截断，不能使用占位词。',
  'name 字段必须放在 html 字段之后。',
  'width、height、duration 必须是数字，不要加引号。',
  '不要输出代码块标记，不要输出注释，不要输出“以下是结果”。',
  '如果 html 内部包含双引号，必须正确转义。',
  '不要引用外部 CDN，所有 CSS/JS 内联。',
  '如果用户没有要求竖屏，默认输出 1920x1080。',
].join('\n')

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = args.baseUrl || process.env.HTML_LLM_BASE_URL || 'http://127.0.0.1:55555'
  const apiKey = args.apiKey || process.env.HTML_LLM_API_KEY || 'sk-any'
  const model = args.model || process.env.HTML_LLM_MODEL || 'deepseek-chat'
  const prompt = args.prompt || '用网页生成一个烟花效果，黑色夜空背景，5秒，1920x1080'
  const strict = args.strict === 'true'
  const useResponseFormat = args.responseFormat === 'json_object'
  const resolvedUrl = buildChatCompletionsUrl(baseUrl)
  const systemPrompt = strict ? STRICT_SYSTEM_PROMPT : CURRENT_SYSTEM_PROMPT

  const body = {
    model,
    temperature: strict ? 0 : 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    ...(useResponseFormat ? { response_format: { type: 'json_object' } } : {}),
  }

  console.log('URL:', resolvedUrl)
  console.log('Model:', model)
  console.log('Strict:', strict)
  console.log('response_format:', useResponseFormat ? 'json_object' : 'none')
  console.log('Prompt:', prompt)

  const response = await fetch(resolvedUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const rawText = await response.text()
  const outputDir = path.join(process.cwd(), 'outputs', 'prompt-tests')
  fs.mkdirSync(outputDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rawPath = path.join(outputDir, `${stamp}-${strict ? 'strict' : 'current'}.raw.txt`)
  fs.writeFileSync(rawPath, rawText, 'utf-8')

  console.log('\nHTTP:', response.status)
  console.log('Raw saved:', rawPath)

  if (!response.ok) {
    console.log('\nRaw response:\n')
    console.log(rawText)
    process.exit(1)
  }

  let content = ''
  try {
    const payload = JSON.parse(rawText)
    content = payload?.choices?.[0]?.message?.content || ''
  } catch (error) {
    console.log('\nTop-level response is not valid JSON:\n')
    console.log(rawText)
    throw error
  }

  console.log('\nAssistant content preview:\n')
  console.log(content.slice(0, 1200))

  try {
    const parsed = JSON.parse(extractJsonText(content))
    console.log('\nStrict JSON parse: success')
    console.log('name:', parsed.name)
    console.log('width x height:', parsed.width, 'x', parsed.height)
    console.log('duration:', parsed.duration)
    console.log('html length:', typeof parsed.html === 'string' ? parsed.html.length : 'N/A')
    return
  } catch {
    console.log('\nStrict JSON parse: failed')
  }

  const repaired = tryRepairHtmlAssetGenerationResult(content)
  if (repaired) {
    console.log('\nRepaired parse: success')
    console.log('name:', repaired.name)
    console.log('width x height:', repaired.width, 'x', repaired.height)
    console.log('duration:', repaired.duration)
    console.log('html length:', repaired.html.length)
    return
  }

  console.log('\nRepaired parse: failed')
  process.exit(2)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

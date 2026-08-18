import type { ChatUsage, OllamaModelMeta } from '../ollama/client'
import type { OllamaConfig } from '../ollama/types'
import { getActivePersona } from '../personas/store'
import { getUserProfile } from '../profile/store'
import type { UserProfile } from '../profile/types'
import { getOpenArticles } from '../web/articles'
import { getWebDigest } from '../web/digest'
import { getWebConfig } from '../web/store'
import type { OpenArticle, WebConfig, WebDigest } from '../web/types'
import type { ChatMessage } from './session'
import { buildSystemPrompt } from './systemPrompt'

export type ChatLog = {
  exportedAt: string
  app: 'faces'
  persona: {
    id: string
    name: string
    sphereColor: string
    defaultFace: string
    systemPrompt: string
    voiceAge: string
    voiceGender: string
    voiceAccent: string
  }
  systemPrompt: string
  profile: UserProfile
  web: { config: WebConfig; digest: WebDigest; articles: OpenArticle[] }
  face: string
  streaming: boolean
  error: string | null
  ollama: OllamaConfig
  model: OllamaModelMeta | null
  context: { usedTokens: number; num_ctx: number }
  lastUsage: ChatUsage | null
  messages: ChatMessage[]
}

function redactWebConfig(cfg: WebConfig): WebConfig {
  return {
    ...cfg,
    jinaApiKey: cfg.jinaApiKey ? '[saved]' : '',
  }
}

export function downloadChatLog(input: {
  messages: ChatMessage[]
  face: string
  streaming: boolean
  error: string | null
  usedTokens: number
  lastUsage: ChatUsage | null
  ollama: OllamaConfig
  model: OllamaModelMeta | null
}): void {
  const persona = getActivePersona()
  const log: ChatLog = {
    exportedAt: new Date().toISOString(),
    app: 'faces',
    persona: {
      id: persona.id,
      name: persona.name,
      sphereColor: persona.sphereColor,
      defaultFace: persona.defaultFace,
      systemPrompt: persona.systemPrompt,
      voiceAge: persona.voiceAge,
      voiceGender: persona.voiceGender,
      voiceAccent: persona.voiceAccent,
    },
    systemPrompt: buildSystemPrompt(persona),
    profile: getUserProfile(),
    web: {
      config: redactWebConfig(getWebConfig()),
      digest: getWebDigest(),
      articles: getOpenArticles(),
    },
    face: input.face,
    streaming: input.streaming,
    error: input.error,
    ollama: input.ollama,
    model: input.model,
    context: {
      usedTokens: input.usedTokens,
      num_ctx: input.ollama.options.num_ctx,
    },
    lastUsage: input.lastUsage,
    messages: input.messages,
  }
  const blob = new Blob([JSON.stringify(log, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = chatLogFilename(persona.name, log.exportedAt)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function chatLogFilename(personaName: string, iso: string): string {
  const who = slug(personaName)
  const when = iso.slice(0, 19).replace(/:/g, '-')
  return `faces-${who}-${when}.json`
}

function slug(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'chat'
}

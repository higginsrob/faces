import { useSyncExternalStore } from 'react'
import { FaceStreamParser } from '../emotions/parseFace'
import { isCatalogEmoji } from '../emotions/catalog'
import {
  friendlyOllamaError,
  streamOllamaChat,
  type ChatTurn,
  type ChatUsage,
} from '../ollama/client'
import { getOllamaConfig } from '../ollama/store'
import {
  findPersonaByEmoji,
  getActivePersona,
  getPersonaById,
  setActivePersona,
} from '../personas/store'
import type { Persona } from '../personas/types'
import { chatKey } from '../profile/keys'
import {
  getActiveProfileId,
  onProfileDidChange,
  onProfileWillChange,
} from '../profile/store'
import { loadJson, newId, removeJson, saveJson } from '../storage'
import {
  hasSpeakableContent,
  stripForSpeech,
  takeCompleteSentences,
} from '../voice/spokenText'
import { getTtsConfig } from '../voice/ttsStore'
import {
  enqueueSpeak,
  flushSpeak,
  isTtsBusy,
  isTtsPlaying,
  setTtsErrorHandler,
  setTtsPlaybackHandlers,
  setTtsSpeaker,
  stopTts,
} from '../voice/tts'
import {
  articleForUrl,
  briefingItemsForTurn,
  isDroppedSourceUrl,
  loadArticlesForUserText,
  setSpeakingArticleUrl,
} from '../web/articles'
import { appendMissingNewsLinks, parseNewsLinkLines } from '../web/links'
import { markWebMentionsFromReply, syncWebMentionsFromMessages } from '../web/matchMention'
import { markWeatherTalkedToday } from '../web/weatherTalk'
import { findAddressedPersonas } from './addressedPersonas'
import { classifySpeaker } from './classifySpeaker'
import {
  buildRoomTurns,
  createSpeakerPrefixGate,
  personaSpeakerNames,
  stripSpeakerPrefix,
} from './roomTurns'
import { buildSystemPrompt } from './systemPrompt'

const FACE_RESET_WITHOUT_SPEECH_MS = 5_000
const MAX_CHAIN = 3
const WALL_RETURN_MS = 1_100
const TTS_IDLE_TIMEOUT_MS = 120_000

const WALL_OPENER =
  'The user picked you off the wall. Start speaking. Prefer unused TODAY / newspaper notes as your topic. You may address another face by name if you want them to weigh in. Keep it to a few spoken sentences.'

let faceResetTimer: number | null = null
let speechOkThisTurn = false
let chainGen = 0
let ttsWait: { gen: number; resolve: () => void } | null = null

export type ViewMode = 'focused' | 'gallery'
export type SpeakerMode = 'auto' | 'locked'
export const AUTO_SPEAKER = 'auto'

export type AddressStatus = 'auto' | 'respond' | 'done'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  face?: string
  personaId?: string
  model?: string
  addressedPersonaIds?: string[]
  addressStatus?: AddressStatus
}

export type SettingsTab =
  | 'profile'
  | 'personas'
  | 'chat'
  | 'rerank'
  | 'voice'
  | 'news'

export type SessionState = {
  messages: ChatMessage[]
  face: string
  viewMode: ViewMode
  speakerMode: SpeakerMode
  highlightedFace: string | null
  classifying: boolean
  readingArticle: boolean
  streaming: boolean
  thinkTokens: number
  error: string | null
  settingsOpen: boolean
  settingsTab: SettingsTab
  usageOpen: boolean
  newsOpen: boolean
  speakingMessageId: string | null
  usedTokens: number
  lastUsage: ChatUsage | null
}

type PersistedSession = {
  messages: ChatMessage[]
  usedTokens: number
  lastUsage: ChatUsage | null
  newsOpen: boolean
  speakerMode: SpeakerMode
  viewMode: ViewMode
  face: string
}

const PERSIST_DEBOUNCE_MS = 200

const listeners = new Set<() => void>()

function initialFace(): string {
  return getActivePersona().defaultFace
}

function idleSession(): SessionState {
  return {
    messages: [],
    face: initialFace(),
    viewMode: 'gallery',
    speakerMode: 'auto',
    highlightedFace: null,
    classifying: false,
    readingArticle: false,
    streaming: false,
    thinkTokens: 0,
    error: null,
    settingsOpen: false,
    settingsTab: 'chat',
    usageOpen: false,
    newsOpen: false,
    speakingMessageId: null,
    usedTokens: 0,
    lastUsage: null,
  }
}

let snap: SessionState = hydrateSession(idleSession())

let abort: AbortController | null = null
let ttsMutedThisTurn = false
let persistTimer: number | null = null

function emit(): void {
  for (const fn of listeners) fn()
  schedulePersist()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function getSnapshot(): SessionState {
  return snap
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function set(patch: Partial<SessionState>): void {
  snap = { ...snap, ...patch }
  emit()
}

function withoutEmptyTrailingAssistant(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1]
  if (last?.role === 'assistant' && !last.content.trim()) {
    return messages.slice(0, -1)
  }
  return messages
}

function durableFromSnap(): PersistedSession {
  return {
    messages: withoutEmptyTrailingAssistant(snap.messages),
    usedTokens: snap.usedTokens,
    lastUsage: snap.lastUsage,
    newsOpen: snap.newsOpen,
    speakerMode: snap.speakerMode,
    viewMode: snap.viewMode,
    face: snap.face,
  }
}

function isEmptyDurable(data: PersistedSession): boolean {
  return (
    data.messages.length === 0 &&
    data.usedTokens === 0 &&
    data.lastUsage == null &&
    !data.newsOpen &&
    data.speakerMode === 'auto' &&
    data.viewMode === 'gallery'
  )
}

function persistSession(profileId = getActiveProfileId()): void {
  const data = durableFromSnap()
  const key = chatKey(profileId)
  if (isEmptyDurable(data)) {
    removeJson(key)
    return
  }
  saveJson(key, data)
}

function schedulePersist(): void {
  if (typeof window === 'undefined') return
  if (persistTimer != null) return
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    persistSession()
  }, PERSIST_DEBOUNCE_MS)
}

function flushPersist(): void {
  if (persistTimer != null) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  persistSession()
}

function sanitizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const m = value as Record<string, unknown>
  if (typeof m.id !== 'string' || !m.id) return null
  if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') {
    return null
  }
  if (typeof m.content !== 'string') return null
  const next: ChatMessage = { id: m.id, role: m.role, content: m.content }
  if (typeof m.face === 'string') next.face = m.face
  if (typeof m.personaId === 'string') next.personaId = m.personaId
  if (typeof m.model === 'string') next.model = m.model
  if (
    Array.isArray(m.addressedPersonaIds) &&
    m.addressedPersonaIds.every((id) => typeof id === 'string')
  ) {
    next.addressedPersonaIds = m.addressedPersonaIds
  }
  if (
    m.addressStatus === 'auto' ||
    m.addressStatus === 'respond' ||
    m.addressStatus === 'done'
  ) {
    next.addressStatus = m.addressStatus
  }
  return next
}

function sanitizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  const out: ChatMessage[] = []
  for (const item of value) {
    const message = sanitizeMessage(item)
    if (message) out.push(message)
  }
  return withoutEmptyTrailingAssistant(out)
}

function sanitizeUsage(value: unknown): ChatUsage | null {
  if (!value || typeof value !== 'object') return null
  const u = value as Record<string, unknown>
  if (typeof u.promptTokens !== 'number' || !Number.isFinite(u.promptTokens)) {
    return null
  }
  if (
    typeof u.completionTokens !== 'number' ||
    !Number.isFinite(u.completionTokens)
  ) {
    return null
  }
  const next: ChatUsage = {
    promptTokens: u.promptTokens,
    completionTokens: u.completionTokens,
  }
  if (typeof u.model === 'string') next.model = u.model
  const durations = [
    'totalDurationNs',
    'loadDurationNs',
    'promptEvalDurationNs',
    'evalDurationNs',
  ] as const
  for (const key of durations) {
    if (typeof u[key] === 'number' && Number.isFinite(u[key])) {
      next[key] = u[key]
    }
  }
  return next
}

function hydrateSession(
  base: SessionState,
  profileId = getActiveProfileId(),
): SessionState {
  const raw = loadJson<unknown>(chatKey(profileId), null)
  if (!raw || typeof raw !== 'object') return base
  const p = raw as Record<string, unknown>
  const messages = sanitizeMessages(p.messages)
  const usedTokens =
    typeof p.usedTokens === 'number' &&
    Number.isFinite(p.usedTokens) &&
    p.usedTokens >= 0
      ? p.usedTokens
      : 0
  const lastUsage = sanitizeUsage(p.lastUsage)
  const newsOpen = p.newsOpen === true
  const speakerMode: SpeakerMode = p.speakerMode === 'locked' ? 'locked' : 'auto'
  const viewMode: ViewMode = p.viewMode === 'focused' ? 'focused' : 'gallery'
  let face = typeof p.face === 'string' ? p.face : base.face
  if (!isCatalogEmoji(face) && face !== getActivePersona().defaultFace) {
    face = base.face
  }
  return {
    ...base,
    messages,
    usedTokens,
    lastUsage,
    newsOpen,
    speakerMode,
    viewMode,
    face,
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPersist)
}

onProfileWillChange((prevId) => {
  stopTurn()
  ttsMutedThisTurn = false
  flushPersist()
  persistSession(prevId)
})

onProfileDidChange(() => {
  const settingsOpen = snap.settingsOpen
  const settingsTab = snap.settingsTab
  const usageOpen = snap.usageOpen
  const newsOpen = snap.newsOpen
  snap = {
    ...hydrateSession(idleSession()),
    settingsOpen,
    settingsTab,
    usageOpen,
    newsOpen,
  }
  emit()
})

function clearFaceResetTimer(): void {
  if (faceResetTimer == null) return
  window.clearTimeout(faceResetTimer)
  faceResetTimer = null
}

function resetFaceToDefault(): void {
  const face = getActivePersona().defaultFace
  if (snap.streaming || isTtsBusy() || snap.face === face) return
  set({ face })
}

function scheduleFaceReset(delayMs: number): void {
  clearFaceResetTimer()
  faceResetTimer = window.setTimeout(() => {
    faceResetTimer = null
    resetFaceToDefault()
  }, delayMs)
}

function scheduleFaceResetAfterTurn(): void {
  if (snap.viewMode === 'gallery') return
  if (faceResetTimer != null || isTtsBusy()) return
  if (speechOkThisTurn) {
    resetFaceToDefault()
    return
  }
  scheduleFaceReset(FACE_RESET_WITHOUT_SPEECH_MS)
}

function resolveTtsWait(): void {
  if (!ttsWait) return
  const done = ttsWait.resolve
  ttsWait = null
  done()
}

export function setError(error: string | null): void {
  set({ error })
}

setTtsErrorHandler((msg) => {
  speechOkThisTurn = false
  setError(msg)
  resolveTtsWait()
  if (!snap.streaming) {
    scheduleFaceReset(FACE_RESET_WITHOUT_SPEECH_MS)
  }
})
setTtsPlaybackHandlers({
  onStart: () => {
    speechOkThisTurn = true
    clearFaceResetTimer()
  },
  onIdle: () => {
    if (ttsWait && ttsWait.gen === chainGen) resolveTtsWait()
    if (!snap.streaming) clearSpeaking()
    if (snap.streaming) return
    if (snap.viewMode === 'gallery') return
    resetFaceToDefault()
  },
})

export function setSettingsOpen(open: boolean): void {
  set({ settingsOpen: open })
}

export function setSettingsTab(tab: SettingsTab): void {
  set({ settingsTab: tab, settingsOpen: true })
}

export function setUsageOpen(open: boolean): void {
  set({ usageOpen: open })
}

export function setNewsOpen(open: boolean): void {
  if (open) set({ newsOpen: true, settingsOpen: false, usageOpen: false })
  else set({ newsOpen: false })
}

function dropEmptyAssistant(): ChatMessage[] {
  return withoutEmptyTrailingAssistant(snap.messages)
}

function spokenTextForAddress(content: string): string {
  return parseNewsLinkLines(content).text || content
}

function addressedIdsFromText(
  content: string,
  speakerId: string | undefined,
): string[] {
  return findAddressedPersonas(spokenTextForAddress(content), {
    excludeId: speakerId,
  }).map((p) => p.id)
}

function autoAddressStatus(
  allowFollowUp: boolean,
  chainIndex: number,
): AddressStatus {
  return allowFollowUp && chainIndex + 1 < MAX_CHAIN ? 'auto' : 'respond'
}

function withAddressScan(
  message: ChatMessage,
  content: string,
  speakerId: string | undefined,
  allowFollowUp: boolean,
  chainIndex: number,
): ChatMessage {
  const ids = addressedIdsFromText(content, speakerId)
  if (!ids.length) {
    return { ...message, content }
  }
  const locked =
    message.addressStatus === 'respond' || message.addressStatus === 'done'
  return {
    ...message,
    content,
    addressedPersonaIds: ids,
    addressStatus: locked
      ? message.addressStatus
      : autoAddressStatus(allowFollowUp, chainIndex),
  }
}

function patchMessages(next: ChatMessage[]): void {
  snap = { ...snap, messages: next }
  emit()
}

function mapMessage(
  id: string,
  patch: (m: ChatMessage) => ChatMessage,
): void {
  patchMessages(snap.messages.map((m) => (m.id === id ? patch(m) : m)))
}

function demotePendingAutoAddresses(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.addressStatus === 'auto' ? { ...m, addressStatus: 'respond' } : m,
  )
}

function markAddressDone(messageId: string): void {
  const msg = snap.messages.find((m) => m.id === messageId)
  if (!msg || msg.addressStatus === 'done') return
  mapMessage(messageId, (m) => ({ ...m, addressStatus: 'done' }))
}

function personasFromAddressIds(
  ids: string[] | undefined,
  spokenIds: Set<string>,
  pending: Persona[],
): Persona[] {
  const next: Persona[] = []
  for (const id of ids ?? []) {
    if (spokenIds.has(id) || pending.some((q) => q.id === id)) continue
    if (next.some((q) => q.id === id)) continue
    const persona = getPersonaById(id)
    if (!persona) continue
    if (spokenIds.size + pending.length + next.length >= MAX_CHAIN) break
    next.push(persona)
  }
  return next
}

function markSpeaking(messageId: string): void {
  if (ttsMutedThisTurn || !getTtsConfig().enabled) return
  if (snap.speakingMessageId === messageId) return
  set({ speakingMessageId: messageId })
}

function clearSpeaking(): void {
  if (!snap.speakingMessageId) return
  set({ speakingMessageId: null })
}

function stopTurn(): void {
  chainGen += 1
  resolveTtsWait()
  abort?.abort()
  abort = null
  ttsMutedThisTurn = true
  stopTts()
  clearFaceResetTimer()
  snap = {
    ...snap,
    messages: demotePendingAutoAddresses(snap.messages),
    speakingMessageId: null,
  }
  emit()
}

function applyGallery(opts?: {
  clearMessages?: boolean
  clearError?: boolean
}): void {
  const persona = getActivePersona()
  snap = {
    ...snap,
    speakerMode: 'auto',
    messages: opts?.clearMessages ? [] : dropEmptyAssistant(),
    viewMode: 'gallery',
    face: persona.defaultFace,
    highlightedFace: null,
    classifying: false,
    readingArticle: false,
    streaming: false,
    thinkTokens: 0,
    error: opts?.clearMessages || opts?.clearError ? null : snap.error,
    speakingMessageId: null,
    ...(opts?.clearMessages
      ? { usedTokens: 0, lastUsage: null }
      : {}),
  }
  emit()
}

export function handleSessionEscape(): boolean {
  if (snap.settingsOpen || snap.usageOpen) return false
  if (typeof document !== 'undefined' && document.querySelector('.guide-overlay')) {
    return false
  }
  const busy =
    isTtsPlaying() ||
    isTtsBusy() ||
    Boolean(snap.speakingMessageId) ||
    snap.streaming ||
    snap.classifying ||
    snap.readingArticle ||
    chainRunning()
  if (busy || snap.viewMode === 'focused') {
    enterGallery()
    return true
  }
  return false
}

function queueSpeech(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const toSpeak = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
  const { sentences, rest } = takeCompleteSentences(toSpeak)
  for (const s of sentences) enqueueSpeak(s)
  if (rest.trim()) flushSpeak(rest)
  return isTtsBusy() || isTtsPlaying()
}

export function stopPlayback(): void {
  ttsMutedThisTurn = true
  stopTts()
  setSpeakingArticleUrl(null)
  const inFlight =
    chainRunning() ||
    snap.streaming ||
    snap.classifying ||
    snap.readingArticle
  if (inFlight) {
    chainGen += 1
    resolveTtsWait()
    abort?.abort()
    abort = null
    snap = {
      ...snap,
      messages: demotePendingAutoAddresses(dropEmptyAssistant()),
      streaming: false,
      classifying: false,
      readingArticle: false,
      thinkTokens: 0,
      speakingMessageId: null,
    }
    emit()
    return
  }
  clearSpeaking()
}

function isMessageSpeaking(messageId: string): boolean {
  return snap.speakingMessageId === messageId
}

export function toggleMessageSpeech(messageId: string): void {
  if (isMessageSpeaking(messageId)) {
    stopPlayback()
    return
  }
  if (!getTtsConfig().enabled) {
    setError('Turn on voice in Settings to hear this.')
    return
  }
  const msg = snap.messages.find((m) => m.id === messageId)
  if (!msg || msg.role !== 'assistant') return
  const text = spokenTextForAddress(msg.content)
  if (!hasSpeakableContent(stripForSpeech(text))) return

  stopPlayback()
  const persona =
    (msg.personaId ? getPersonaById(msg.personaId) : null) ?? getActivePersona()
  setTtsSpeaker(persona)
  ttsMutedThisTurn = true
  set({ speakingMessageId: messageId })
  if (!queueSpeech(text)) clearSpeaking()
}

export function clearChat(): void {
  stopTurn()
  ttsMutedThisTurn = false
  applyGallery({ clearMessages: true })
  flushPersist()
}

export function setFace(face: string): void {
  if (!isCatalogEmoji(face) && face !== getActivePersona().defaultFace) return
  set({ face })
}

export function enterGallery(): void {
  const idleGallery =
    snap.viewMode === 'gallery' &&
    !snap.streaming &&
    !snap.classifying &&
    !snap.readingArticle &&
    !chainRunning() &&
    !isTtsPlaying() &&
    !isTtsBusy()
  if (idleGallery && snap.speakerMode === 'auto') return
  stopTurn()
  ttsMutedThisTurn = false
  applyGallery({ clearError: true })
}

function parkOnWall(): void {
  const persona = getActivePersona()
  snap = {
    ...snap,
    viewMode: 'gallery',
    face: persona.defaultFace,
    highlightedFace: null,
    classifying: false,
    readingArticle: false,
    streaming: false,
  }
  emit()
}

function finishAutoChain(): void {
  if (snap.speakerMode !== 'auto') return
  ttsMutedThisTurn = false
  applyGallery()
}

function adoptSpeaker(id: string): Persona {
  setActivePersona(id)
  const persona = getActivePersona()
  snap = {
    ...snap,
    viewMode: 'focused',
    face: persona.defaultFace,
    highlightedFace: null,
    classifying: false,
  }
  emit()
  return persona
}

export function switchPersona(id: string): void {
  stopTurn()
  ttsMutedThisTurn = false
  setActivePersona(id)
  const persona = getActivePersona()
  snap = {
    ...snap,
    messages: dropEmptyAssistant(),
    face: persona.defaultFace,
    highlightedFace: null,
    classifying: false,
    readingArticle: false,
    streaming: false,
    thinkTokens: 0,
    error: null,
  }
  emit()
}

export function setSpeakerAuto(): void {
  if (snap.speakerMode === 'auto') return
  set({ speakerMode: 'auto' })
}

export function lockSpeaker(id: string): void {
  stopTurn()
  ttsMutedThisTurn = false
  setActivePersona(id)
  const persona = getActivePersona()
  snap = {
    ...snap,
    speakerMode: 'locked',
    messages: dropEmptyAssistant(),
    viewMode: 'focused',
    face: persona.defaultFace,
    highlightedFace: null,
    classifying: false,
    readingArticle: false,
    streaming: false,
    thinkTokens: 0,
    error: null,
  }
  emit()
}

function toTurns(
  persona: Persona,
  opts?: {
    emotionProtocol?: boolean
    hiddenUser?: string
    newspaper?: boolean
  },
): ChatTurn[] {
  const turns = buildRoomTurns(
    persona,
    snap.messages,
    buildSystemPrompt(persona, {
      emotionProtocol: opts?.emotionProtocol,
      topicPriority: opts?.newspaper ? 'newspaper' : undefined,
    }),
    { streaming: snap.streaming },
  )
  const cue = opts?.hiddenUser?.trim()
  if (cue) turns.push({ role: 'user', content: cue })
  return turns
}

function sleep(ms: number, signal: AbortSignal, gen: number): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || gen !== chainGen) {
      resolve()
      return
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function chainRunning(): boolean {
  return abort != null && !abort.signal.aborted
}

function waitForTtsIdle(gen: number): Promise<void> {
  if (gen !== chainGen) return Promise.resolve()
  if (!getTtsConfig().enabled || ttsMutedThisTurn) return Promise.resolve()
  if (!isTtsBusy() && !isTtsPlaying()) return Promise.resolve()
  return new Promise((resolve) => {
    if (gen !== chainGen || (!isTtsBusy() && !isTtsPlaying())) {
      resolve()
      return
    }
    const timer = window.setTimeout(() => {
      if (ttsWait?.gen === gen) resolveTtsWait()
    }, TTS_IDLE_TIMEOUT_MS)
    ttsWait = {
      gen,
      resolve: () => {
        window.clearTimeout(timer)
        resolve()
      },
    }
  })
}

function beginTurn(): { signal: AbortSignal; gen: number } {
  stopTurn()
  ttsMutedThisTurn = false
  clearFaceResetTimer()
  speechOkThisTurn = false
  abort = new AbortController()
  return { signal: abort.signal, gen: chainGen }
}

async function runAssistantTurn(
  persona: Persona,
  opts: {
    signal: AbortSignal
    gen: number
    hiddenUser?: string
    newspaper?: boolean
    allowFollowUp: boolean
    chainIndex: number
  },
): Promise<{ text: string; messageId: string } | null> {
  if (opts.signal.aborted || opts.gen !== chainGen) return null
  persona = adoptSpeaker(persona.id)
  setTtsSpeaker(persona)
  syncWebMentionsFromMessages(snap.messages)

  const assistantId = newId()
  const assistant: ChatMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    face: persona.defaultFace,
    personaId: persona.id,
    model: getOllamaConfig().model.trim() || undefined,
  }
  snap = {
    ...snap,
    messages: [...snap.messages, assistant],
    streaming: true,
    classifying: false,
    readingArticle: false,
  }
  emit()

  const parser = new FaceStreamParser()
  const names = personaSpeakerNames()
  const prefixGate = createSpeakerPrefixGate(names)
  let spokenBuf = ''
  let thinkTokens = 0

  const patchAssistant = (content: string) => {
    snap = {
      ...snap,
      face: persona.defaultFace,
      messages: snap.messages.map((m) =>
        m.id === assistantId
          ? withAddressScan(
              { ...m, face: persona.defaultFace },
              content,
              persona.id,
              opts.allowFollowUp,
              opts.chainIndex,
            )
          : m,
      ),
    }
    emit()
  }

  try {
    await streamOllamaChat({
      messages: toTurns(persona, {
        emotionProtocol: true,
        hiddenUser: opts.hiddenUser,
        newspaper: opts.newspaper,
      }),
      signal: opts.signal,
      onUsage: (usage) => {
        if (opts.signal.aborted || opts.gen !== chainGen) return
        snap = {
          ...snap,
          usedTokens: usage.promptTokens + usage.completionTokens,
          lastUsage: usage,
          messages: usage.model
            ? snap.messages.map((m) =>
                m.id === assistantId ? { ...m, model: usage.model } : m,
              )
            : snap.messages,
        }
        emit()
      },
      onThinkDelta: (piece) => {
        if (opts.signal.aborted || opts.gen !== chainGen || !piece) return
        thinkTokens += 1
        set({ thinkTokens })
      },
      onDelta: (piece) => {
        if (opts.signal.aborted || opts.gen !== chainGen) return
        const result = parser.push(piece)
        if (result.spokenDelta) {
          spokenBuf += prefixGate.push(result.spokenDelta)
          const { sentences, rest } = takeCompleteSentences(spokenBuf)
          spokenBuf = rest
          if (!ttsMutedThisTurn) {
            for (const s of sentences) enqueueSpeak(s)
            if (isTtsBusy()) markSpeaking(assistantId)
          }
        }
        patchAssistant(stripSpeakerPrefix(parser.spoken, names))
      },
    })
    if (opts.signal.aborted || opts.gen !== chainGen) return null
    const fin = parser.finish()
    if (fin.spokenDelta) {
      spokenBuf += prefixGate.push(fin.spokenDelta)
    }
    spokenBuf += prefixGate.finish()
    if (spokenBuf.trim() && !ttsMutedThisTurn) {
      flushSpeak(spokenBuf)
      if (isTtsBusy()) markSpeaking(assistantId)
    }
    const spoken = stripSpeakerPrefix(parser.spoken, names)
    const mentioned = markWebMentionsFromReply(spoken)
    const withLinks = appendMissingNewsLinks(
      spoken,
      mentioned.map((item) => item.url).filter((url): url is string => Boolean(url)),
    )
    patchAssistant(withLinks)
    return { text: withLinks, messageId: assistantId }
  } catch (e) {
    if (opts.signal.aborted || opts.gen !== chainGen) return null
    const msg = friendlyOllamaError(e)
    const content = stripSpeakerPrefix(parser.spoken, names).trim()
    if (content) {
      const mentioned = markWebMentionsFromReply(content)
      const withLinks = appendMissingNewsLinks(
        content,
        mentioned
          .map((item) => item.url)
          .filter((url): url is string => Boolean(url)),
      )
      snap = {
        ...snap,
        streaming: false,
        classifying: false,
        readingArticle: false,
        thinkTokens: 0,
        error: msg,
        messages: snap.messages.map((m) =>
          m.id === assistantId
            ? withAddressScan(
                m,
                withLinks,
                persona.id,
                opts.allowFollowUp,
                opts.chainIndex,
              )
            : m,
        ),
      }
      emit()
      return { text: withLinks, messageId: assistantId }
    }
    snap = {
      ...snap,
      streaming: false,
      classifying: false,
      readingArticle: false,
      thinkTokens: 0,
      error: msg,
      messages: snap.messages.filter((m) => m.id !== assistantId),
    }
    emit()
    return null
  } finally {
    if (opts.gen === chainGen) {
      set({
        streaming: false,
        classifying: false,
        readingArticle: false,
        thinkTokens: 0,
      })
    }
  }
}

async function runChain(opts: {
  queue: Persona[]
  allowFollowUp: boolean
  newspaper: boolean
  wallStart: boolean
  gen: number
  signal: AbortSignal
  addressFrom?: Persona
}): Promise<void> {
  const pending = [...opts.queue]
  const spokenIds = new Set<string>()
  let lastSpeaker: Persona | null = null
  let index = 0
  let followUpFromId: string | null = null

  while (pending.length && !opts.signal.aborted && opts.gen === chainGen) {
    if (followUpFromId) {
      markAddressDone(followUpFromId)
      followUpFromId = null
    }
    const persona = pending.shift()!
    let hiddenUser: string | undefined
    if (opts.wallStart && index === 0) {
      hiddenUser = WALL_OPENER
    } else if (index === 0 && opts.addressFrom) {
      hiddenUser = `${opts.addressFrom.name} just spoke and addressed you. Reply in your voice. You may address another face by name if you want them to weigh in.`
    } else if (index > 0) {
      hiddenUser =
        opts.allowFollowUp && lastSpeaker
          ? `${lastSpeaker.name} just spoke and addressed you. Reply in your voice. You may address another face by name if you want them to weigh in.`
          : 'The user also asked you to respond. Reply in your voice.'
    }

    const result = await runAssistantTurn(persona, {
      signal: opts.signal,
      gen: opts.gen,
      hiddenUser,
      newspaper: opts.newspaper && index === 0,
      allowFollowUp: opts.allowFollowUp,
      chainIndex: index,
    })
    if (opts.signal.aborted || opts.gen !== chainGen) return

    await waitForTtsIdle(opts.gen)
    if (opts.signal.aborted || opts.gen !== chainGen) return
    clearSpeaking()

    spokenIds.add(persona.id)
    lastSpeaker = persona
    index += 1
    if (opts.wallStart && index === 1 && result?.text) {
      markWeatherTalkedToday()
    }

    const addressMsg = result
      ? snap.messages.find((m) => m.id === result.messageId)
      : undefined
    const nextFromAddress =
      addressMsg?.addressStatus === 'auto'
        ? personasFromAddressIds(
            addressMsg.addressedPersonaIds,
            spokenIds,
            pending,
          )
        : []
    const willContinue = pending.length > 0 || nextFromAddress.length > 0
    if (willContinue && snap.speakerMode === 'auto') {
      parkOnWall()
      await sleep(WALL_RETURN_MS, opts.signal, opts.gen)
      if (opts.signal.aborted || opts.gen !== chainGen) return
    }

    const stillAuto =
      result &&
      snap.messages.find((m) => m.id === result.messageId)?.addressStatus ===
        'auto'
    if (stillAuto) {
      const confirmed = personasFromAddressIds(
        snap.messages.find((m) => m.id === result.messageId)
          ?.addressedPersonaIds,
        spokenIds,
        pending,
      )
      for (const p of confirmed) pending.push(p)
      if (confirmed.length) followUpFromId = result.messageId
      else markAddressDone(result.messageId)
    }
  }

  if (opts.gen !== chainGen || opts.signal.aborted) return
  if (abort?.signal === opts.signal) abort = null
  if (snap.speakerMode === 'auto') finishAutoChain()
  else scheduleFaceResetAfterTurn()
}

export function cancelAddressAuto(messageId: string): void {
  const msg = snap.messages.find((m) => m.id === messageId)
  if (!msg || msg.addressStatus !== 'auto') return
  mapMessage(messageId, (m) => ({ ...m, addressStatus: 'respond' }))
}

export function respondToAddress(messageId: string): void {
  const msg = snap.messages.find((m) => m.id === messageId)
  if (!msg || msg.addressStatus !== 'respond') return
  const queue = personasFromAddressIds(msg.addressedPersonaIds, new Set(), [])
  if (!queue.length) return
  const addressFrom = msg.personaId ? getPersonaById(msg.personaId) : undefined
  markAddressDone(messageId)
  void startAddressChain(queue, addressFrom)
}

async function startAddressChain(
  queue: Persona[],
  addressFrom: Persona | undefined,
): Promise<void> {
  const { signal, gen } = beginTurn()
  snap = {
    ...snap,
    speakerMode: 'auto',
    streaming: true,
    classifying: false,
    readingArticle: false,
    thinkTokens: 0,
    error: null,
  }
  emit()
  await runChain({
    queue,
    allowFollowUp: true,
    newspaper: false,
    wallStart: false,
    gen,
    signal,
    addressFrom,
  })
}

export async function sendUserMessage(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  const locked = snap.speakerMode === 'locked'
  const { signal, gen } = beginTurn()

  const user: ChatMessage = {
    id: newId(),
    role: 'user',
    content: trimmed,
  }
  const autoPick = !locked
  const addressed = autoPick ? findAddressedPersonas(trimmed) : []
  const needClassify = autoPick && addressed.length === 0
  snap = {
    ...snap,
    speakerMode: locked ? 'locked' : 'auto',
    messages: [...snap.messages, user],
    streaming: true,
    classifying: needClassify,
    readingArticle: false,
    thinkTokens: 0,
    error: null,
  }
  emit()

  let queue: Persona[] = []
  let allowFollowUp = false
  if (locked) {
    queue = [getActivePersona()]
  } else if (addressed.length) {
    queue = addressed
    allowFollowUp = addressed.length === 1
  } else {
    let persona = getActivePersona()
    try {
      const choice = await classifySpeaker({
        userText: trimmed,
        history: snap.messages.slice(0, -1),
        signal,
      })
      if (signal.aborted || gen !== chainGen) return
      const picked = choice ? findPersonaByEmoji(choice) : undefined
      if (picked) persona = picked
    } catch (e) {
      if (signal.aborted || gen !== chainGen) return
      void e
    }
    if (signal.aborted || gen !== chainGen) return
    queue = [persona]
    allowFollowUp = true
  }

  const lastAssistant = [...snap.messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.content.trim())?.content
  const shouldRead = briefingItemsForTurn(trimmed, lastAssistant).some(
    (item) =>
      item.url && !articleForUrl(item.url) && !isDroppedSourceUrl(item.url),
  )
  if (shouldRead) {
    snap = {
      ...snap,
      classifying: false,
      readingArticle: true,
    }
    emit()
    try {
      await loadArticlesForUserText(trimmed, signal, lastAssistant)
    } catch {
      if (signal.aborted || gen !== chainGen) return
    }
    if (signal.aborted || gen !== chainGen) return
  }

  await runChain({
    queue,
    allowFollowUp,
    newspaper: false,
    wallStart: false,
    gen,
    signal,
  })
}

export function promptPersonaFromWall(emoji: string): void {
  const persona = findPersonaByEmoji(emoji)
  if (!persona) return
  void startWallChain(persona)
}

async function startWallChain(persona: Persona): Promise<void> {
  const { signal, gen } = beginTurn()
  snap = {
    ...snap,
    speakerMode: 'auto',
    streaming: true,
    classifying: false,
    readingArticle: false,
    thinkTokens: 0,
    error: null,
  }
  emit()
  await runChain({
    queue: [persona],
    allowFollowUp: true,
    newspaper: true,
    wallStart: true,
    gen,
    signal,
  })
}

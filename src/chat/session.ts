import { useSyncExternalStore } from 'react'
import { FaceStreamParser } from '../emotions/parseFace'
import { isCatalogEmoji } from '../emotions/catalog'
import {
  friendlyOllamaError,
  streamOllamaChat,
  type ChatTurn,
  type ChatUsage,
} from '../ollama/client'
import {
  findPersonaByEmoji,
  getActivePersona,
  setActivePersona,
} from '../personas/store'
import type { Persona } from '../personas/types'
import { newId } from '../storage'
import { takeCompleteSentences } from '../voice/spokenText'
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
import { articleForUrl, briefingItemsForTurn, loadArticlesForUserText } from '../web/articles'
import { appendMissingNewsLinks } from '../web/links'
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

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  face?: string
  personaId?: string
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
  usedTokens: number
  lastUsage: ChatUsage | null
}

const listeners = new Set<() => void>()

function initialFace(): string {
  return getActivePersona().defaultFace
}

let snap: SessionState = {
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
  usedTokens: 0,
  lastUsage: null,
}

let abort: AbortController | null = null
let ttsMutedThisTurn = false

function emit(): void {
  for (const fn of listeners) fn()
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
  const last = snap.messages[snap.messages.length - 1]
  if (last?.role === 'assistant' && !last.content.trim()) {
    return snap.messages.slice(0, -1)
  }
  return snap.messages
}

function stopTurn(): void {
  chainGen += 1
  resolveTtsWait()
  abort?.abort()
  abort = null
  ttsMutedThisTurn = true
  stopTts()
  clearFaceResetTimer()
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
    ...(opts?.clearMessages
      ? { usedTokens: 0, lastUsage: null }
      : {}),
  }
  emit()
}

export function handleSessionEscape(): boolean {
  if (snap.settingsOpen || snap.usageOpen) return false
  const busy =
    isTtsPlaying() ||
    isTtsBusy() ||
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

export function clearChat(): void {
  stopTurn()
  ttsMutedThisTurn = false
  applyGallery({ clearMessages: true })
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
    !chainRunning()
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
  },
): Promise<string | null> {
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
          ? { ...m, content, face: persona.defaultFace }
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
        set({
          usedTokens: usage.promptTokens + usage.completionTokens,
          lastUsage: usage,
        })
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
    if (spokenBuf.trim() && !ttsMutedThisTurn) flushSpeak(spokenBuf)
    const spoken = stripSpeakerPrefix(parser.spoken, names)
    const mentioned = markWebMentionsFromReply(spoken)
    const withLinks = appendMissingNewsLinks(
      spoken,
      mentioned.map((item) => item.url).filter((url): url is string => Boolean(url)),
    )
    patchAssistant(withLinks)
    return withLinks
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
          m.id === assistantId ? { ...m, content: withLinks } : m,
        ),
      }
      emit()
      return withLinks
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
    return ''
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
}): Promise<void> {
  const pending = [...opts.queue]
  const spokenIds = new Set<string>()
  let lastSpeaker: Persona | null = null
  let index = 0

  while (pending.length && !opts.signal.aborted && opts.gen === chainGen) {
    const persona = pending.shift()!
    let hiddenUser: string | undefined
    if (opts.wallStart && index === 0) {
      hiddenUser = WALL_OPENER
    } else if (index > 0) {
      hiddenUser =
        opts.allowFollowUp && lastSpeaker
          ? `${lastSpeaker.name} just spoke and addressed you. Reply in your voice. You may address another face by name if you want them to weigh in.`
          : 'The user also asked you to respond. Reply in your voice.'
    }

    const spoken = await runAssistantTurn(persona, {
      signal: opts.signal,
      gen: opts.gen,
      hiddenUser,
      newspaper: opts.newspaper && index === 0,
    })
    if (opts.signal.aborted || opts.gen !== chainGen) return

    await waitForTtsIdle(opts.gen)
    if (opts.signal.aborted || opts.gen !== chainGen) return

    spokenIds.add(persona.id)
    lastSpeaker = persona
    index += 1
    if (opts.wallStart && index === 1 && spoken) {
      markWeatherTalkedToday()
    }

    if (opts.allowFollowUp && spoken && index < MAX_CHAIN) {
      const next = findAddressedPersonas(spoken, { excludeId: persona.id })
      for (const p of next) {
        if (spokenIds.has(p.id) || pending.some((q) => q.id === p.id)) continue
        if (spokenIds.size + pending.length >= MAX_CHAIN) break
        pending.push(p)
      }
    }

    if (pending.length && snap.speakerMode === 'auto') {
      parkOnWall()
      await sleep(WALL_RETURN_MS, opts.signal, opts.gen)
      if (opts.signal.aborted || opts.gen !== chainGen) return
    }
  }

  if (opts.gen !== chainGen || opts.signal.aborted) return
  if (abort?.signal === opts.signal) abort = null
  if (snap.speakerMode === 'auto') finishAutoChain()
  else scheduleFaceResetAfterTurn()
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
    (item) => item.url && !articleForUrl(item.url),
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

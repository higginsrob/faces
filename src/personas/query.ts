import { EMOTIONS, isCatalogEmoji } from '../emotions/catalog'
import type { Persona } from './types'

const DEFAULT_PROMPT =
  'You are a helpful companion. Keep replies short and speakable.'
const DEFAULT_FACE = '😊'
const DEFAULT_COLOR = '#f5c400'

const QUERY_KEYS = [
  'name',
  'face',
  'defaultFace',
  'default',
  'prompt',
  'systemPrompt',
  'color',
  'sphereColor',
] as const

export type PersonaQuerySeed = {
  name: string
  defaultFace: string
  systemPrompt: string
  sphereColor: string
}

export function parsePersonaQuery(search: string): PersonaQuerySeed | null {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  )
  const name = params.get('name')
  const face =
    params.get('face') ?? params.get('defaultFace') ?? params.get('default')
  const prompt = params.get('prompt') ?? params.get('systemPrompt')
  const color = params.get('color') ?? params.get('sphereColor')
  if (name == null && face == null && prompt == null && color == null) {
    return null
  }
  return {
    name: name?.trim() || 'new face',
    defaultFace: face != null ? resolveFace(face) : DEFAULT_FACE,
    systemPrompt: prompt != null ? prompt : DEFAULT_PROMPT,
    sphereColor: color != null ? resolveColor(color) : DEFAULT_COLOR,
  }
}

export function personaShareUrl(persona: Persona): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('name', persona.name)
  url.searchParams.set('face', persona.defaultFace)
  url.searchParams.set('color', persona.sphereColor)
  url.searchParams.set('prompt', persona.systemPrompt)
  return url.toString()
}

export function stripPersonaQuery(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  let changed = false
  for (const key of QUERY_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (!changed) return
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

export async function copyPersonaLink(persona: Persona): Promise<void> {
  const href = personaShareUrl(persona)
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(href)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = href
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

function resolveFace(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return DEFAULT_FACE
  if (isCatalogEmoji(trimmed)) return trimmed
  const lower = trimmed.toLowerCase()
  const match = EMOTIONS.find(
    (e) => e.id === lower || e.label.toLowerCase() === lower,
  )
  return match?.emoji ?? trimmed
}

function resolveColor(raw: string): string {
  const m = raw.trim().match(/^#?([0-9a-fA-F]{6})$/)
  return m ? `#${m[1]!.toLowerCase()}` : DEFAULT_COLOR
}

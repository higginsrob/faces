import { firstCatalogEmoji, isCatalogEmoji } from './catalog'

export function parseFaceLine(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const withoutLabel = trimmed.replace(/^\s*FACE\s*:\s*/i, '')
  const emoji = firstCatalogEmoji(withoutLabel) ?? firstCatalogEmoji(trimmed)
  if (emoji && isCatalogEmoji(emoji)) return emoji
  return null
}

function remainderAfterFace(text: string, face: string | null): string {
  let s = text.replace(/^\s*FACE\s*:\s*/i, '')
  if (face) {
    const idx = s.indexOf(face)
    if (idx >= 0) s = s.slice(idx + face.length)
  }
  return s.replace(/^\s+/, '')
}

export type FaceParseResult = {
  face: string | null
  spokenDelta: string
  headerDone: boolean
}

/**
 * Incremental parser: first line is FACE: <emoji> (or a bare catalog emoji).
 * Remaining streamed text is spoken dialogue.
 */
export class FaceStreamParser {
  private headerDone = false
  private headerBuf = ''
  spoken = ''
  face: string | null = null

  push(chunk: string): FaceParseResult {
    if (this.headerDone) {
      this.spoken += chunk
      return { face: this.face, spokenDelta: chunk, headerDone: true }
    }

    this.headerBuf += chunk
    const nl = this.headerBuf.search(/\r?\n/)
    if (nl === -1) {
      return { face: this.face, spokenDelta: '', headerDone: false }
    }

    const firstLine = this.headerBuf.slice(0, nl)
    const afterNl = this.headerBuf.slice(nl).replace(/^\r?\n+/, '')
    this.face = parseFaceLine(firstLine)
    const fromLine = remainderAfterFace(firstLine, this.face)
    const spoken = `${fromLine}${fromLine && afterNl ? '\n' : ''}${afterNl}`
    this.headerDone = true
    this.spoken = spoken
    return { face: this.face, spokenDelta: spoken, headerDone: true }
  }

  finish(): FaceParseResult {
    if (this.headerDone) {
      return { face: this.face, spokenDelta: '', headerDone: true }
    }
    this.face = parseFaceLine(this.headerBuf)
    const spoken = remainderAfterFace(this.headerBuf, this.face)
    this.headerDone = true
    this.spoken = spoken
    return { face: this.face, spokenDelta: spoken, headerDone: true }
  }
}

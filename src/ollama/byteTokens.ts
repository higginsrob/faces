/** llama.cpp / Ollama leftover byte tokens: `<0xF0><0x9F><0xA6><0xB9>` → 🦹 */

const TOKEN = /^<0x([0-9A-Fa-f]{2})>/

function isTokenPrefix(s: string): boolean {
  return s === '<' || s === '<0' || s === '<0x' || /^<0x[0-9A-Fa-f]{1,2}$/.test(s)
}

function utf8Len(lead: number): number {
  if ((lead & 0x80) === 0) return 1
  if ((lead & 0xe0) === 0xc0) return 2
  if ((lead & 0xf0) === 0xe0) return 3
  if ((lead & 0xf8) === 0xf0) return 4
  return 0
}

function isCont(b: number): boolean {
  return (b & 0xc0) === 0x80
}

function takeCompleteChars(bytes: number[]): { text: string; rest: number[] } {
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let i = 0
  while (i < bytes.length) {
    const n = utf8Len(bytes[i]!)
    if (n === 0) {
      i += 1
      continue
    }
    if (i + n > bytes.length) break
    const slice = bytes.slice(i, i + n)
    if (n > 1 && !slice.slice(1).every(isCont)) {
      i += 1
      continue
    }
    text += decoder.decode(Uint8Array.from(slice))
    i += n
  }
  return { text, rest: bytes.slice(i) }
}

export class ByteTokenDecoder {
  private buf = ''
  private bytes: number[] = []

  push(chunk: string): string {
    if (!chunk) return ''
    this.buf += chunk
    return this.drain(false)
  }

  finish(): string {
    return this.drain(true)
  }

  private drain(flush: boolean): string {
    let out = ''
    while (this.buf.length) {
      const m = this.buf.match(TOKEN)
      if (m) {
        this.bytes.push(Number.parseInt(m[1]!, 16))
        this.buf = this.buf.slice(m[0].length)
        const taken = takeCompleteChars(this.bytes)
        out += taken.text
        this.bytes = taken.rest
        continue
      }
      if (!flush && isTokenPrefix(this.buf)) break

      if (this.bytes.length) {
        out += takeCompleteChars(this.bytes).text
        this.bytes = []
      }
      if (!this.buf.length) break
      if (!flush && isTokenPrefix(this.buf)) break
      out += this.buf[0]!
      this.buf = this.buf.slice(1)
    }

    if (flush) {
      if (this.bytes.length) {
        out += takeCompleteChars(this.bytes).text
        this.bytes = []
      }
      if (this.buf) {
        out += this.buf
        this.buf = ''
      }
    }
    return out
  }
}

export function decodeByteTokens(text: string): string {
  const dec = new ByteTokenDecoder()
  return `${dec.push(text)}${dec.finish()}`
}

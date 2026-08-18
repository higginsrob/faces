const LINK_LINE = /^\s*LINK\s*:\s*(\S+)\s*$/gim

export function parseNewsLinkLines(content: string): {
  text: string
  urls: string[]
} {
  const urls: string[] = []
  LINK_LINE.lastIndex = 0
  const text = content
    .replace(LINK_LINE, (_, url: string) => {
      if (typeof url === 'string' && url.trim()) urls.push(url.trim())
      return ''
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, urls: uniqueUrls(urls) }
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return 'Source'
  }
}

export function appendMissingNewsLinks(
  content: string,
  urls: string[],
): string {
  const have = new Set(
    parseNewsLinkLines(content).urls.map((u) => u.toLowerCase()),
  )
  const extra = uniqueUrls(urls).filter((u) => !have.has(u.toLowerCase()))
  if (!extra.length) return content
  return `${content.trimEnd()}\n${extra.map((u) => `LINK: ${u}`).join('\n')}`
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const url = raw.trim()
    if (!url) continue
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}

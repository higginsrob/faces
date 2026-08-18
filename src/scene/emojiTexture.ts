import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  type Texture,
} from 'three'

export const DEFAULT_TEXTURE_SIZE = 2048

const svgByPath = import.meta.glob<string>('../assets/emoji/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const svgByCode = new Map<string, string>()
for (const [path, source] of Object.entries(svgByPath)) {
  const file = path.split('/').pop()
  if (file) svgByCode.set(file.replace(/\.svg$/i, ''), source)
}

function emojiToCode(emoji: string): string {
  return [...emoji]
    .map((ch) => ch.codePointAt(0)?.toString(16))
    .filter((h): h is string => Boolean(h) && h !== 'fe0f')
    .join('-')
}

function blankTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

const BLANK = blankTexture()
const cache = new Map<string, Promise<CanvasTexture>>()

function cacheKey(emoji: string, size: number) {
  return `${emoji}@${size}`
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('emoji svg failed to load'))
    img.src = url
  })
}

function withSvgSize(svgText: string, size: number): string {
  return svgText.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    const cleaned = String(attrs).replace(/\s(width|height)="[^"]*"/gi, '')
    return `<svg${cleaned} width="${size}" height="${size}">`
  })
}

function applyTextureFilters(texture: CanvasTexture, anisotropy: number) {
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = Math.max(1, anisotropy)
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
}

async function rasterizeSvg(
  svgText: string,
  anisotropy: number,
  size: number,
): Promise<CanvasTexture> {
  const sized = withSvgSize(svgText, size)
  const blob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      // Tiny inset so antialiased edges aren't clipped by the texture border.
      const pad = Math.round(size * 0.006)
      ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2)
    }
    const texture = new CanvasTexture(canvas)
    applyTextureFilters(texture, anisotropy)
    return texture
  } finally {
    URL.revokeObjectURL(url)
  }
}

function rasterizeFallback(
  emoji: string,
  anisotropy: number,
  size: number,
): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const fontSize = Math.floor(size * 0.84)
    ctx.font = `${fontSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const metrics = ctx.measureText(emoji)
    const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8
    const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2
    ctx.fillText(emoji, size / 2, size / 2 + (ascent - descent) / 2)
  }
  const texture = new CanvasTexture(canvas)
  applyTextureFilters(texture, anisotropy)
  return texture
}

function getEmojiTexture(
  emoji: string,
  anisotropy: number,
  size: number,
): Promise<CanvasTexture> {
  const key = cacheKey(emoji, size)
  const hit = cache.get(key)
  if (hit) return hit

  const pending = (async () => {
    const svg = svgByCode.get(emojiToCode(emoji))
    if (svg) return rasterizeSvg(svg, anisotropy, size)
    return rasterizeFallback(emoji, anisotropy, size)
  })()

  cache.set(key, pending)
  return pending
}

export function useEmojiTexture(
  emoji: string,
  size = DEFAULT_TEXTURE_SIZE,
): Texture {
  const anisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const [texture, setTexture] = useState<Texture>(BLANK)

  useEffect(() => {
    let cancelled = false
    getEmojiTexture(emoji, anisotropy, size).then((next) => {
      if (!cancelled) setTexture(next)
    })
    return () => {
      cancelled = true
    }
  }, [emoji, anisotropy, size])

  return texture
}

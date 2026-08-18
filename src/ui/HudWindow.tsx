import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react'

export type HudBounds = { x: number; y: number; w: number; h: number }

const MIN_W = 320
const MIN_H = 220

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type Drag =
  | { type: 'move'; px: number; py: number; start: HudBounds }
  | { type: Edge; px: number; py: number; start: HudBounds }

const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function viewport(): { w: number; h: number } {
  return { w: window.innerWidth, h: window.innerHeight }
}

export function clampHudBounds(
  b: HudBounds,
  minW = MIN_W,
  minH = MIN_H,
): HudBounds {
  const { w: vw, h: vh } = viewport()
  const w = Math.min(Math.max(minW, b.w), vw)
  const h = Math.min(Math.max(minH, b.h), vh)
  const x = Math.min(Math.max(0, b.x), Math.max(0, vw - w))
  const y = Math.min(Math.max(0, b.y), Math.max(0, vh - h))
  return { x, y, w, h }
}

export function defaultHudBounds(opts?: {
  width?: number
  heightRatio?: number
  side?: 'left' | 'right'
  minW?: number
  minH?: number
}): HudBounds {
  const minW = opts?.minW ?? MIN_W
  const minH = opts?.minH ?? MIN_H
  const { w: vw, h: vh } = viewport()
  const w = Math.min(opts?.width ?? 520, Math.max(minW, vw - 32))
  const h = Math.min(
    Math.round(vh * (opts?.heightRatio ?? 0.58)),
    Math.max(minH, vh - 140),
  )
  const x = opts?.side === 'left' ? 16 : Math.max(16, vw - w - 16)
  return clampHudBounds({ x, y: 16, w, h }, minW, minH)
}

function moved(
  start: HudBounds,
  dx: number,
  dy: number,
  minW: number,
  minH: number,
): HudBounds {
  return clampHudBounds(
    { ...start, x: start.x + dx, y: start.y + dy },
    minW,
    minH,
  )
}

function resized(
  start: HudBounds,
  edge: Edge,
  dx: number,
  dy: number,
  minW: number,
  minH: number,
): HudBounds {
  const { w: vw, h: vh } = viewport()
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (edge.includes('e')) right = start.x + start.w + dx
  if (edge.includes('s')) bottom = start.y + start.h + dy
  if (edge.includes('w')) left = start.x + dx
  if (edge.includes('n')) top = start.y + dy
  left = Math.max(0, left)
  top = Math.max(0, top)
  right = Math.min(vw, right)
  bottom = Math.min(vh, bottom)
  if (right - left < minW) {
    if (edge.includes('w')) left = right - minW
    else right = left + minW
  }
  if (bottom - top < minH) {
    if (edge.includes('n')) top = bottom - minH
    else bottom = top + minH
  }
  left = Math.max(0, left)
  top = Math.max(0, top)
  right = Math.min(vw, right)
  bottom = Math.min(vh, bottom)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function HudWindow({
  open,
  label,
  className,
  overlayClassName,
  header,
  trailing,
  minW = MIN_W,
  minH = MIN_H,
  defaultBounds,
  onClose,
  children,
}: {
  open: boolean
  label: string
  className?: string
  overlayClassName?: string
  header?: ReactNode
  trailing?: ReactNode
  minW?: number
  minH?: number
  defaultBounds?: () => HudBounds
  onClose: () => void
  children: ReactNode
}) {
  const drag = useRef<Drag | null>(null)
  const [bounds, setBounds] = useState(() =>
    defaultBounds?.() ?? defaultHudBounds(),
  )
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!open) return
    const onMove = (e: globalThis.PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.px
      const dy = e.clientY - d.py
      setBounds(
        d.type === 'move'
          ? moved(d.start, dx, dy, minW, minH)
          : resized(d.start, d.type, dx, dy, minW, minH),
      )
    }
    const onUp = () => {
      if (!drag.current) return
      drag.current = null
      setDragging(false)
    }
    const onResize = () => setBounds((b) => clampHudBounds(b, minW, minH))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('resize', onResize)
    }
  }, [open, minW, minH])

  if (!open) return null

  const begin = (e: PointerEvent, type: Drag['type']) => {
    if (e.button !== 0) return
    e.preventDefault()
    drag.current = { type, px: e.clientX, py: e.clientY, start: bounds }
    setDragging(true)
  }

  return (
    <div
      className={`hud-win-overlay${dragging ? ' dragging' : ''}${
        overlayClassName ? ` ${overlayClassName}` : ''
      }`}
    >
      <div
        className={`hud-win${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        style={{
          left: bounds.x,
          top: bounds.y,
          width: bounds.w,
          height: bounds.h,
        }}
      >
        <header
          className="hud-win-titlebar"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('a, button')) return
            begin(e, 'move')
          }}
        >
          <div className="hud-win-grip" aria-hidden="true" />
          <div className="hud-win-header">{header}</div>
          {trailing}
          <button
            type="button"
            className="hud-win-close"
            aria-label={`Close ${label}`}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="hud-win-body">{children}</div>
        {dragging ? <div className="hud-win-shield" /> : null}
        {EDGES.map((edge) => (
          <div
            key={edge}
            className={`hud-win-handle ${edge}`}
            onPointerDown={(e) => begin(e, edge)}
          />
        ))}
      </div>
    </div>
  )
}
